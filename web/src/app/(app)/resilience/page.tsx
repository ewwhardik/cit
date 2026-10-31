import { eq } from "drizzle-orm";
import { CalendarX2 } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";
import type { ResilienceResult } from "@/server/engine";
import { relayEnabled } from "@/server/relay";
import { requireRole } from "@/server/session";
import { ResilienceScan } from "./scan";

export const metadata: Metadata = { title: "Resilience" };

export default async function ResiliencePage() {
  await requireRole("admin", "dept_coordinator");
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, "analysis:resilience") });
  const saved = (row?.value ?? null) as {
    result: ResilienceResult;
    versionId: number | null;
    at: string;
  } | null;

  return (
    <>
      <PageHeader
        title="Resilience"
        description="What if the busiest teachers or rooms are lost for a day? Each scenario is repaired by the real engine; nothing is applied."
      />
      {!version ? (
        <EmptyState
          icon={<CalendarX2 className="size-8" strokeWidth={1.5} />}
          title="Generate a timetable first."
        />
      ) : (
        <ResilienceScan saved={saved} currentVersion={version.id} relay={relayEnabled()} />
      )}
    </>
  );
}
