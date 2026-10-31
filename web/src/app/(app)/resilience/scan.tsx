"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { JobStatusLine, useJob } from "@/components/workflow/job-progress";
import { cn } from "@/lib/utils";
import type { ResilienceResult } from "@/server/engine";

type Saved = { result: ResilienceResult; versionId: number | null; at: string } | null;

export function ResilienceScan({
  saved,
  currentVersion,
  relay,
}: {
  saved: Saved;
  currentVersion: number;
  relay: boolean;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [starting, setStarting] = useState(false);
  const { job, error, running } = useJob(jobId, (j) => {
    if (j.status === "done") {
      toast.success("Resilience scan finished");
      router.refresh();
    } else toast.error(j.error ?? "Scan failed");
    setJobId(null);
  });

  async function start(depth: "quick" | "deep") {
    setStarting(true);
    const res = await fetch("/api/analysis/resilience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ depth }),
    });
    const body = await res.json().catch(() => ({}));
    setStarting(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not start the scan");
      return;
    }
    setStartedAt(Date.now());
    setJobId(body.jobId);
  }

  const latest = job?.latest as { phase?: string; done?: number; total?: number; label?: string } | null;
  const r = saved?.result;
  const stale = saved && saved.versionId !== currentVersion;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="Run a scan"
          description={
            relay
              ? "Each scenario runs the real minimal-change repair on a 4-CPU GitHub Actions runner. Quick takes about 8 minutes."
              : "Runs a small scan on the always-on engine."
          }
        />
        <div className="grid gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => start("quick")} loading={starting} disabled={running}>
              Quick scan
            </Button>
            <Button onClick={() => start("deep")} disabled={running || starting}>
              Deep scan
            </Button>
          </div>
          {running ? (
            <div className="grid gap-2">
              <JobStatusLine job={job} startedAt={startedAt} />
              {latest?.phase === "scenario" ? (
                <p className="tabular text-[12px] text-gray-9">
                  Scenario {latest.done}/{latest.total}: {latest.label}
                </p>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="text-[12px] text-bad">{error}</p> : null}
        </div>
      </Card>

      {!r ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck className="size-8" strokeWidth={1.5} />}
            title="No scan yet. Run one to see how the timetable copes with lost teachers and closed rooms."
          />
        </Card>
      ) : (
        <>
          {stale ? (
            <p className="rounded-[var(--radius-control)] border border-warn/40 bg-warn-soft px-3 py-2 text-[13px]">
              This scan is for version #{saved?.versionId}; the timetable has changed since. Run it again.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <ScoreRing score={r.summary.score} />
            <Tile
              label="Scenarios"
              value={r.summary.total}
              hint={`${Math.round(r.summary.elapsed_s / 60)} min of solving`}
            />
            <Tile label="Fixable" value={r.summary.fixable} tone="ok" hint="Clash-free repair found" />
            <Tile
              label="No valid fix"
              value={r.summary.infeasible}
              tone={r.summary.infeasible ? "bad" : undefined}
              hint={r.summary.timed_out ? `${r.summary.timed_out} timed out` : "Proven by the solver"}
            />
            <Tile
              label="Median moves"
              value={r.summary.median_moved}
              hint={`Worst case ${r.summary.max_moved}`}
            />
          </div>
          <Card>
            <CardHeader
              title="Scenarios"
              description={`Scanned ${new Date(saved.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}, weakest first`}
            />
            <ul className="divide-y divide-gray-4">
              {[...r.scenarios]
                .sort((a, b) => Number(a.ok) - Number(b.ok) || b.moved - a.moved)
                .map((s) => (
                  <li
                    key={s.id}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px] md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/timetable?view=${s.kind === "faculty_leave" ? "faculty" : "room"}&id=${s.target}`}
                        className="font-medium hover:text-accent"
                      >
                        {s.label}
                      </Link>
                      <p className="text-[11px] text-gray-8">
                        {s.load} h of teaching that day
                        {s.blockers.length ? ` · ${s.blockers[0]}` : ""}
                      </p>
                    </div>
                    <div className="hidden items-center gap-2 md:flex">
                      <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-gray-3">
                        <span
                          className={cn(
                            "absolute inset-y-0 left-0 rounded-full",
                            s.ok ? "bg-accent" : "bg-bad",
                          )}
                          style={{
                            width: `${s.ok ? Math.min(100, (s.moved / Math.max(1, r.summary.max_moved)) * 100) : 100}%`,
                          }}
                        />
                      </span>
                      <span className="tabular w-16 text-right text-[12px] text-gray-9">
                        {s.ok ? `${s.moved} moved` : "—"}
                      </span>
                    </div>
                    <Badge tone={s.ok ? "ok" : s.status === "infeasible" ? "bad" : "warn"}>
                      {s.ok ? "Fixable" : s.status === "infeasible" ? "No fix" : "Timed out"}
                    </Badge>
                  </li>
                ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "ok" | "bad";
}) {
  return (
    <Card className="p-4">
      <p className="text-[12px] text-gray-9">{label}</p>
      <p
        className={cn(
          "mt-1.5 font-display text-[30px] leading-none font-bold tracking-[-0.03em]",
          tone === "ok" && "text-ok",
          tone === "bad" && "text-bad",
        )}
      >
        {value}
      </p>
      <p className="mt-2 truncate text-[11px] text-gray-8">{hint}</p>
    </Card>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <Card className="col-span-2 flex items-center gap-4 p-4 lg:col-span-1">
      <svg viewBox="0 0 64 64" className="size-16 shrink-0 -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--gray-3)" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={score >= 90 ? "var(--ok)" : score >= 70 ? "var(--warn)" : "var(--bad)"}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
        />
      </svg>
      <div>
        <p className="text-[12px] text-gray-9">Resilience</p>
        <p className="font-display text-[30px] leading-none font-bold tracking-[-0.03em]">{score}%</p>
        <p className="mt-1 text-[11px] text-gray-8">of decided scenarios fixable</p>
      </div>
    </Card>
  );
}
