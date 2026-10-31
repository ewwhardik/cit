/** Period and day helpers shared by grids, forms and parsers. */

export const DAYS = ["MON", "TUE", "WED", "THU", "FRI"] as const;
export const DAY_LABEL: Record<string, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
};
export const TEACHING_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const EVENT_PERIODS = [10, 11, 12, 13] as const;
export const LUNCH_AFTER = 5;

/** P1 starts at 08:00; each period is one hour; lunch 13:00-14:00 sits between P5 and P6. */
export function periodStartHour(p: number): number {
  return p <= LUNCH_AFTER ? 7 + p : 8 + p;
}

export function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export function periodRange(start: number, end: number): string {
  return `${hourLabel(periodStartHour(start))}–${hourLabel(periodStartHour(end) + 1)}`;
}

/** Inverse of periodStartHour for clock hours (24h). Returns null outside P1-P13. */
export function periodForHour(h: number): number | null {
  if (h >= 8 && h <= 12) return h - 7;
  if (h >= 14 && h <= 21) return h - 8;
  return null;
}
