import { z } from "zod";

export const SessionPlacement = z.object({
  session_id: z.string(),
  day: z.string(),
  start_period: z.number().int(),
  room_id: z.string(),
});
export type SessionPlacement = z.infer<typeof SessionPlacement>;

export const BookingDecision = z.object({
  request_id: z.string(),
  status: z.enum(["approved", "rejected", "alternative_offered"]),
  day: z.string().optional(),
  start_period: z.number().int().optional(),
  end_period: z.number().int().optional(),
  room_id: z.string().optional(),
  reason: z.string().optional(),
});
export type BookingDecision = z.infer<typeof BookingDecision>;

export const SessionOverride = SessionPlacement.extend({ displaced_by: z.string() });

export const ExamPlacement = z.object({
  exam_id: z.string(),
  day: z.string(),
  session: z.string(),
  rooms: z.array(z.string()),
});
export type ExamPlacement = z.infer<typeof ExamPlacement>;

export const Schedule = z.object({
  team: z.string().optional(),
  dataset_id: z.string().optional(),
  sessions: z.array(SessionPlacement),
  fest_week: z
    .object({ bookings: z.array(BookingDecision), session_overrides: z.array(SessionOverride).default([]) })
    .optional(),
  exams: z.array(ExamPlacement).optional(),
});
export type Schedule = z.infer<typeof Schedule>;

export type Violation = { rule: string; where: string; detail: string };

export type Report = {
  dataset_id: string | null;
  soft_penalties: Record<string, number>;
  soft_total: number;
  hard_violations: Violation[];
  hard_violation_count: number;
  hard_by_rule: Record<string, number>;
  warnings: string[];
  bookings?: {
    booking_score: number;
    booking_score_max_if_all_approved: number;
    approved: number;
    alternatives: number;
    rejected: number;
    session_overrides: number;
    priority_inversions: string[];
  };
  exam_soft_penalty?: number;
  stability?: {
    sessions_moved: number;
    time_changed: number;
    room_only_changed: number;
    moved_ids: string[];
  };
};
