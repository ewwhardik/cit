/**
 * The booking draft: what the AI assistant (or the deterministic parser) fills in
 * and the user edits before submitting. The same schema backs the LLM's
 * structured output, the editable form and the submit API. A draft is never a
 * decision: the engine decides availability and priority.
 */
import { z } from "zod";

export const DAYS = ["MON", "TUE", "WED", "THU", "FRI"] as const;
export const ROOM_TYPES = [
  "classroom",
  "lecture_hall",
  "auditorium",
  "seminar_hall",
  "outdoor",
  "lab_cs",
  "lab_elec",
  "lab_phy",
  "workshop",
  "lab_civil",
] as const;
export const NEEDS = ["projector", "pa_system", "stage", "ac", "computers", "power_benches", "accessible"] as const;
export const CATEGORIES = ["institute_event", "guest_lecture", "department_event", "club_event"] as const;

export const DraftWindow = z.object({
  day: z.enum(DAYS),
  from_period: z.number().int().min(1).max(13),
  to_period: z.number().int().min(1).max(13),
});
export type DraftWindow = z.infer<typeof DraftWindow>;

export const DraftCondition = z.object({
  /** Plain description of when this alternative applies, e.g. "if more than 100 attend". */
  when: z.string(),
  room_types: z.array(z.enum(ROOM_TYPES)),
  requested_room: z.string().nullable(),
  min_attendance: z.number().int().nullable(),
});

export const BookingDraft = z.object({
  title: z.string(),
  attendance: z.number().int().positive().nullable(),
  duration_periods: z.number().int().min(1).max(13).nullable(),
  windows: z.array(DraftWindow),
  room_types: z.array(z.enum(ROOM_TYPES)),
  needs: z.array(z.enum(NEEDS)),
  requested_room: z.string().nullable(),
  mandatory_for_groups: z.array(z.string()),
  /** Weekly repetition, e.g. every MON and WED. Expanded into one request per day. */
  recurrence_days: z.array(z.enum(DAYS)),
  /** What the requester *claims*; the server caps it by their role. */
  category_claimed: z.enum(CATEGORIES).nullable(),
  conditions: z.array(DraftCondition),
  assumptions: z.array(z.string()),
  ambiguities: z.array(z.string()),
  follow_up: z.string().nullable(),
});
export type BookingDraft = z.infer<typeof BookingDraft>;

export function emptyDraft(): BookingDraft {
  return {
    title: "",
    attendance: null,
    duration_periods: null,
    windows: [],
    room_types: [],
    needs: [],
    requested_room: null,
    mandatory_for_groups: [],
    recurrence_days: [],
    category_claimed: null,
    conditions: [],
    assumptions: [],
    ambiguities: [],
    follow_up: null,
  };
}

/** What the form submits: a complete request in the dataset's booking_requests shape (minus server fields). */
export const BookingSubmission = z.object({
  title: z.string().trim().min(2).max(120),
  attendance: z.number().int().positive().max(100_000),
  duration_periods: z.number().int().min(1).max(13),
  windows: z.array(DraftWindow).min(1).max(10),
  room_types: z.array(z.enum(ROOM_TYPES)).min(1),
  needs: z.array(z.enum(NEEDS)),
  requested_room: z.string().nullable(),
  mandatory_for_groups: z.array(z.string()),
  recurrence_days: z.array(z.enum(DAYS)).default([]),
  category: z.enum(CATEGORIES),
  raw_text: z.string().max(2000).optional(),
  parsed_by: z.enum(["llm", "fallback", "manual"]).default("manual"),
});
export type BookingSubmission = z.infer<typeof BookingSubmission>;

export type RoleKey = "admin" | "dept_coordinator" | "faculty" | "club";

/** Highest category each role may claim (mirrors the dataset's role_category_cap). */
export const ROLE_CAP: Record<RoleKey, (typeof CATEGORIES)[number]> = {
  admin: "institute_event",
  faculty: "guest_lecture",
  dept_coordinator: "department_event",
  club: "club_event",
};

export function capCategory(role: RoleKey, claimed: string | null | undefined): (typeof CATEGORIES)[number] {
  const order = CATEGORIES as readonly string[];
  const cap = order.indexOf(ROLE_CAP[role]);
  const asked = claimed && order.includes(claimed) ? order.indexOf(claimed) : order.length - 1;
  return CATEGORIES[Math.max(cap, asked)] ?? "club_event";
}

/** Dataset role names differ from app role names. */
export const DATASET_ROLE: Record<RoleKey, string> = {
  admin: "admin",
  dept_coordinator: "department_coordinator",
  faculty: "faculty",
  club: "club",
};
