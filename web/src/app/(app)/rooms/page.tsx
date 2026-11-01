import { inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty";
import type { BookingDecision } from "@/lib/schemas/schedule";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/session";
import { RoomFinder } from "./finder";

export const metadata: Metadata = { title: "Find a room" };

export default async function RoomsPage() {
  await requireUser();
  const [ds, app] = await Promise.all([
    getActiveDataset(),
    db.query.bookingRequests.findMany({
      where: inArray(schema.bookingRequests.status, ["approved", "alternative_offered"]),
    }),
  ]);
  const version = ds ? await getCurrentVersion(ds.id) : null;
  if (!ds || !version) {
    return (
      <>
        <PageHeader title="Find a room" />
        <EmptyState title="Room availability appears once a timetable has been generated." />
      </>
    );
  }
  const sessions = new Map(ds.json.sessions.map((s) => [s.id, s]));
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
  for (const u of ds.json.room_unavailability) {
    for (const p of u.periods) {
      mark(regular, u.room_id, u.day, p, p, `Closed: ${u.reason ?? "maintenance"}`);
      mark(week7, u.room_id, u.day, p, p, `Closed: ${u.reason ?? "maintenance"}`);
    }
  }
  const overrides = new Map(
    (version.schedule.fest_week?.session_overrides ?? []).map((o) => [o.session_id, o]),
  );
  for (const p of version.schedule.sessions) {
    const s = sessions.get(p.session_id);
    if (!s) continue;
    mark(regular, p.room_id, p.day, p.start_period, p.start_period + s.duration - 1, `${s.id} (class)`);
    const o = overrides.get(p.session_id) ?? p;
    mark(week7, o.room_id, o.day, o.start_period, o.start_period + s.duration - 1, `${s.id} (class)`);
  }
  const titles = new Map(ds.json.booking_requests.map((r) => [r.id, r.title]));
  for (const d of version.schedule.fest_week?.bookings ?? []) {
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
  return (
    <>
      <PageHeader
        title="Find a room"
        description="Free rooms for a time and size, with the features you need."
      />
      <RoomFinder
        rooms={ds.json.rooms.map((r) => ({
          id: r.id,
          name: r.name,
          building: r.building ?? "",
          type: r.type,
          capacity: r.capacity,
          features: r.features,
          accessible: r.accessible,
          allowed_uses: r.allowed_uses,
        }))}
        regular={regular}
        week7={week7}
      />
    </>
  );
}
