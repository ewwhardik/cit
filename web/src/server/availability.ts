import "server-only";
import { inArray } from "drizzle-orm";
import type { Dataset } from "@/lib/schemas/dataset";
import type { BookingDecision, Schedule } from "@/lib/schemas/schedule";
import { db, schema } from "./db";

/** Busy cells per room: key "ROOM|DAY|P" -> what occupies it. Regular week and Spectra week (Week 7). */
export type BusyMaps = { regular: Record<string, string>; week7: Record<string, string> };

export async function busyMaps(ds: Dataset, schedule: Schedule): Promise<BusyMaps> {
  const sessions = new Map(ds.sessions.map((s) => [s.id, s]));
  const regular: Record<string, string> = {};
  const week7: Record<string, string> = {};
  const mark = (
    map: Record<string, string>,
    room: string,
    day: string,
    from: number,
    to: number,
    label: string,
  ) => {
    for (let p = from; p <= to; p++) map[`${room}|${day}|${p}`] ??= label;
  };
  for (const u of ds.room_unavailability) {
    for (const p of u.periods) {
      mark(regular, u.room_id, u.day, p, p, `Closed: ${u.reason ?? "maintenance"}`);
      mark(week7, u.room_id, u.day, p, p, `Closed: ${u.reason ?? "maintenance"}`);
    }
  }
  const overrides = new Map((schedule.fest_week?.session_overrides ?? []).map((o) => [o.session_id, o]));
  for (const p of schedule.sessions) {
    const s = sessions.get(p.session_id);
    if (!s) continue;
    mark(regular, p.room_id, p.day, p.start_period, p.start_period + s.duration - 1, `${s.id} (class)`);
    const o = overrides.get(p.session_id) ?? p;
    mark(week7, o.room_id, o.day, o.start_period, o.start_period + s.duration - 1, `${s.id} (class)`);
  }
  const titles = new Map(ds.booking_requests.map((r) => [r.id, r.title]));
  for (const d of schedule.fest_week?.bookings ?? []) {
    if (d.room_id && d.day && d.start_period && d.end_period)
      mark(
        week7,
        d.room_id,
        d.day,
        d.start_period,
        d.end_period,
        `${titles.get(d.request_id) ?? d.request_id} (event)`,
      );
  }
  const app = await db.query.bookingRequests.findMany({
    where: inArray(schema.bookingRequests.status, ["approved", "alternative_offered"]),
  });
  for (const a of app) {
    const d = a.decision as BookingDecision | null;
    if (d?.room_id && d.day && d.start_period && d.end_period)
      mark(
        week7,
        d.room_id,
        d.day,
        d.start_period,
        d.end_period,
        `${(a.payload as { title?: string }).title ?? a.requestId} (booking)`,
      );
  }
  return { regular, week7 };
}

export type FreeRoomQuery = {
  day: string;
  from_period: number;
  to_period: number;
  min_capacity?: number;
  needs?: string[];
  spectra_week?: boolean;
};

/** Rooms free for the whole span, snuggest first. Evening spans (P10+) only consider event venues. */
export function freeRooms(ds: Dataset, maps: BusyMaps, q: FreeRoomQuery) {
  const busy = q.spectra_week ? maps.week7 : maps.regular;
  const from = Math.max(1, Math.min(13, q.from_period));
  const to = Math.max(from, Math.min(13, q.to_period));
  return ds.rooms
    .filter((r) => r.capacity >= (q.min_capacity ?? 1))
    .filter((r) => (q.needs ?? []).every((n) => (n === "accessible" ? r.accessible : r.features.includes(n))))
    .filter((r) => (to >= 10 ? r.allowed_uses.includes("event") : true))
    .filter((r) => {
      for (let p = from; p <= to; p++) if (busy[`${r.id}|${q.day}|${p}`]) return false;
      return true;
    })
    .sort((a, b) => a.capacity - b.capacity)
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      capacity: r.capacity,
      features: r.features,
      accessible: r.accessible,
    }));
}

/** Free teaching periods for a student group on each day. */
export function groupFreePeriods(ds: Dataset, schedule: Schedule, groupId: string) {
  const sessions = new Map(ds.sessions.map((s) => [s.id, s]));
  const busy = new Set<string>();
  for (const p of schedule.sessions) {
    const s = sessions.get(p.session_id);
    if (!s?.groups.includes(groupId)) continue;
    for (let q = p.start_period; q < p.start_period + s.duration; q++) busy.add(`${p.day}|${q}`);
  }
  const out: Record<string, number[]> = {};
  for (const d of ["MON", "TUE", "WED", "THU", "FRI"]) {
    out[d] = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((p) => !busy.has(`${d}|${p}`));
  }
  return out;
}
