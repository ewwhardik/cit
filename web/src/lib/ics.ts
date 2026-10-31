/**
 * iCalendar export of one timetable view (group, faculty or room): every
 * session becomes a weekly repeating event in Asia/Kolkata time. Pure.
 */
import type { Dataset } from "@/lib/schemas/dataset";
import type { Schedule } from "@/lib/schemas/schedule";
import { periodStartHour } from "@/lib/time";
import { sessionMatches, type View } from "@/lib/timetable";

const DAY_OFFSET: Record<string, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4 };

const esc = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/[,;]/g, (m) => `\\${m}`)
    .replace(/\n/g, "\\n");
const pad = (n: number) => String(n).padStart(2, "0");

/** Monday of the week containing `isoDate` (YYYY-MM-DD). */
export function mondayOf(isoDate: string): Date {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d;
}

export function timetableIcs(
  ds: Dataset,
  schedule: Schedule,
  view: View,
  id: string,
  opts: { weekOf: string; weeks?: number; label: string; stamp?: Date },
): string {
  const monday = mondayOf(opts.weekOf);
  const stamp = (opts.stamp ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const sessions = new Map(ds.sessions.map((s) => [s.id, s]));
  const faculty = new Map(ds.faculty.map((f) => [f.id, f.name]));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CIT Scheduler//Timetable//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(opts.label)}`,
    "X-WR-TIMEZONE:Asia/Kolkata",
  ];
  for (const p of schedule.sessions) {
    const s = sessions.get(p.session_id);
    if (!s || !sessionMatches(view, id, s, p.room_id)) continue;
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + (DAY_OFFSET[p.day] ?? 0));
    const date = `${day.getUTCFullYear()}${pad(day.getUTCMonth() + 1)}${pad(day.getUTCDate())}`;
    const start = periodStartHour(p.start_period);
    const end = periodStartHour(p.start_period + s.duration - 1) + 1;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${p.session_id}-${view}-${id}@cit-scheduler`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Kolkata:${date}T${pad(start)}0000`,
      `DTEND;TZID=Asia/Kolkata:${date}T${pad(end)}0000`,
      `RRULE:FREQ=WEEKLY;COUNT=${opts.weeks ?? 16}`,
      `SUMMARY:${esc(`${s.course_id} ${s.kind}`)}`,
      `LOCATION:${esc(p.room_id)}`,
      `DESCRIPTION:${esc(`${faculty.get(s.faculty_id) ?? s.faculty_id} · ${s.groups.join(", ")} · ${s.id}`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
