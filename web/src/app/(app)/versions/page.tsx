import { desc, eq } from "drizzle-orm";
import { History } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { timeAgo } from "@/lib/format";
import type { Report, Schedule } from "@/lib/schemas/schedule";
import { cn } from "@/lib/utils";
import { getActiveDataset } from "@/server/data";
import { db, schema } from "@/server/db";
import { requireRole } from "@/server/session";
import { RestoreButton } from "./restore";

export const metadata: Metadata = { title: "Versions" };

const KIND_LABEL: Record<string, string> = {
  base: "Generated",
  applied: "Approved change",
  proposal: "Proposal",
};

/** Sessions whose day, start or room differ between two schedules. */
function differs(a: Schedule, b: Schedule) {
  const at = new Map(b.sessions.map((s) => [s.session_id, s]));
  let moved = 0;
  for (const s of a.sessions) {
    const o = at.get(s.session_id);
    if (!o || o.day !== s.day || o.start_period !== s.start_period || o.room_id !== s.room_id) moved++;
  }
  return moved;
}

export default async function VersionsPage() {
  const user = await requireRole("admin", "dept_coordinator");
  const ds = await getActiveDataset();
  const rows = ds
    ? await db
        .select({
          id: schema.timetableVersions.id,
          kind: schema.timetableVersions.kind,
          isCurrent: schema.timetableVersions.isCurrent,
          createdAt: schema.timetableVersions.createdAt,
          schedule: schema.timetableVersions.schedule,
          report: schema.timetableVersions.report,
          author: schema.user.name,
        })
        .from(schema.timetableVersions)
        .leftJoin(schema.user, eq(schema.user.id, schema.timetableVersions.createdBy))
        .where(eq(schema.timetableVersions.datasetRef, ds.id))
        .orderBy(desc(schema.timetableVersions.createdAt))
        .limit(30)
    : [];
  const current = rows.find((r) => r.isCurrent);
  const best = rows.reduce<number | null>((m, r) => {
    const rep = r.report as Report;
    return rep.hard_violation_count === 0 && (m === null || rep.soft_total < m) ? rep.soft_total : m;
  }, null);

  return (
    <>
      <PageHeader
        title="Versions"
        description="Every timetable the engine produced or an Admin approved, newest first. Each was validated when stored; only clash-free versions can be restored."
      />
      {!rows.length ? (
        <EmptyState
          icon={<History className="size-8" strokeWidth={1.5} />}
          title="No timetable versions yet."
        />
      ) : (
        <Card>
          <CardHeader
            title={`${rows.length} versions`}
            description="Soft penalty over time (lower is better)"
            action={best !== null ? <Badge tone="ok">Best soft {best}</Badge> : null}
          />
          <Sparkline values={[...rows].reverse().map((r) => (r.report as Report).soft_total)} />
          <ul className="divide-y divide-gray-4">
            {rows.map((r) => {
              const rep = r.report as Report;
              const moved =
                current && current.id !== r.id
                  ? differs(r.schedule as Schedule, current.schedule as Schedule)
                  : 0;
              return (
                <li
                  key={r.id}
                  className={cn(
                    "grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px] md:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,90px))_minmax(0,110px)_auto]",
                    r.isCurrent && "bg-accent-soft/50",
                  )}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      #{r.id} · {KIND_LABEL[r.kind] ?? r.kind}
                      {r.isCurrent ? <Badge tone="accent">Current</Badge> : null}
                    </p>
                    <p className="truncate text-[11px] text-gray-8">
                      {timeAgo(r.createdAt)} · {r.author ?? "Scheduling engine"}
                    </p>
                  </div>
                  <Stat label="Hard" value={rep.hard_violation_count} bad={rep.hard_violation_count > 0} />
                  <Stat label="Soft" value={rep.soft_total} good={rep.soft_total === best} />
                  <Stat label="Booking" value={rep.bookings?.booking_score ?? "–"} />
                  <span className="tabular hidden text-[12px] text-gray-9 md:block">
                    {r.isCurrent ? "—" : `${moved} differ from current`}
                  </span>
                  {user.role === "admin" && !r.isCurrent && rep.hard_violation_count === 0 ? (
                    <RestoreButton id={r.id} />
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: number | string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <span className="hidden md:block">
      <span className="block text-[10px] text-gray-8 uppercase">{label}</span>
      <span className={cn("tabular font-medium", good && "text-ok", bad && "text-bad")}>{value}</span>
    </span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 600;
  const h = 56;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const pts = values.map(
    (v, i) => `${(i / (values.length - 1)) * w},${h - 6 - ((v - min) / span) * (h - 12)}`,
  );
  return (
    <div className="border-b border-gray-4 px-4 py-3">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-14 w-full" aria-hidden>
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
