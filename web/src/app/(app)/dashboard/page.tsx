import { asc, desc, eq } from "drizzle-orm";
import { CalendarX2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CampusRadar } from "@/components/dashboard/campus-radar";
import { EngineStatus } from "@/components/dashboard/engine-status";
import { DashboardHero } from "@/components/dashboard/hero";
import { WeekNumbers } from "@/components/dashboard/week-numbers";
import { ReportCard } from "@/components/report/report-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { timeAgo } from "@/lib/format";
import {
  campusHeat,
  facultyLoad,
  groupLoad,
  HARD_RULES,
  nextFor,
  qualityGrade,
  seatFit,
  weekNumbers,
} from "@/lib/insights";
import type { Dataset } from "@/lib/schemas/dataset";
import type { Report, Schedule } from "@/lib/schemas/schedule";
import { DAYS, periodRange } from "@/lib/time";
import { roomUtilisation } from "@/lib/timetable";
import { cn } from "@/lib/utils";
import { demoToday } from "@/server/ai/context";
import {
  type AppBooking,
  buildSlots,
  istHour,
  liveSlot,
  loadAppBookings,
  roomLites,
} from "@/server/campus-live";
import { getActiveDataset, getCurrentVersion, getPendingCounts } from "@/server/data";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Dashboard" };

const SOFT_LABEL: Record<string, string> = {
  S1: "Faculty avoided slots",
  S2: "Idle gaps for groups",
  S3: "Groups over 6 h/day",
  S4: "Same course twice a day",
  S5: "Room under 40% full",
  S6: "Classes at 17:00",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const ds = await getActiveDataset();
  // Independent reads in parallel. Pending counts are memoized via React cache from the layout.
  const [version, activity, historyRows, pendingCounts, appBookings] = await Promise.all([
    ds ? getCurrentVersion(ds.id) : Promise.resolve(null),
    db.query.auditLog.findMany({ orderBy: desc(schema.auditLog.at), limit: 8 }),
    ds
      ? db
          .select({ report: schema.timetableVersions.report })
          .from(schema.timetableVersions)
          .where(eq(schema.timetableVersions.datasetRef, ds.id))
          .orderBy(asc(schema.timetableVersions.createdAt))
          .limit(24)
      : Promise.resolve([]),
    getPendingCounts(user.role),
    loadAppBookings(),
  ]);
  const pending = pendingCounts.total;
  const history = historyRows.map((r) => (r.report as Report).soft_total);
  const today = demoToday();
  const numbers = ds && version ? weekNumbers(ds.json, version.schedule, version.report) : null;

  return (
    <>
      <DashboardHero
        name={user.name}
        hour={istHour()}
        demoDate={today.date}
        weekday={today.weekday}
        grade={version ? qualityGrade(version.report.hard_violation_count, version.report.soft_total) : null}
        perDay={numbers?.perDay ?? null}
        actions={
          <div className="flex flex-col items-start gap-1.5 md:items-end">
            <EngineStatus />
            <span className="text-[11px] text-gray-8">
              {ds
                ? `${ds.datasetId}${version ? ` · version #${version.id}, ${timeAgo(version.createdAt)}` : ""}`
                : "No dataset loaded"}
            </span>
          </div>
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
        <Console
          ds={ds.json}
          schedule={version.schedule}
          report={version.report}
          pending={pending}
          facultyId={user.facultyId}
          canApprove={user.role === "admin" || user.role === "dept_coordinator"}
          activity={activity.map((a) => ({ id: a.id, action: a.action, at: a.at }))}
          history={history}
          numbers={numbers!}
          appBookings={appBookings}
        />
      )}
    </>
  );
}

function Console({
  ds,
  schedule,
  report,
  pending,
  facultyId,
  canApprove,
  activity,
  history,
  numbers,
  appBookings,
}: {
  ds: Dataset;
  schedule: Schedule;
  report: Report;
  pending: number;
  facultyId: string | null;
  canApprove: boolean;
  activity: { id: number; action: string; at: Date }[];
  history: number[];
  numbers: NonNullable<ReturnType<typeof weekNumbers>>;
  appBookings: AppBooking[];
}) {
  const live = liveSlot();
  const slots = buildSlots(ds, schedule, appBookings);
  const rooms = roomLites(ds);
  const mine = facultyId ? nextFor(ds, schedule, facultyId, live.day, live.period) : null;
  const next = mine
    ? {
        label: "Your next class",
        detail: `${mine.course} ${mine.kind} · ${mine.day} ${periodRange(mine.start, mine.start + mine.dur - 1)} · ${mine.room}`,
      }
    : null;
  const fit = seatFit(ds, schedule);
  const delta = history.length > 1 ? (history.at(-1) ?? 0) - (history.at(-2) ?? 0) : null;
  const b = report.bookings;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div data-tour="kpis" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Hard violations"
          value={report.hard_violation_count}
          tone={report.hard_violation_count === 0 ? "ok" : "bad"}
          hint={report.hard_violation_count === 0 ? "All 14 rules hold" : "Needs attention"}
          seal={report.hard_violation_count === 0}
        />
        <Kpi
          label="Soft penalty"
          value={report.soft_total}
          hint={
            delta === null
              ? "Lower is kinder"
              : delta === 0
                ? "Same as last version"
                : `${delta > 0 ? "+" : ""}${delta} vs last version`
          }
          spark={history}
        />
        <Kpi
          label="Booking score"
          value={b?.booking_score ?? "–"}
          suffix={b ? `/${b.booking_score_max_if_all_approved}` : ""}
          hint={`${b?.priority_inversions.length ?? 0} priority inversions`}
        />
        <Kpi label="Exam penalty" value={report.exam_soft_penalty ?? "–"} hint="Same-day exams per group" />
        <Kpi
          label="Pending approvals"
          value={pending}
          tone={pending ? "accent" : undefined}
          hint={canApprove ? "Open the inbox" : "Bookings and changes"}
          href={canApprove ? "/approvals" : undefined}
        />
        <Kpi
          label="Avg seat fill"
          value={`${Math.round(fit.avg * 100)}%`}
          hint={`${fit.buckets[0]} sessions under 40%`}
        />
      </div>

      <WeekNumbers
        n={numbers}
        approvalRate={b ? b.approved / Math.max(1, b.approved + b.alternatives + b.rejected) : null}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div data-tour="now" className="min-w-0">
          <CampusRadar slots={slots} live={live} next={next} rooms={rooms} />
        </div>
        <ConstraintMonitor report={report} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
        <PeakHours ds={ds} schedule={schedule} />
        <FacultyLoad ds={ds} schedule={schedule} highlight={facultyId} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <GroupLoad ds={ds} schedule={schedule} />
        <div className="grid gap-4">
          {b ? <SpectraSummary b={b} /> : null}
          <Card>
            <CardHeader title="Recent activity" />
            {activity.length ? (
              <ul className="divide-y divide-gray-4">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                    <span className="truncate">{a.action.replaceAll("_", " ")}</span>
                    <span className="tabular shrink-0 text-[11px] text-gray-8">{timeAgo(a.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing yet." />
            )}
          </Card>
        </div>
      </div>

      <Utilisation ds={ds} schedule={schedule} />
      {report.hard_violation_count ? <ReportCard report={report} /> : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  suffix,
  hint,
  tone,
  href,
  spark,
  seal,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  hint?: string;
  tone?: "ok" | "bad" | "accent";
  href?: string;
  spark?: number[];
  seal?: boolean;
}) {
  const body = (
    <Card className={cn("kpi relative h-full min-w-0 overflow-hidden p-4", href && "hover:border-accent")}>
      <p className="truncate text-[12px] text-gray-9">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span
          className={cn(
            "font-display text-[30px] leading-none font-bold tracking-[-0.03em]",
            tone === "ok" && "text-ok",
            tone === "bad" && "text-bad",
            tone === "accent" && "text-accent",
          )}
        >
          {value}
        </span>
        {suffix ? <span className="tabular text-[13px] text-gray-8">{suffix}</span> : null}
      </p>
      {hint ? <p className="mt-2 truncate text-[11px] text-gray-8">{hint}</p> : null}
      {seal ? (
        <span
          aria-hidden
          className="kpi-seal absolute top-3 right-3 grid size-7 place-items-center rounded-full bg-ok-soft text-ok"
        >
          <svg viewBox="0 0 16 16" className="size-3.5">
            <path
              d="M3.5 8.5l3 3 6-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}
      {spark && spark.length > 1 ? <Spark values={spark} /> : null}
    </Card>
  );
  return href ? (
    <Link href={href as never} className="block min-w-0">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Tiny trend line pinned to the tile's corner. */
function Spark({ values }: { values: number[] }) {
  const w = 64;
  const h = 22;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const pts = values.map(
    (v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`,
  );
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="absolute top-3.5 right-3 h-[22px] w-16" aria-hidden>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx={pts.at(-1)?.split(",")[0]} cy={pts.at(-1)?.split(",")[1]} r="2.2" fill="var(--accent)" />
    </svg>
  );
}

function ConstraintMonitor({ report }: { report: Report }) {
  const soft = Object.entries(report.soft_penalties);
  const maxSoft = Math.max(1, ...soft.map(([, v]) => v));
  return (
    <Card data-tour="rules" className="min-w-0">
      <CardHeader
        title="Constraint monitor"
        description="Checked by the deterministic engine on every change"
        action={
          <Badge tone={report.hard_violation_count ? "bad" : "ok"}>
            {report.hard_violation_count ? `${report.hard_violation_count} failing` : "All passing"}
          </Badge>
        }
      />
      <div className="grid gap-4 p-4">
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
          {HARD_RULES.map((r) => {
            const n = report.hard_by_rule[r.code] ?? 0;
            return (
              <li
                key={r.code}
                title={n ? `${n} violation(s)` : "Holds"}
                className={cn(
                  "flex items-center gap-2 rounded-[var(--radius-control)] border px-2 py-1.5 text-[12px]",
                  n ? "border-bad/40 bg-bad-soft" : "border-gray-4",
                )}
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", n ? "bg-bad" : "bg-ok")} />
                <span className="tabular w-7 shrink-0 text-[11px] text-gray-8">{r.code}</span>
                <span className="truncate">{r.label}</span>
                {n ? <span className="tabular ml-auto text-bad">{n}</span> : null}
              </li>
            );
          })}
        </ul>
        <div>
          <p className="mb-2 flex items-baseline justify-between text-[12px] text-gray-9">
            Soft penalty breakdown <span className="tabular text-gray-10">{report.soft_total} total</span>
          </p>
          <ul className="grid gap-1.5">
            {soft.map(([k, v]) => (
              <li key={k} className="grid grid-cols-[28px_1fr_32px] items-center gap-2 text-[12px]">
                <span className="tabular text-[11px] text-gray-8">{k}</span>
                <span className="relative h-5 overflow-hidden rounded-[5px] bg-gray-2">
                  <span
                    className="absolute inset-y-0 left-0 rounded-[5px] bg-accent/25"
                    style={{ width: `${(v / maxSoft) * 100}%` }}
                  />
                  <span className="relative px-2 leading-5 text-gray-9">{SOFT_LABEL[k] ?? k}</span>
                </span>
                <span className={cn("tabular text-right", v ? "text-gray-10" : "text-gray-7")}>{v}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function PeakHours({ ds, schedule }: { ds: Dataset; schedule: Schedule }) {
  const { grid, teaching, max } = campusHeat(ds, schedule);
  const busiest = DAYS.flatMap((d) => (grid[d] ?? []).map((n, i) => ({ d, p: i + 1, n }))).sort(
    (a, b) => b.n - a.n,
  )[0];
  return (
    <Card className="min-w-0">
      <CardHeader
        title="Peak hours"
        description={`Teaching rooms in use, out of ${teaching}`}
        action={
          busiest ? (
            <Badge tone="accent">
              Busiest {busiest.d} P{busiest.p} · {busiest.n}
            </Badge>
          ) : null
        }
      />
      <div className="overflow-x-auto p-4">
        <div className="grid min-w-[440px] grid-cols-[40px_repeat(5,1fr)_10px_repeat(4,1fr)] gap-[3px] text-[11px]">
          <span />
          {Array.from({ length: 9 }, (_, i) => i + 1).map((p) => (
            <span key={p} className={cn("tabular text-center text-gray-8", p === 6 && "col-start-8")}>
              P{p}
            </span>
          ))}
          {DAYS.map((d) => (
            <PeakRow key={d} day={d} row={grid[d] ?? []} max={max} teaching={teaching} />
          ))}
        </div>
        <p className="mt-3 text-[11px] text-gray-8">
          The gap is lunch (13:00–14:00). Darker means more rooms taken.
        </p>
      </div>
    </Card>
  );
}

function PeakRow({ day, row, max, teaching }: { day: string; row: number[]; max: number; teaching: number }) {
  return (
    <>
      <span className="tabular self-center text-gray-9">{day}</span>
      {row.map((n, i) => (
        <span
          key={`${day}-P${i + 1}`}
          title={`${day} P${i + 1}: ${n} of ${teaching} rooms`}
          className={cn("tabular grid h-8 place-items-center rounded-[6px]", i === 5 && "col-start-8")}
          style={{
            background: `color-mix(in oklch, var(--accent) ${Math.round((n / max) * 80)}%, var(--gray-2))`,
            color: n / max > 0.55 ? "var(--accent-fg)" : "var(--gray-9)",
          }}
        >
          {n || ""}
        </span>
      ))}
    </>
  );
}

function FacultyLoad({
  ds,
  schedule,
  highlight,
}: {
  ds: Dataset;
  schedule: Schedule;
  highlight: string | null;
}) {
  const rows = facultyLoad(ds, schedule);
  const atLimit = rows.filter((r) => r.peak >= r.limit).length;
  const top = rows.slice(0, 8);
  const me = highlight ? rows.find((r) => r.id === highlight) : undefined;
  if (me && !top.includes(me)) top.push(me);
  return (
    <Card className="min-w-0">
      <CardHeader
        title="Faculty load"
        description="Busiest day against the daily limit, plus weekly hours"
        action={<Badge tone={atLimit ? "warn" : "ok"}>{atLimit} at daily limit</Badge>}
      />
      <ul className="grid gap-2 p-4">
        {top.map((r) => (
          <li key={r.id} className="grid grid-cols-[minmax(0,140px)_1fr_64px] items-center gap-3 text-[12px]">
            <Link
              href={`/timetable?view=faculty&id=${r.id}`}
              className={cn("truncate hover:text-accent", r.id === highlight && "font-semibold text-accent")}
              title={`${r.name} · ${r.dept}`}
            >
              {r.id} · {r.name}
            </Link>
            <span className="flex gap-0.5" title={DAYS.map((d) => `${d} ${r.perDay[d]}h`).join(" · ")}>
              {DAYS.map((d) => {
                const h = r.perDay[d] ?? 0;
                return (
                  <span key={d} className="relative h-5 flex-1 overflow-hidden rounded-[4px] bg-gray-2">
                    <span
                      className={cn("absolute inset-x-0 bottom-0", h >= r.limit ? "bg-warn" : "bg-accent/60")}
                      style={{ height: `${Math.min(100, (h / r.limit) * 100)}%` }}
                    />
                  </span>
                );
              })}
            </span>
            <span className="tabular text-right text-gray-9">
              <span className={r.peak >= r.limit ? "text-[color:var(--warn)]" : "text-gray-10"}>
                {r.peak}
              </span>
              /{r.limit} · {r.week}h
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GroupLoad({ ds, schedule }: { ds: Dataset; schedule: Schedule }) {
  const rows = groupLoad(ds, schedule);
  const over = rows.reduce((n, r) => n + r.overSix.length, 0);
  return (
    <Card className="min-w-0">
      <CardHeader
        title="Student day-load"
        description="Class hours per group per day (more than 6 is a soft penalty)"
        action={<Badge tone={over ? "warn" : "ok"}>{over ? `${over} long days` : "No day over 6 h"}</Badge>}
      />
      <div className="overflow-x-auto p-4">
        <table className="w-full min-w-[420px] border-separate border-spacing-[3px] text-[12px]">
          <thead>
            <tr className="text-gray-8">
              <th className="w-24 text-left font-medium">Group</th>
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
              <tr key={r.id}>
                <td className="truncate">
                  <Link
                    href={`/timetable?view=group&id=${r.id}`}
                    className="tabular hover:text-accent"
                    title={r.name}
                  >
                    {r.id}
                  </Link>
                </td>
                {DAYS.map((d) => {
                  const h = r.perDay[d] ?? 0;
                  return (
                    <td
                      key={d}
                      title={`${r.id} ${d}: ${h} h`}
                      className={cn(
                        "tabular h-6 rounded-[4px] text-center text-[11px]",
                        h > 6 && "ring-1 ring-warn",
                      )}
                      style={{
                        background: `color-mix(in oklch, var(--kind-tutorial) ${Math.round((h / 8) * 70)}%, var(--gray-2))`,
                        color: h > 4 ? "var(--surface)" : "var(--gray-9)",
                      }}
                    >
                      {h || ""}
                    </td>
                  );
                })}
                <td className="tabular text-right text-gray-9">{r.week}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SpectraSummary({ b }: { b: NonNullable<Report["bookings"]> }) {
  const total = b.approved + b.alternatives + b.rejected || 1;
  const parts = [
    { label: "Approved", n: b.approved, color: "var(--ok)" },
    { label: "Alternative", n: b.alternatives, color: "var(--warn)" },
    { label: "Rejected", n: b.rejected, color: "var(--bad)" },
  ];
  return (
    <Card>
      <CardHeader
        title="Spectra week"
        description={`${b.session_overrides} classes moved for institute events · ${b.priority_inversions.length} priority inversions`}
        action={
          <Link href="/spectra" className="text-[12px] text-accent hover:underline">
            Decisions →
          </Link>
        }
      />
      <div className="p-4">
        <div className="flex h-3 overflow-hidden rounded-full bg-gray-2">
          {parts.map((p) => (
            <span key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: p.color }} />
              <span className="text-gray-9">{p.label}</span>
              <span className="tabular font-medium">{p.n}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function Utilisation({ ds, schedule }: { ds: Dataset; schedule: Schedule }) {
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
