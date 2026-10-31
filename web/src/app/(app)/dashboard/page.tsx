import { desc } from "drizzle-orm";
import { CalendarX2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ReportCard } from "@/components/report/report-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { DAYS } from "@/lib/time";
import { roomUtilisation } from "@/lib/timetable";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  const activity = await db.query.auditLog.findMany({ orderBy: desc(schema.auditLog.at), limit: 8 });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          ds ? `Signed in as ${user.name} · ${ds.datasetId} · Week 7 is Spectra week` : "No dataset loaded"
        }
      />
      {sp.denied ? (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius-control)] border border-warn/40 bg-warn-soft px-3 py-2 text-[13px]"
        >
          That page needs a different role.
        </p>
      ) : null}

      {!version || !ds ? (
        <Card>
          <EmptyState
            icon={<CalendarX2 className="size-8" strokeWidth={1.5} />}
            title={ds ? "No timetable has been generated yet." : "No dataset is loaded yet."}
            action={
              user.role === "admin" ? (
                <Link href={ds ? "/generate" : "/data"}>
                  <Button variant="primary">{ds ? "Generate timetable" : "Load dataset"}</Button>
                </Link>
              ) : (
                <span className="text-[12px] text-gray-8">An Admin needs to generate it first.</span>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Hard violations"
              value={version.report.hard_violation_count}
              tone={version.report.hard_violation_count === 0 ? "ok" : "bad"}
              hint="Clashes, capacity, availability"
            />
            <Kpi label="Soft penalty" value={version.report.soft_total} hint="Lower is better" />
            <Kpi
              label="Booking score"
              value={version.report.bookings?.booking_score ?? "–"}
              suffix={
                version.report.bookings
                  ? ` / ${version.report.bookings.booking_score_max_if_all_approved}`
                  : ""
              }
              hint={`${version.report.bookings?.priority_inversions.length ?? 0} priority inversions`}
            />
            <Kpi
              label="Exam penalty"
              value={version.report.exam_soft_penalty ?? "–"}
              hint="Same-day exams per group"
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Utilisation ds={ds.json} schedule={version.schedule} />
            <Card>
              <CardHeader title="Recent activity" />
              {activity.length ? (
                <ul className="divide-y divide-gray-4">
                  {activity.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
                    >
                      <span className="truncate">{a.action.replaceAll("_", " ")}</span>
                      <span className="tabular shrink-0 text-[11px] text-gray-8">
                        {a.at.toISOString().slice(0, 16).replace("T", " ")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nothing yet." />
              )}
            </Card>
          </div>
          <ReportCard report={version.report} />
        </div>
      )}
    </>
  );
}

function Kpi({
  label,
  value,
  suffix,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  hint?: string;
  tone?: "ok" | "bad";
}) {
  return (
    <Card className="min-w-0 p-4">
      <p className="truncate text-[12px] text-gray-9">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span
          className={`tabular text-[28px] leading-none font-semibold ${tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : ""}`}
        >
          {value}
        </span>
        {suffix ? <span className="tabular text-[13px] text-gray-8">{suffix}</span> : null}
      </p>
      {hint ? <p className="mt-1.5 truncate text-[11px] text-gray-8">{hint}</p> : null}
    </Card>
  );
}

function Utilisation({
  ds,
  schedule,
}: {
  ds: Parameters<typeof roomUtilisation>[0];
  schedule: Parameters<typeof roomUtilisation>[1];
}) {
  const rows = roomUtilisation(ds, schedule).sort((a, b) => b.pct - a.pct);
  return (
    <Card>
      <CardHeader
        title="Room utilisation"
        description="Teaching periods in use per day (out of 9)"
        action={<Badge>{rows.length} rooms</Badge>}
      />
      <div className="overflow-x-auto p-4">
        <table className="w-full min-w-[420px] border-separate border-spacing-[3px] text-[12px]">
          <thead>
            <tr className="text-gray-8">
              <th className="w-20 text-left font-medium">Room</th>
              {DAYS.map((d) => (
                <th key={d} className="font-medium">
                  {d}
                </th>
              ))}
              <th className="w-12 text-right font-medium">Week</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.room.id}>
                <td className="tabular truncate text-gray-10">
                  <Link href={`/timetable?view=room&id=${r.room.id}`} className="hover:text-accent">
                    {r.room.id}
                  </Link>
                </td>
                {DAYS.map((d) => {
                  const n = r.cells[d] ?? 0;
                  return (
                    <td
                      key={d}
                      title={`${r.room.id} ${d}: ${n}/9 periods`}
                      className="tabular h-6 rounded-[4px] text-center text-[11px]"
                      style={{
                        background: `color-mix(in oklch, var(--accent) ${Math.round((n / 9) * 85)}%, var(--gray-2))`,
                        color: n > 5 ? "var(--accent-fg)" : "var(--gray-9)",
                      }}
                    >
                      {n || ""}
                    </td>
                  );
                })}
                <td className="tabular text-right text-gray-9">{Math.round(r.pct * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
