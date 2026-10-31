/**
 * Dashboard analytics derived from the dataset + current schedule. Pure and
 * deterministic: nothing here decides validity (that is the engine's checker);
 * it only summarises what the checked schedule already says.
 */
import type { Dataset } from "@/lib/schemas/dataset";
import type { Schedule } from "@/lib/schemas/schedule";
import { DAYS } from "@/lib/time";

export const HARD_RULES: { code: string; label: string }[] = [
  { code: "H1", label: "Every session placed once" },
  { code: "H2", label: "Teacher in one place" },
  { code: "H3", label: "Group in one place" },
  { code: "H4", label: "Room holds one thing" },
  { code: "H5", label: "Capacity" },
  { code: "H6", label: "Room type" },
  { code: "H7", label: "Teacher availability" },
  { code: "H8", label: "Room availability" },
  { code: "H9", label: "Lunch & lab starts" },
  { code: "H10", label: "Accessibility" },
  { code: "H11", label: "Elective baskets aligned" },
  { code: "H12", label: "Teacher daily limit" },
  { code: "H13", label: "Bookings don't clash" },
  { code: "H14", label: "Fixed slots kept" },
];

type Placed = {
  id: string;
  day: string;
  start: number;
  dur: number;
  room: string;
  faculty: string;
  groups: string[];
  course: string;
  kind: string;
  basket: string | null;
  size: number;
};

export function placed(ds: Dataset, schedule: Schedule): Placed[] {
  const byId = new Map(ds.sessions.map((s) => [s.id, s]));
  return schedule.sessions.flatMap((p) => {
    const s = byId.get(p.session_id);
    if (!s) return [];
    return [
      {
        id: s.id,
        day: p.day,
        start: p.start_period,
        dur: s.duration,
        room: p.room_id,
        faculty: s.faculty_id,
        groups: s.groups,
        course: s.course_id,
        kind: s.kind,
        basket: s.basket_slot,
        size: s.size,
      },
    ];
  });
}

const covers = (p: Placed, period: number) => period >= p.start && period < p.start + p.dur;

/** Sessions in progress at (day, period), and teaching rooms free for that whole period. */
export function nowAt(ds: Dataset, schedule: Schedule, day: string, period: number) {
  const all = placed(ds, schedule);
  const running = all.filter((p) => p.day === day && covers(p, period));
  const busyRooms = new Set(running.map((p) => p.room));
  const closed = new Set(
    ds.room_unavailability.filter((u) => u.day === day && u.periods.includes(period)).map((u) => u.room_id),
  );
  const free = ds.rooms
    .filter((r) => r.allowed_uses.some((u) => u === "lecture" || u === "tutorial" || u === "lab"))
    .filter((r) => !busyRooms.has(r.id) && !closed.has(r.id))
    .sort((a, b) => a.capacity - b.capacity);
  return { running, free };
}

/** Next session for one faculty member at or after (day, period) within the teaching week. */
export function nextFor(ds: Dataset, schedule: Schedule, facultyId: string, day: string, period: number) {
  const dayIdx = (d: string) => DAYS.indexOf(d as (typeof DAYS)[number]);
  const now = dayIdx(day) * 100 + period;
  return (
    placed(ds, schedule)
      .filter((p) => p.faculty === facultyId && dayIdx(p.day) * 100 + p.start + p.dur - 1 >= now)
      .sort((a, b) => dayIdx(a.day) * 100 + a.start - (dayIdx(b.day) * 100 + b.start))[0] ?? null
  );
}

/** Campus-wide rooms in use per (day, period): the peak-hours heatmap. */
export function campusHeat(ds: Dataset, schedule: Schedule) {
  const all = placed(ds, schedule);
  const grid: Record<string, number[]> = {};
  for (const d of DAYS) grid[d] = Array.from({ length: 9 }, () => 0);
  for (const p of all) {
    const row = grid[p.day];
    if (!row) continue;
    for (let q = p.start; q < p.start + p.dur && q <= 9; q++) row[q - 1] = (row[q - 1] ?? 0) + 1;
  }
  const teaching = ds.rooms.filter((r) => r.allowed_uses.some((u) => u === "lecture" || u === "lab")).length;
  const max = Math.max(1, ...Object.values(grid).flat());
  return { grid, teaching, max };
}

/** Weekly and peak-day hours per faculty member against their daily limit. */
export function facultyLoad(ds: Dataset, schedule: Schedule) {
  const all = placed(ds, schedule);
  return ds.faculty
    .map((f) => {
      const mine = all.filter((p) => p.faculty === f.id);
      const perDay = Object.fromEntries(DAYS.map((d) => [d, 0])) as Record<string, number>;
      for (const p of mine) perDay[p.day] = (perDay[p.day] ?? 0) + p.dur;
      const week = mine.reduce((n, p) => n + p.dur, 0);
      const peak = Math.max(0, ...Object.values(perDay));
      return { id: f.id, name: f.name, dept: f.department, week, peak, limit: f.max_hours_per_day, perDay };
    })
    .sort((a, b) => b.peak / b.limit - a.peak / a.limit || b.week - a.week);
}

/**
 * Hours per group per day. Sessions in one elective basket slot run in
 * parallel, so a slot counts once per group, not once per course.
 */
export function groupLoad(ds: Dataset, schedule: Schedule) {
  const all = placed(ds, schedule);
  return ds.student_groups.map((g) => {
    const perDay = Object.fromEntries(DAYS.map((d) => [d, 0])) as Record<string, number>;
    const seen = new Set<string>();
    for (const p of all) {
      if (!p.groups.includes(g.id)) continue;
      if (p.basket) {
        const k = `${p.basket}|${p.day}|${p.start}`;
        if (seen.has(k)) continue;
        seen.add(k);
      }
      perDay[p.day] = (perDay[p.day] ?? 0) + p.dur;
    }
    const week = Object.values(perDay).reduce((a, b) => a + b, 0);
    return { id: g.id, name: g.name, perDay, week, overSix: DAYS.filter((d) => (perDay[d] ?? 0) > 6) };
  });
}

/** Fill ratio of each session's room; low ratios drive the S5 soft penalty. */
export function seatFit(ds: Dataset, schedule: Schedule) {
  const rooms = new Map(ds.rooms.map((r) => [r.id, r.capacity]));
  const fits = placed(ds, schedule).map((p) => p.size / Math.max(1, rooms.get(p.room) ?? 1));
  const buckets = [0, 0, 0, 0, 0]; // <40, 40-60, 60-80, 80-100, 100
  for (const f of fits) buckets[f < 0.4 ? 0 : f < 0.6 ? 1 : f < 0.8 ? 2 : f < 1 ? 3 : 4]! += 1;
  const avg = fits.length ? fits.reduce((a, b) => a + b, 0) / fits.length : 0;
  return { buckets, avg, total: fits.length };
}
