import { readFile } from "node:fs/promises";
import path from "node:path";
import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge, statusTone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { describeChange } from "@/lib/changes";
import { timeAgo } from "@/lib/format";
import type { ChangeFile } from "@/lib/schemas/dataset";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";
import { requireRole } from "@/server/session";
import { DisruptionPanel } from "./panel";

export const metadata: Metadata = { title: "Disruptions" };

async function sampleChangeFile(): Promise<string | null> {
  try {
    const p =
      process.env.DEMO_DISRUPTION_PATH ??
      path.join(process.cwd(), "..", "starter", "examples", "sample_disruption.json");
    return await readFile(/*turbopackIgnore: true*/ p, "utf-8");
  } catch {
    return null;
  }
}

export default async function DisruptionsPage() {
  await requireRole("admin");
  const ds = await getActiveDataset();
  const [version, history, proposals, sample] = await Promise.all([
    ds ? getCurrentVersion(ds.id) : Promise.resolve(null),
    db.query.disruptions.findMany({
      orderBy: desc(schema.disruptions.createdAt),
      limit: 20,
    }),
    db.query.proposals.findMany({
      orderBy: desc(schema.proposals.createdAt),
      limit: 50,
    }),
    sampleChangeFile(),
  ]);
  const sessions = new Map((ds?.json.sessions ?? []).map((s) => [s.id, s]));
  const placed = (version?.schedule.sessions ?? []).flatMap((p) => {
    const s = sessions.get(p.session_id);
    return s
      ? [
          {
            id: s.id,
            course: s.course_id,
            faculty: s.faculty_id,
            groups: s.groups,
            room: p.room_id,
            day: p.day,
            start: p.start_period,
            dur: s.duration,
          },
        ]
      : [];
  });
  const byDisruption = new Map(proposals.filter((p) => p.disruptionId).map((p) => [p.disruptionId, p.id]));
  return (
    <>
      <PageHeader
        title="Disruptions"
        description="Load a change file (faculty leave, room closure, new or removed sessions). The engine proposes the fix that moves the fewest sessions; nothing changes until an Admin approves it."
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <DisruptionPanel hasTimetable={!!version} sample={sample} placed={placed} />
        <Card className="h-fit">
          <CardHeader title="History" />
          {history.length ? (
            <ul className="divide-y divide-gray-4">
              {history.map((d) => {
                const file = d.json as ChangeFile & { description?: string };
                const pid = byDisruption.get(d.id);
                return (
                  <li key={d.id} className="grid gap-1 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium">
                        Change file #{d.id}{" "}
                        <span className="font-normal text-gray-8">· {timeAgo(d.createdAt)}</span>
                      </p>
                      <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                    </div>
                    {file.changes.slice(0, 4).map((c, i) => (
                      <p key={i} className="truncate text-[12px] text-gray-9">
                        {describeChange(c)}
                      </p>
                    ))}
                    {pid ? (
                      <Link href={`/approvals/p/${pid}`} className="text-[12px] text-accent hover:underline">
                        Review proposal →
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No change files yet." />
          )}
        </Card>
      </div>
    </>
  );
}
