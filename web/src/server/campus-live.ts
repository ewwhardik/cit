import { inArray } from "drizzle-orm";
import type { RoomLite, SlotState } from "@/lib/campus-zones";
import { nowAt } from "@/lib/insights";
import type { Dataset } from "@/lib/schemas/dataset";
import type { BookingDecision, Schedule } from "@/lib/schemas/schedule";
import { DAYS, periodForHour } from "@/lib/time";
import { demoToday } from "@/server/ai/context";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";

export type AppBooking = {
  id: string;
  title: string;
  attendance: number;
  room: string;
  day: string;
  from: number;
  to: number;
};

export function istHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(
      new Date(),
    ),
  );
}

/** The demo week's weekday + the current IST clock, mapped to a teaching period (or the next one). */
export function liveSlot(): { day: string; period: number; isLive: boolean } {
  const weekday = demoToday().weekday;
  const hour = istHour();
  const day = (DAYS as readonly string[]).includes(weekday) ? weekday : "MON";
  const p = periodForHour(hour);
  if (p !== null && p <= 9 && day === weekday) return { day, period: p, isLive: true };
  return { day, period: hour === 13 ? 6 : 1, isLive: false };
}

/** Approved in-app bookings that hold a room. */
export async function loadAppBookings(): Promise<AppBooking[]> {
  const rows = await db.query.bookingRequests.findMany({
    where: inArray(schema.bookingRequests.status, ["approved", "alternative_offered"]),
  });
  return rows
    .map((a) => {
      const d = a.decision as BookingDecision | null;
      const p = a.payload as { title?: string; attendance?: number } | null;
      return {
        id: a.requestId,
        title: p?.title ?? a.requestId,
        attendance: p?.attendance ?? 0,
        room: d?.room_id ?? "",
        day: d?.day ?? "",
        from: d?.start_period ?? 0,
        to: d?.end_period ?? 0,
      };
    })
    .filter((b) => b.room && b.day && b.from && b.to);
}

/** Every teaching slot (DAY|P) with what runs where and which rooms are free. Pure; no queries. */
export function buildSlots(ds: Dataset, schedule: Schedule, appBookings: AppBooking[]) {
  const slots: Record<string, SlotState> = {};
  const facultyName = new Map(ds.faculty.map((f) => [f.id, f.name]));
  const requests = new Map(ds.booking_requests.map((r) => [r.id, r]));
  // Base fest bookings from generated schedule + approved in-app bookings.
  const baseEvents = (schedule.fest_week?.bookings ?? []).flatMap((b) =>
    b.status !== "rejected" && b.day && b.room_id && b.start_period && b.end_period
      ? [
          {
            id: b.request_id,
            title: requests.get(b.request_id)?.title ?? b.request_id,
            room: b.room_id,
            day: b.day,
            from: b.start_period,
            to: b.end_period,
            attendance: requests.get(b.request_id)?.attendance ?? 0,
          },
        ]
      : [],
  );
  const events = [...baseEvents, ...appBookings];
  for (const d of DAYS)
    for (let p = 1; p <= 9; p++) {
      const { running, free } = nowAt(ds, schedule, d, p);
      slots[`${d}|${p}`] = {
        running: running.map((r) => ({
          id: r.id,
          course: r.course,
          room: r.room,
          kind: r.kind,
          groups: r.groups,
          faculty: facultyName.get(r.faculty) ?? "",
          size: r.size,
        })),
        events: events
          .filter((e) => e.day === d && p >= e.from && p <= e.to)
          .map((e) => ({ id: e.id, title: e.title, room: e.room, attendance: e.attendance })),
        free: free.map((r) => ({ id: r.id, capacity: r.capacity, type: r.type })),
      };
    }
  return slots;
}

export function roomLites(ds: Dataset): RoomLite[] {
  return ds.rooms.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    capacity: r.capacity,
    building: r.building ?? "",
    features: r.features,
  }));
}

/** Everything the campus views need, or null before a timetable exists. */
export async function getCampusLive() {
  const ds = await getActiveDataset();
  if (!ds) return null;
  const [version, appBookings] = await Promise.all([getCurrentVersion(ds.id), loadAppBookings()]);
  if (!version) return null;
  return {
    slots: buildSlots(ds.json, version.schedule, appBookings),
    rooms: roomLites(ds.json),
    live: liveSlot(),
  };
}
