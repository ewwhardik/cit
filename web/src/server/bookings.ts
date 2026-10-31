import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { type BookingSubmission, capCategory, DATASET_ROLE, type RoleKey } from "@/lib/booking/draft";
import type { Dataset } from "@/lib/schemas/dataset";
import type { BookingDecision, Schedule } from "@/lib/schemas/schedule";
import { audit, getActiveDataset, getCurrentVersion } from "./data";
import { db, schema } from "./db";
import { engine } from "./engine";
import { WorkflowError } from "./proposals";
import type { CurrentUser } from "./session";

/** Labs and the department that approves bookings of them (PLAN.md §6.3, PDF §4). */
export function labDepartments(roomType: string, roomId: string): string[] {
  if (roomType === "lab_cs") return ["CSE"];
  if (roomType === "lab_elec") return ["ECE", "EE"];
  if (roomType === "workshop") return ["ME"];
  if (roomType === "lab_civil") return ["CE"];
  if (roomType === "lab_phy" || roomId === "PHY-LAB") return ["COMMON"];
  return [];
}

export type CheckOutcome = {
  status: "approved" | "alternative_offered" | "rejected";
  reason: string;
  room_id?: string;
  day?: string;
  start_period?: number;
  end_period?: number;
  options?: { room_id: string; day: string; start_period: number; end_period: number; approved: boolean }[];
};

/** Dataset-format request built from a submission; the category is capped by the *authenticated* role. */
export function toRequest(user: CurrentUser, sub: BookingSubmission, id: string, submittedAt: string) {
  const role = user.role as RoleKey;
  return {
    id,
    submitted_at: submittedAt,
    requester: user.clubName ?? user.department ?? user.name,
    role: DATASET_ROLE[role],
    department: user.department,
    requested_category: capCategory(role, sub.category),
    title: sub.title,
    attendance: sub.attendance,
    duration_periods: sub.duration_periods,
    windows: sub.windows,
    room_types: sub.room_types,
    needs: sub.needs,
    requested_room: sub.requested_room,
    mandatory_for_groups: sub.mandatory_for_groups,
    series_id: null as string | null,
    raw_text: sub.raw_text ?? "",
  };
}

/** The Week-7 schedule the engine checks against: current timetable + Spectra decisions + approved app bookings. */
export async function liveWeek(
  excludeRequestId?: string,
): Promise<{ ds: Dataset; schedule: Schedule; datasetRef: number; versionId: number }> {
  const ds = await getActiveDataset();
  if (!ds) throw new WorkflowError("No dataset is loaded yet.", 409);
  const version = await getCurrentVersion(ds.id);
  if (!version)
    throw new WorkflowError("No timetable has been generated yet, so availability can't be checked.", 409);
  const placed = await db.query.bookingRequests.findMany({
    where: inArray(schema.bookingRequests.status, ["approved", "alternative_offered"]),
  });
  const extra: BookingDecision[] = placed
    .filter((b) => b.requestId !== excludeRequestId)
    .map((b) => b.decision as BookingDecision | null)
    .filter((d): d is BookingDecision => !!d?.room_id);
  const fest = version.schedule.fest_week ?? { bookings: [], session_overrides: [] };
  return {
    ds: ds.json,
    datasetRef: ds.id,
    versionId: version.id,
    schedule: { ...version.schedule, fest_week: { ...fest, bookings: [...fest.bookings, ...extra] } },
  };
}

export async function checkRequest(
  request: Record<string, unknown>,
  excludeRequestId?: string,
): Promise<CheckOutcome> {
  const live = await liveWeek(excludeRequestId);
  return (await engine.checkOne({ dataset: live.ds, schedule: live.schedule, request })) as CheckOutcome;
}

/** Recurring requests become one request per day in a series. */
export function expandSeries(sub: BookingSubmission): BookingSubmission[] {
  if (!sub.recurrence_days.length) return [sub];
  const days = [...new Set(sub.recurrence_days)];
  return days.map((day) => ({
    ...sub,
    recurrence_days: [],
    windows: sub.windows.filter((w) => w.day === day).length
      ? sub.windows.filter((w) => w.day === day)
      : sub.windows.map((w) => ({ ...w, day })),
  }));
}

async function nextRequestId(): Promise<string> {
  const rows = await db.select({ id: schema.bookingRequests.id }).from(schema.bookingRequests);
  return `APP-${String(rows.length + 1).padStart(3, "0")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/**
 * Submit: every request in the series is checked by the engine first. If any part
 * has no valid option at all, the submission is blocked with the engine's reason.
 */
export async function submitBooking(user: CurrentUser, sub: BookingSubmission, acceptAlternative: boolean) {
  const parts = expandSeries(sub);
  const seriesId = parts.length > 1 ? `SER-${Math.random().toString(36).slice(2, 8).toUpperCase()}` : null;
  const now = new Date().toISOString();
  const prepared: { id: string; request: ReturnType<typeof toRequest>; outcome: CheckOutcome }[] = [];
  for (const part of parts) {
    const id = await nextRequestId();
    const request = { ...toRequest(user, part, id, now), series_id: seriesId };
    const outcome = await checkRequest(request);
    if (outcome.status === "rejected") {
      throw new WorkflowError(`Blocked: ${outcome.reason}`, 409);
    }
    if (outcome.status === "alternative_offered" && !acceptAlternative) {
      throw new WorkflowError(
        `Not available as requested. ${outcome.reason} Accept the alternative to submit.`,
        409,
      );
    }
    prepared.push({ id, request, outcome });
  }
  const ids: string[] = [];
  for (const p of prepared) {
    const decision: BookingDecision = {
      request_id: p.id,
      status: p.outcome.status,
      room_id: p.outcome.room_id,
      day: p.outcome.day,
      start_period: p.outcome.start_period,
      end_period: p.outcome.end_period,
      reason: p.outcome.reason,
    };
    await db.insert(schema.bookingRequests).values({
      requestId: p.id,
      source: "app",
      requesterUserId: user.id,
      payload: p.request,
      rawText: sub.raw_text ?? null,
      parsedBy: sub.parsed_by,
      status: "pending",
      decision,
      reason: p.outcome.reason,
    });
    ids.push(p.id);
  }
  await audit(user.id, "booking_submitted", `booking:${ids.join(",")}`, null, {
    title: sub.title,
    parts: ids.length,
  });
  return { ids, outcomes: prepared.map((p) => p.outcome) };
}

export async function canDecideBooking(
  user: CurrentUser,
  row: typeof schema.bookingRequests.$inferSelect,
  ds: Dataset,
) {
  if (row.requesterUserId === user.id) return { ok: false, why: "You cannot approve your own request." };
  if (user.role === "admin") return { ok: true, why: "" };
  if (user.role === "dept_coordinator") {
    const d = row.decision as BookingDecision | null;
    const room = ds.rooms.find((r) => r.id === d?.room_id);
    if (room && user.department && labDepartments(room.type, room.id).includes(user.department))
      return { ok: true, why: "" };
    return { ok: false, why: "Coordinators approve bookings of their own department's labs only." };
  }
  return { ok: false, why: "Your role cannot approve bookings." };
}

/** Approve re-checks availability right now (state may have changed since submission). */
export async function decideBooking(
  user: CurrentUser,
  requestId: string,
  action: "approve" | "reject",
  note: string,
) {
  const row = await db.query.bookingRequests.findFirst({
    where: eq(schema.bookingRequests.requestId, requestId),
  });
  if (!row) throw new WorkflowError("Unknown request", 404);
  if (row.status !== "pending")
    throw new WorkflowError(`This request is already ${row.status.replace("_", " ")}.`, 409);
  const live = await liveWeek(requestId);
  const perm = await canDecideBooking(user, row, live.ds);
  if (!perm.ok) throw new WorkflowError(perm.why, 403);

  if (action === "reject") {
    if (!note.trim()) throw new WorkflowError("Give a reason for the rejection.");
    await db
      .update(schema.bookingRequests)
      .set({ status: "rejected", reason: note.trim().slice(0, 500), decidedBy: user.id })
      .where(
        and(eq(schema.bookingRequests.requestId, requestId), eq(schema.bookingRequests.status, "pending")),
      );
    await audit(user.id, "booking_rejected", `booking:${requestId}`, null, { reason: note });
    return { status: "rejected" as const, reason: note };
  }
  const outcome = (await engine.checkOne({
    dataset: live.ds,
    schedule: live.schedule,
    request: row.payload as Record<string, unknown>,
  })) as CheckOutcome;
  if (outcome.status === "rejected") {
    throw new WorkflowError(`No longer possible: ${outcome.reason}`, 409);
  }
  const decision: BookingDecision = {
    request_id: requestId,
    status: outcome.status,
    room_id: outcome.room_id,
    day: outcome.day,
    start_period: outcome.start_period,
    end_period: outcome.end_period,
    reason: outcome.reason,
  };
  await db
    .update(schema.bookingRequests)
    .set({ status: outcome.status, decision, reason: outcome.reason, decidedBy: user.id })
    .where(
      and(eq(schema.bookingRequests.requestId, requestId), eq(schema.bookingRequests.status, "pending")),
    );
  await audit(user.id, "booking_approved", `booking:${requestId}`, row.decision, decision);
  return { status: outcome.status, reason: outcome.reason, decision };
}

export async function cancelBooking(user: CurrentUser, requestId: string) {
  const row = await db.query.bookingRequests.findFirst({
    where: eq(schema.bookingRequests.requestId, requestId),
  });
  if (!row) throw new WorkflowError("Unknown request", 404);
  if (row.requesterUserId !== user.id && user.role !== "admin")
    throw new WorkflowError("Only the requester can cancel.", 403);
  if (row.status === "cancelled" || row.status === "rejected")
    throw new WorkflowError(`Already ${row.status}.`, 409);
  await db
    .update(schema.bookingRequests)
    .set({
      status: "cancelled",
      reason: `Cancelled by ${user.name} on ${new Date().toISOString().slice(0, 10)}.`,
    })
    .where(eq(schema.bookingRequests.requestId, requestId));
  await audit(user.id, "booking_cancelled", `booking:${requestId}`);
}
