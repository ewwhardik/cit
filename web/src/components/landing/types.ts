import type { ParseContext } from "@/lib/booking/parser";

export type Kind = "lecture" | "tutorial" | "lab";

/** One session as the 3D skyline draws it. day/start are -1 before the first Generate. */
export type LandingBlock = {
  id: string;
  course: string;
  kind: Kind;
  day: number;
  start: number;
  dur: number;
  room: string;
};

export type LandingData = {
  signedIn: boolean;
  userName: string | null;
  accounts: { email: string; role: string; note: string }[];
  demoPassword: string;
  counts: {
    sessions: number;
    rooms: number;
    faculty: number;
    groups: number;
    requests: number;
    exams: number;
  } | null;
  report: { hard: number; soft: number; bookingScore: number | null; bookingMax: number | null } | null;
  blocks: LandingBlock[];
  solved: boolean;
  parseCtx: ParseContext | null;
};

export const KIND_COLOR: Record<Kind, string> = {
  lecture: "#ff5a1f",
  tutorial: "#efe6d2",
  lab: "#c6ff3d",
};

export const KIND_LABEL: Record<Kind, string> = { lecture: "Lectures", tutorial: "Tutorials", lab: "Labs" };

export const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI"] as const;

/** P1 08:00 … P5 12:00, lunch, P6 14:00 … P13 21:00. */
export function periodHour(p: number): number {
  return p <= 5 ? 7 + p : 8 + p;
}

export function clock(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}
