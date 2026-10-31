/**
 * Zod schemas for the starter-pack formats (dataset, change file, schedule.json).
 * One schema is shared by uploads, API routes, forms and LLM output parsing.
 */
import { z } from "zod";

export const Day = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT"]);
export type Day = z.infer<typeof Day>;

export const Room = z.object({
  id: z.string(),
  name: z.string(),
  building: z.string().optional(),
  type: z.string(),
  capacity: z.number().int().nonnegative(),
  features: z.array(z.string()).default([]),
  accessible: z.boolean(),
  allowed_uses: z.array(z.string()),
});
export type Room = z.infer<typeof Room>;

const PeriodBlock = z.object({ day: z.string(), periods: z.array(z.number().int()) });

export const Faculty = z.object({
  id: z.string(),
  name: z.string(),
  department: z.string().optional(),
  max_hours_per_day: z.number().int().default(4),
  needs_accessible: z.boolean().optional(),
  unavailable: z.array(PeriodBlock.extend({ reason: z.string().optional() })).default([]),
  preferences: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type Faculty = z.infer<typeof Faculty>;

export const StudentGroup = z.object({
  id: z.string(),
  name: z.string(),
  year: z.number().int().optional(),
  department: z.string().optional(),
  size: z.number().int(),
  needs_accessible: z.boolean().optional(),
});
export type StudentGroup = z.infer<typeof StudentGroup>;

export const Session = z.object({
  id: z.string(),
  course_id: z.string(),
  kind: z.enum(["lecture", "tutorial", "lab"]),
  groups: z.array(z.string()),
  faculty_id: z.string(),
  size: z.number().int(),
  duration: z.number().int().min(1),
  room_types: z.array(z.string()),
  needs_accessible: z.boolean().default(false),
  basket_slot: z.string().nullable().default(null),
  fixed_slot: z.object({ day: z.string(), start_period: z.number().int() }).nullable().default(null),
});
export type Session = z.infer<typeof Session>;

export const Window = z.object({
  day: Day,
  from_period: z.number().int().min(1),
  to_period: z.number().int().min(1),
});
export type Window = z.infer<typeof Window>;

export const BookingRequest = z.object({
  id: z.string(),
  submitted_at: z.string(),
  requester: z.string(),
  role: z.enum(["admin", "department_coordinator", "faculty", "club"]),
  department: z.string().nullable().optional(),
  requested_category: z.string(),
  title: z.string(),
  attendance: z.number().int().positive(),
  duration_periods: z.number().int().positive(),
  windows: z.array(Window).min(1),
  room_types: z.array(z.string()).min(1),
  needs: z.array(z.string()).default([]),
  requested_room: z.string().nullable().default(null),
  mandatory_for_groups: z.array(z.string()).default([]),
  series_id: z.string().nullable().default(null),
  raw_text: z.string().optional(),
});
export type BookingRequest = z.infer<typeof BookingRequest>;

export const Course = z.object({ id: z.string(), name: z.string().optional() }).passthrough();
export const Exam = z.object({
  id: z.string(),
  course_ids: z.array(z.string()),
  groups: z.array(z.string()),
  size: z.number().int(),
  duration_hours: z.number().optional(),
});

export const Dataset = z
  .object({
    dataset_id: z.string(),
    institute: z.unknown().optional(),
    calendar: z
      .object({
        days: z.array(z.string()),
        periods: z.array(
          z.object({ id: z.number().int(), start: z.string(), end: z.string(), teaching: z.boolean() }),
        ),
        lunch: z.object({ after_period: z.number().int() }).passthrough(),
        lab_start_periods: z.array(z.number().int()),
      })
      .passthrough(),
    priority_order: z.array(z.string()),
    role_category_cap: z.record(z.string(), z.string()),
    rooms: z.array(Room),
    room_unavailability: z.array(PeriodBlock.extend({ room_id: z.string(), reason: z.string().optional() })),
    faculty: z.array(Faculty),
    student_groups: z.array(StudentGroup),
    courses: z.array(Course),
    sessions: z.array(Session),
    booking_requests: z.array(BookingRequest).default([]),
    cancellations: z.array(z.object({ request_id: z.string() }).passthrough()).default([]),
    exams: z.array(Exam).default([]),
  })
  .passthrough();
export type Dataset = z.infer<typeof Dataset>;

export const Change = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("faculty_unavailable"),
    faculty_id: z.string(),
    days: z.array(z.string()),
    periods: z.array(z.number().int()),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("room_unavailable"),
    room_id: z.string(),
    days: z.array(z.string()),
    periods: z.array(z.number().int()),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal("add_faculty"), faculty: Faculty }),
  z.object({ type: z.literal("add_session"), session: Session }),
  z.object({ type: z.literal("remove_session"), session_id: z.string() }),
]);
export const ChangeFile = z.object({ changes: z.array(Change) }).passthrough();
export type ChangeFile = z.infer<typeof ChangeFile>;
