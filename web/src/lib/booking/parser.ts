/**
 * Deterministic English + Hinglish booking parser and draft normaliser.
 *
 * - `parseBookingText` is the fallback when the LLM is unavailable (no key,
 *   timeout, error). It needs no network and no model.
 * - `normalizeDraft` runs on *every* draft, LLM or not: it clamps periods,
 *   resolves relative days, maps room names, fills defaults and flags
 *   conflicts (e.g. a named room that lacks a stated need). Code, not the
 *   LLM, has the last word on what the form shows.
 *
 * Time model: P1 08:00 … P5 12:00, lunch 13:00, P6 14:00 … P9 17:00, P10-P13 18:00-22:00 (events only).
 */
import { periodForHour } from "@/lib/time";
import { type BookingDraft, DAYS, type DraftWindow, emptyDraft, NEEDS, ROOM_TYPES } from "./draft";

type Day = (typeof DAYS)[number];
type RoomType = (typeof ROOM_TYPES)[number];
type Need = (typeof NEEDS)[number];

export type ParseRoom = {
  id: string;
  name: string;
  type: string;
  capacity: number;
  features: string[];
  accessible: boolean;
  allowed_uses: string[];
};
export type ParseGroup = { id: string; name: string; year?: number; department?: string; size?: number };
export type ParseContext = {
  rooms: ParseRoom[];
  groups: ParseGroup[];
  /** Weekday of "today" (MON..SUN), used for kal / tomorrow / parso. */
  today: string;
};

const WEEK = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

const DAY_WORDS: [RegExp, Day | "SAT" | "SUN"][] = [
  [/\b(monday|mondays|mon|somvar|somwar)\b/, "MON"],
  [/\b(tuesday|tuesdays|tues?|mangalvar|mangalwar)\b/, "TUE"],
  [/\b(wednesday|wednesdays|wed|budhvar|budhwar)\b/, "WED"],
  [/\b(thursday|thursdays|thurs?|guruvar|guruwar|brihaspativar)\b/, "THU"],
  [/\b(friday|fridays|fri|shukravar|shukrawar)\b/, "FRI"],
  [/\b(saturday|saturdays|sat|shanivar)\b/, "SAT"],
  [/\b(sunday|sundays|sun|ravivar|itvar)\b/, "SUN"],
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, ek: 1, an: 1, a: 1, two: 2, do: 2, three: 3, teen: 3, four: 4, char: 4, chaar: 4,
  five: 5, paanch: 5, six: 6, chhe: 6, seven: 7, eight: 8, nine: 9,
};

const NEED_PATTERNS: [RegExp, Need][] = [
  [/\b(projector|slides|presentation|ppt|screen)\b/, "projector"],
  [/\b(mic|mike|mics|microphones?|sound( system)?|pa( system)?|audio|amplifier|loudspeakers?)\b/, "pa_system"],
  [/\b(stage|manch)\b/, "stage"],
  [/\b(ac|a\/c|air[- ]?condition(ed|ing)?)\b/, "ac"],
  [/\b(computers?|laptops?|pcs|desktops|systems wale)\b/, "computers"],
  [/\b(wheelchair|accessible|accessibility|ramp|disabled|divyang)\b/, "accessible"],
  [/\b(power benches|power supply|bench power)\b/, "power_benches"],
];

const TYPE_PATTERNS: [RegExp, RoomType][] = [
  [/\b(auditorium|main hall|audi)\b/, "auditorium"],
  [/\b(seminar hall|seminar room|seminar)\b/, "seminar_hall"],
  [/\b(lecture hall|lecture theatre)\b/, "lecture_hall"],
  [/\b(classroom|class room|small room|tutorial room)\b/, "classroom"],
  [/\b(open[- ]air|oat|outdoor|amphitheat(re|er)|ground)\b/, "outdoor"],
  [/\b(computer lab|cs lab|coding lab|lab with computers|computer centre|pc lab)\b/, "lab_cs"],
  [/\b(electronics lab|elec lab|electrical lab)\b/, "lab_elec"],
  [/\b(physics lab)\b/, "lab_phy"],
  [/\b(workshop floor|central workshop|mech(anical)? workshop)\b/, "workshop"],
  [/\b(civil lab)\b/, "lab_civil"],
];

const BRANCHES: [RegExp, string][] = [
  [/\b(cse|computer science|cs)\b/, "CSE"],
  [/\b(ece|electronics( and communication)?)\b/, "ECE"],
  [/\b(ee|electrical)\b/, "EE"],
  [/\b(me|mech|mechanical)\b/, "ME"],
  [/\b(ce|civil)\b/, "CE"],
];
const YEARS: [RegExp, number][] = [
  [/\b(first|1st|i)[- ]?(year|years|yr)s?\b|\bfreshers?\b|\by1\b/, 1],
  [/\b(second|2nd|ii)[- ]?(year|years|yr)s?\b|\bsophomores?\b/, 2],
  [/\b(third|3rd|iii)[- ]?(year|years|yr)s?\b/, 3],
];

function addDays(day: string, n: number): string {
  const i = WEEK.indexOf(day as (typeof WEEK)[number]);
  return WEEK[(((i < 0 ? 0 : i) + n) % 7 + 7) % 7] ?? "MON";
}

function clockToPeriodStart(h: number): number | null {
  return periodForHour(h);
}

/** Inclusive last period for an end clock time (exclusive). 13:00 end -> P5, 18:00 end -> P9. */
function clockToPeriodEnd(h: number, m: number): number | null {
  const lastHour = m > 0 ? h : h - 1;
  const p = periodForHour(lastHour);
  if (p !== null) return p;
  if (lastHour === 13) return 5; // lunch hour: the block ends before lunch
  return null;
}

type Meridiem = "am" | "pm" | null;

function to24(h: number, mer: Meridiem, hint: Meridiem): { h: number; assumed: boolean } {
  if (mer === "am") return { h: h === 12 ? 0 : h, assumed: false };
  if (mer === "pm") return { h: h === 12 ? 12 : h + 12, assumed: false };
  if (h >= 13) return { h, assumed: false };
  if (hint === "pm") return { h: h === 12 ? 12 : h + 12, assumed: false };
  if (hint === "am") return { h, assumed: false };
  // No marker: 8-11 read as morning, 12 as noon, 1-7 as afternoon/evening.
  if (h >= 8 && h <= 12) return { h, assumed: true };
  return { h: h + 12, assumed: true };
}

function partOfDayHint(text: string): Meridiem {
  if (/\b(shaam|sham|evening|raat|night|tonight|dopahar|afternoon|pm)\b/.test(text)) return "pm";
  if (/\b(subah|morning|am)\b/.test(text)) return "am";
  return null;
}

export function parseBookingText(raw: string, ctx: ParseContext): BookingDraft {
  const d = emptyDraft();
  const text = ` ${raw.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ")} `;
  let rest = text;

  // ---- duration ("2 hours", "3-hour", "2 ghante", "90 minutes", "an hour", "whole day")
  const dur = rest.match(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six|an|a|ek|do|teen|char|chaar)[- ]?(hours?|hrs?|ghante|ghanta|ghanton)\b/);
  if (dur?.[1]) {
    const n = NUMBER_WORDS[dur[1]] ?? Number(dur[1]);
    if (n > 0) d.duration_periods = Math.min(13, Math.ceil(n));
    rest = rest.replace(dur[0], " ");
  } else {
    const mins = rest.match(/\b(\d+)\s*(minutes|mins|min)\b/);
    if (mins?.[1]) {
      d.duration_periods = Math.max(1, Math.ceil(Number(mins[1]) / 60));
      rest = rest.replace(mins[0], " ");
    } else if (/\bhalf an hour\b|\badha ghanta\b/.test(rest)) {
      d.duration_periods = 1;
    }
  }
  const wholeDay = /\b(whole|full|entire|poora|pura) day\b|\ball day\b|\bdin bhar\b/.test(rest);

  // ---- attendance ("45 people", "100 log", "around 400", "60 participants")
  const att = rest.match(
    /\b(\d[\d,]*)\s*\+?\s*(people|persons|person|log|logon|students|participants|attendees|members|guests|seats|pax|audience|bande|janta|dancers|spectators|visitors|viewers|players|delegates|kids|children|volunteers)\b/,
  );
  if (att?.[1]) {
    d.attendance = Number(att[1].replace(/,/g, ""));
    rest = rest.replace(att[0], " ");
  } else {
    const around = rest.match(/\b(?:around|about|approx(?:imately)?|roughly|maybe|~)\s*(\d[\d,]{1,5})\b(?!\s*(?:am|pm|baje|:))/);
    if (around?.[1]) {
      d.attendance = Number(around[1].replace(/,/g, ""));
      rest = rest.replace(around[0], " ");
    } else {
      const forN = rest.match(/\b(?:for|ke liye)\s+(\d{2,5})\b(?!\s*(?:am|pm|baje|:|hours?|mins?))/);
      if (forN?.[1]) {
        d.attendance = Number(forN[1]);
        rest = rest.replace(forN[0], " ");
      }
    }
  }

  // ---- days
  const daily = /\b(daily|every ?day|each day|all of (fest|spectra|the) week|whole week|all week|roz|rozana)\b/.test(rest);
  const recurring = daily || /\b(every|each|har)\b|\b(mondays|tuesdays|wednesdays|thursdays|fridays)\b|\bweekly\b/.test(rest);
  const dayHits: string[] = daily ? [...DAYS] : [];
  if (/\b(day after tomorrow|parso|parson)\b/.test(rest)) dayHits.push(addDays(ctx.today, 2));
  else if (/\b(tomorrow|kal)\b/.test(rest)) dayHits.push(addDays(ctx.today, 1));
  else if (/\b(today|aaj|tonight)\b/.test(rest)) dayHits.push(ctx.today);
  for (const [re, day] of DAY_WORDS) if (re.test(rest)) dayHits.push(day);
  const weekend = dayHits.filter((x) => x === "SAT" || x === "SUN");
  const days = [...new Set(dayHits.filter((x): x is Day => (DAYS as readonly string[]).includes(x)))];
  if (weekend.length) d.ambiguities.push("Venues are bookable Monday to Friday only; weekend dates were ignored.");
  if (/\b(kal)\b/.test(rest)) d.assumptions.push(`"Kal" read as tomorrow (${days[0] ?? addDays(ctx.today, 1)}).`);

  // ---- times
  const hint = partOfDayHint(rest);
  let fromP: number | null = null;
  let toP: number | null = null;
  const range =
    rest.match(/\bbetween\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*and\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|baje)?\b/) ??
    rest.match(
      /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|to|till|until|se|tak)\s*(\d{1,2}|midnight)(?:[:.](\d{2}))?\s*(am|pm|baje)?\b/,
    );
  if (range && range[4] === "midnight") range[4] = "12";
  const single = rest.match(/\b(?:at|from|by|around)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|baje|o'?clock)\b/);
  if (range?.[1] && range[4]) {
    const endMer = (range[6] === "am" || range[6] === "pm" ? range[6] : null) as Meridiem;
    const startMer = (range[3] as Meridiem) ?? null;
    const e = /midnight/.test(range[0]) ? { h: 24, assumed: false } : to24(Number(range[4]), endMer, hint);
    let s = to24(Number(range[1]), startMer, startMer ? null : (endMer ?? hint));
    if (!startMer && s.h > e.h && s.h - 12 >= 8) s = { h: s.h - 12, assumed: s.assumed };
    fromP = clockToPeriodStart(s.h);
    toP = clockToPeriodEnd(Math.min(e.h, 22), Number(range[5] ?? 0));
    if (e.h > 22) d.ambiguities.push("Events must end by 22:00; the part after that cannot be booked.");
    if (fromP === null && s.h >= 22) d.ambiguities.push("Bookings end at 22:00; a start at or after 22:00 cannot be booked.");
    if (fromP && toP && toP >= fromP && !d.duration_periods) d.duration_periods = toP - fromP + 1;
    if ((s.assumed || e.assumed) && !hint) d.assumptions.push(`Read the times as ${s.h}:00–${e.h}:00.`);
    if (fromP === null || toP === null) d.ambiguities.push("Part of that time range is outside bookable hours (08:00–13:00, 14:00–22:00).");
  } else if (single?.[1]) {
    const mer = (single[3] === "am" || single[3] === "pm" ? single[3] : null) as Meridiem;
    const s = to24(Number(single[1]), mer, hint);
    fromP = clockToPeriodStart(s.h);
    if (fromP === null) d.ambiguities.push(`${s.h}:00 is not a bookable start time (08:00–12:00 or 14:00–21:00).`);
    if (s.assumed && !hint) d.assumptions.push(`Read "${single[1]}" as ${s.h}:00.`);
    if (fromP !== null) {
      if (!d.duration_periods) {
        d.duration_periods = 2;
        d.assumptions.push("No duration given; assumed 2 hours.");
      }
      toP = Math.min(13, fromP + d.duration_periods - 1);
    }
  }
  if (fromP === null) {
    const vague: [RegExp, number, number, string][] = [
      [/\bafter lunch|lunch ke baad\b/, 6, 9, "after lunch = 14:00–18:00 (P6–P9)"],
      [/\b(afternoon|dopahar)\b/, 6, 9, "afternoon = 14:00–18:00 (P6–P9)"],
      [/\b(morning|subah)\b/, 1, 5, "morning = 08:00–13:00 (P1–P5)"],
      [/\b(evening|shaam|sham|night|raat|tonight)\b/, 10, 13, "evening = 18:00–22:00 (P10–P13)"],
    ];
    if (wholeDay) {
      fromP = 1;
      toP = 9;
      d.duration_periods = d.duration_periods ?? 9;
      d.assumptions.push("Whole day = 08:00–18:00 (P1–P9).");
    } else {
      for (const [re, a, b, note] of vague) {
        if (re.test(rest)) {
          fromP = a;
          toP = b;
          d.assumptions.push(`Assumed ${note}.`);
          break;
        }
      }
    }
  }
  if (fromP !== null && toP !== null && days.length) {
    for (const day of days) d.windows.push({ day, from_period: fromP, to_period: Math.max(fromP, toP) });
  }
  if (recurring && days.length > 1) d.recurrence_days = days;
  else if (recurring && days.length === 1) d.recurrence_days = days;

  // ---- needs and room types
  for (const [re, need] of NEED_PATTERNS) if (re.test(rest) && !d.needs.includes(need)) d.needs.push(need);
  for (const [re, t] of TYPE_PATTERNS) if (re.test(rest) && !d.room_types.includes(t)) d.room_types.push(t);
  if (d.needs.includes("computers") && !d.room_types.includes("lab_cs")) d.room_types.push("lab_cs");
  if (/\blab\b/.test(rest) && !d.room_types.some((t) => t.startsWith("lab"))) {
    d.room_types.push("lab_cs");
    d.assumptions.push('"Lab" read as a computer lab.');
  }
  if (/\b(any (small )?room|koi bhi room)\b/.test(rest) && d.room_types.length === 0) d.room_types.push("classroom");

  // ---- named room (codes like LH-5, SH-2, CR-101, AUD, OAT; unknown ones like LHC-5 are kept and flagged)
  const code = raw.match(/\b([A-Za-z]{2,5})[- ]?(\d{1,3})\b/g)?.find((c) => !/^(p|br|f|y|ex|s|h)\d/i.test(c.replace(/[- ]/g, "")));
  if (code) d.requested_room = code.toUpperCase().replace(" ", "-");
  else if (/\b(aud|auditorium|main auditorium)\b/.test(rest) && ctx.rooms.some((r) => r.id === "AUD")) d.requested_room = "AUD";
  else if (/\boat\b|open air theatre/.test(rest) && ctx.rooms.some((r) => r.id === "OAT")) d.requested_room = "OAT";

  // ---- mandatory groups
  const mandatory = /\b(compulsory|mandatory|zaroori|must attend|required for|for all)\b/.test(rest);
  const groupHits = new Set<string>();
  for (const g of ctx.groups) if (new RegExp(`\\b${g.id.toLowerCase()}\\b`).test(rest)) groupHits.add(g.id);
  const branch = BRANCHES.find(([re]) => re.test(rest))?.[1];
  const year = YEARS.find(([re]) => re.test(rest))?.[1];
  if (branch && year && year > 1) groupHits.add(`${branch}-${year}`);
  if (year === 1 && /\b(all )?(first[- ]years?|1st[- ]years?|freshers)\b/.test(rest)) {
    for (const g of ctx.groups) if (g.year === 1) groupHits.add(g.id);
  }
  const known = new Set(ctx.groups.map((g) => g.id));
  if (mandatory) {
    d.mandatory_for_groups = [...groupHits].filter((g) => known.has(g));
    if (!d.mandatory_for_groups.length) d.ambiguities.push("You said attendance is compulsory; which student groups must attend?");
    if (d.attendance === null && d.mandatory_for_groups.length) {
      const total = d.mandatory_for_groups.reduce((n, id) => n + (ctx.groups.find((g) => g.id === id)?.size ?? 0), 0);
      if (total > 0) {
        d.attendance = total;
        d.assumptions.push(`Attendance taken as the size of ${d.mandatory_for_groups.join(", ")} (${total}).`);
      }
    }
  }

  // ---- category claims (recorded only; the server caps by role)
  if (/\binstitute(-level)? event\b|\bconvocation\b|\bspectra (main|core)\b/.test(rest)) d.category_claimed = "institute_event";
  else if (/\bguest lecture|industry (speaker|talk)|invited talk|expert talk\b/.test(rest)) d.category_claimed = "guest_lecture";
  else if (/\bdepartment(al)? (event|farewell|meet|function)|\bdept\b|\bfarewell\b/.test(rest)) d.category_claimed = "department_event";
  else if (/\bclub\b/.test(rest)) d.category_claimed = "club_event";

  // ---- conditions ("SH-1, else AUD if more than 100 come")
  const cond = raw.match(/\b(?:else|otherwise|or else|nahi to|warna|if not)\b[, ]*(?:the )?([^.;,]+?)(?:\s+if\s+(?:more than|over|above|>)\s*(\d+)[^.;]*)?(?:[.;,]|$)/i);
  if (cond?.[1]) {
    const clause = cond[1].toLowerCase();
    const types = TYPE_PATTERNS.filter(([re]) => re.test(clause)).map(([, t]) => t);
    const roomCode = cond[1].match(/\b([A-Za-z]{2,5})[- ]?(\d{1,3})\b/)?.[0]?.toUpperCase() ?? (/\baud\b/i.test(cond[1]) ? "AUD" : null);
    d.conditions.push({
      when: cond[2] ? `if more than ${cond[2]} attend` : "if the first choice is unavailable",
      room_types: types,
      requested_room: roomCode,
      min_attendance: cond[2] ? Number(cond[2]) : null,
    });
  }

  d.title = deriveTitle(raw, rest);
  return d;
}

function deriveTitle(raw: string, lower: string): string {
  const quoted = raw.match(/["“']([^"”']{3,60})["”']/);
  if (quoted?.[1]) return quoted[1].trim();
  const forThe = raw.match(/\bfor (?:the |our |a |an )?((?:[A-Z][\w'-]*\s?){1,5}(?:farewell|finals|contest|session|meet|workshop|talk|night|fest|seminar|lecture)?)/);
  if (forThe?.[1] && forThe[1].trim().split(" ").length <= 6 && /[A-Z]/.test(forThe[1][0] ?? "")) return forThe[1].trim();
  const events: [RegExp, string][] = [
    [/quiz finals?/, "Quiz finals"],
    [/coding contest|hackathon/, "Coding contest"],
    [/farewell/, "Farewell"],
    [/poster session/, "Poster session"],
    [/club meet(ing)?s?|our club meets/, "Club meeting"],
    [/industry speaker|guest lecture|talk/, "Guest talk"],
    [/workshop/, "Workshop"],
    [/rehearsal/, "Rehearsal"],
    [/seminar/, "Seminar"],
    [/screening/, "Screening"],
    [/meeting/, "Meeting"],
  ];
  return events.find(([re]) => re.test(lower))?.[1] ?? "Venue booking";
}

// ============================================================== normalisation
function roomKey(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function similarity(a: string, b: string): number {
  // Dice coefficient on character bigrams: cheap and good for codes like LHC-5 vs LH-5.
  const grams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) ?? 0);
  const total = Math.max(1, a.length - 1 + b.length - 1);
  return (2 * hit) / total;
}

export function closestRoom(ctx: ParseContext, name: string): ParseRoom | null {
  const key = roomKey(name);
  let best: ParseRoom | null = null;
  let score = 0;
  const digits = key.match(/\d+$/)?.[0];
  for (const r of ctx.rooms) {
    for (const label of [r.id, r.name]) {
      const k2 = roomKey(label);
      let s = similarity(key, k2);
      // Same trailing number and same leading letter ("LHC-5" vs "LH-5") is a strong hint.
      if (digits && k2.match(/\d+$/)?.[0] === digits && k2[0] === key[0]) s += 0.3;
      if (s > score) {
        score = s;
        best = r;
      }
    }
  }
  return score >= 0.5 ? best : null;
}

function featuresOf(r: ParseRoom): Set<string> {
  const f = new Set(r.features);
  if (r.accessible) f.add("accessible");
  return f;
}

function defaultTypes(attendance: number | null): RoomType[] {
  const n = attendance ?? 60;
  if (n <= 90) return ["classroom", "lecture_hall", "seminar_hall"];
  if (n <= 200) return ["lecture_hall", "seminar_hall", "auditorium"];
  if (n <= 500) return ["auditorium", "outdoor"];
  return ["outdoor"];
}

/** Clean up any draft (LLM or fallback) with deterministic rules. Never invents availability. */
export function normalizeDraft(input: BookingDraft, ctx: ParseContext): BookingDraft {
  const d: BookingDraft = structuredClone(input);
  const known = new Set(ctx.groups.map((g) => g.id));
  d.title = d.title.trim().slice(0, 120) || "Venue booking";

  // Windows: valid days, clamp to P1-P13, ordered, de-duplicated.
  const seen = new Set<string>();
  const windows: DraftWindow[] = [];
  for (const w of d.windows) {
    if (!(DAYS as readonly string[]).includes(w.day)) continue;
    const a = Math.min(13, Math.max(1, Math.round(w.from_period)));
    const b = Math.min(13, Math.max(a, Math.round(w.to_period)));
    const k = `${w.day}${a}-${b}`;
    if (!seen.has(k)) {
      seen.add(k);
      windows.push({ day: w.day, from_period: a, to_period: b });
    }
  }
  // Recurrence: repeat the first window's time on each recurrence day.
  const first = windows[0];
  if (d.recurrence_days.length && first) {
    for (const day of d.recurrence_days) {
      const k = `${day}${first.from_period}-${first.to_period}`;
      if (!seen.has(k)) {
        seen.add(k);
        windows.push({ day, from_period: first.from_period, to_period: first.to_period });
      }
    }
  }
  d.windows = windows;

  // Duration.
  if (!d.duration_periods && d.windows[0]) {
    const span = d.windows[0].to_period - d.windows[0].from_period + 1;
    d.duration_periods = span <= 3 ? span : 2;
    if (span > 3) d.assumptions.push("No duration given; assumed 2 hours within the window.");
  }
  if (d.duration_periods) {
    for (const w of d.windows) {
      if (w.to_period - w.from_period + 1 < d.duration_periods) {
        w.to_period = Math.min(13, w.from_period + d.duration_periods - 1);
      }
    }
    const crosses = d.windows.some((w) => w.from_period <= 5 && w.to_period >= 6 && w.to_period - w.from_period + 1 === d.duration_periods);
    if (crosses) d.assumptions.push("The block spans lunch (13:00–14:00); periods are counted around it.");
    if (d.windows.some((w) => w.from_period + d.duration_periods! - 1 > 13)) {
      d.ambiguities.push("Events must end by 22:00; the requested time runs past it.");
    }
  }

  // Needs that imply room types.
  if (d.needs.includes("computers") && !d.room_types.includes("lab_cs")) d.room_types.push("lab_cs");
  if (!d.room_types.length) {
    d.room_types = defaultTypes(d.attendance);
    d.assumptions.push(`Any room type that fits ${d.attendance ?? "the group"} (${d.room_types.join(", ").replaceAll("_", " ")}).`);
  }

  // Requested room: resolve, flag unknown, and check it against the stated needs.
  if (d.requested_room) {
    const exact = ctx.rooms.find((r) => roomKey(r.id) === roomKey(d.requested_room ?? ""));
    if (!exact) {
      const guess = closestRoom(ctx, d.requested_room);
      const unknown = d.requested_room;
      d.ambiguities.push(
        `Room "${unknown}" does not exist${guess ? `; did you mean ${guess.id} (${guess.name})?` : "."}` +
          (guess && [...d.needs].some((n) => !featuresOf(guess).has(n))
            ? ` ${guess.id} lacks ${d.needs.filter((n) => !featuresOf(guess).has(n)).join(", ").replaceAll("_", " ")}, so another room will be used.`
            : ""),
      );
      d.requested_room = null;
    } else {
      d.requested_room = exact.id;
      if (!d.room_types.includes(exact.type as RoomType)) d.room_types.push(exact.type as RoomType);
      const missing = d.needs.filter((n) => !featuresOf(exact).has(n));
      const tooSmall = d.attendance !== null && exact.capacity < d.attendance;
      if (missing.length || tooSmall) {
        const alt = ctx.rooms
          .filter(
            (r) =>
              r.allowed_uses.includes("event") &&
              d.room_types.includes(r.type as RoomType) &&
              (d.attendance === null || r.capacity >= d.attendance) &&
              d.needs.every((n) => featuresOf(r).has(n)),
          )
          .sort((a, b) => (a.type === exact.type ? -1 : 0) - (b.type === exact.type ? -1 : 0) || a.capacity - b.capacity)[0];
        const why = missing.length
          ? `${exact.id} is not ${missing.includes("accessible") ? "wheelchair accessible" : `equipped with ${missing.join(", ").replaceAll("_", " ")}`}`
          : `${exact.id} seats only ${exact.capacity}`;
        d.ambiguities.push(`${why}${alt ? `; ${alt.id} (${alt.name}) is, so it was suggested instead.` : "."}`);
        d.requested_room = alt?.id ?? null;
      }
    }
  }

  d.mandatory_for_groups = [...new Set(d.mandatory_for_groups)].filter((g) => known.has(g));
  const biggest = [...ctx.rooms].filter((r) => r.allowed_uses.includes("event")).sort((a, b) => b.capacity - a.capacity)[0];
  if (d.attendance && biggest && d.attendance > biggest.capacity) {
    d.ambiguities.push(`No venue seats ${d.attendance.toLocaleString("en-IN")}; the largest is ${biggest.id} (${biggest.capacity}).`);
  }

  // One follow-up question for the most important missing piece.
  if (!d.follow_up) {
    if (!d.windows.length) d.follow_up = "Which day and time do you need the venue?";
    else if (!d.attendance) d.follow_up = "About how many people will attend?";
  }
  d.assumptions = [...new Set(d.assumptions)];
  d.ambiguities = [...new Set(d.ambiguities)];
  return d;
}
