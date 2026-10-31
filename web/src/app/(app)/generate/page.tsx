import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ReportCard } from "@/components/report/report-card";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { requireRole } from "@/server/session";
import { GeneratePanel } from "./panel";

export const metadata: Metadata = { title: "Generate" };

export default async function GeneratePage() {
  await requireRole("admin");
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  return (
    <>
      <PageHeader
        title="Generate timetable"
        description="Builds the weekly timetable, the midsem exam schedule and the Spectra-week booking decisions in one run. Every result is checked before it is stored."
      />
      <div className="grid gap-5">
        <GeneratePanel
          hasDataset={!!ds}
          datasetLabel={
            ds
              ? `${ds.datasetId} · ${ds.json.sessions.length} sessions · ${ds.json.rooms.length} rooms`
              : null
          }
        />
        {version ? (
          <ReportCard report={version.report} title={`Current timetable (version #${version.id})`} />
        ) : null}
      </div>
    </>
  );
}
