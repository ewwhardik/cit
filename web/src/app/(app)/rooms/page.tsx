import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty";
import { busyMaps } from "@/server/availability";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { requireUser } from "@/server/session";
import { RoomFinder } from "./finder";

export const metadata: Metadata = { title: "Find a room" };

export default async function RoomsPage() {
  await requireUser();
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  if (!ds || !version) {
    return (
      <>
        <PageHeader title="Find a room" />
        <EmptyState title="Room availability appears once a timetable has been generated." />
      </>
    );
  }
  const { regular, week7 } = await busyMaps(ds.json, version.schedule);
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
