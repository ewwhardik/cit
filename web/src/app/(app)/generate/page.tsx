import { and, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ReportCard } from "@/components/report/report-card";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";
import { relayEnabled } from "@/server/relay";
import { requireRole } from "@/server/session";
import { GeneratePanel } from "./panel";

export const metadata: Metadata = { title: "Generate" };

export default async function GeneratePage() {
  await requireRole("admin");
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  const activeJob = ds
    ? await db.query.jobs.findFirst({
        where: and(
          eq(schema.jobs.kind, "generate"),
          eq(schema.jobs.datasetRef, ds.id),
          inArray(schema.jobs.status, ["queued", "running"]),
        ),
        orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
      })
    : null;
  const activeJobId =
    activeJob && Date.now() - activeJob.createdAt.getTime() < 10 * 60_000 ? activeJob.id : null;

  return (
    <>
      <PageHeader
        title="Generate timetable"
        description="Builds the weekly timetable, the midsem exam schedule and the Spectra-week booking decisions in one run. Every result is checked before it is stored."
      />
      <div className="grid gap-5">
        <GeneratePanel
          hasDataset={!!ds}
          relay={relayEnabled()}
          activeJobId={activeJobId}
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
