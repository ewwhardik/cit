import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { requireRole } from "@/server/session";
import { DataActions } from "./actions-panel";

export const metadata: Metadata = { title: "Data" };

export default async function DataPage() {
  await requireRole("admin");
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  const counts = ds
    ? [
        ["Rooms", ds.json.rooms.length],
        ["Faculty", ds.json.faculty.length],
        ["Student groups", ds.json.student_groups.length],
        ["Sessions", ds.json.sessions.length],
        ["Booking requests", ds.json.booking_requests.length],
        ["Exams", ds.json.exams.length],
      ]
    : [];
  return (
    <>
      <PageHeader
        title="Data"
        description="Load a dataset in the starter-pack format, reset the demo, or export schedule.json."
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Active dataset" description={ds ? ds.datasetId : "None loaded"} />
          {ds ? (
            <dl className="grid grid-cols-2 gap-px bg-gray-4 sm:grid-cols-3">
              {counts.map(([k, v]) => (
                <div key={k} className="bg-surface px-4 py-3">
                  <dt className="text-[12px] text-gray-9">{k}</dt>
                  <dd className="tabular text-[18px] font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Card>
        <DataActions hasVersion={!!version} />
      </div>
    </>
  );
}
