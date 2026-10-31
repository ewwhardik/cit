"use client";

import { CheckCircle2, Play, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

type Progress = {
  phase?: string;
  objective?: number;
  bound?: number;
  elapsed_s?: number;
  solutions?: number;
};
type JobView = {
  status: "queued" | "running" | "done" | "failed";
  latest: Progress | null;
  progress: Progress[];
  error: string | null;
  result: {
    status: string;
    diagnostics: string[];
    report: { hard_violation_count: number; soft_total: number } | null;
  } | null;
  versionId: number | null;
};

const PHASE_LABEL: Record<string, string> = {
  feasibility: "Finding a clash-free timetable",
  optimise: "Optimising soft constraints and Spectra space",
  exams: "Scheduling midsem exams",
  bookings: "Deciding Spectra-week bookings",
  relay_queued: "Starting a 4-CPU solver runner on GitHub Actions",
  relay_booting: "Installing the solver on the runner",
};

export function GeneratePanel({
  hasDataset,
  datasetLabel,
  relay = false,
}: {
  hasDataset: boolean;
  datasetLabel: string | null;
  relay?: boolean;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [starting, setStarting] = useState(false);
  const [limit, setLimit] = useState(120);
  const started = useRef<number>(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Polling failed");
        if (stop) return;
        setJob(body);
        if (body.status === "done" || body.status === "failed") {
          if (body.versionId) {
            toast.success("Timetable generated and saved", { description: `Version #${body.versionId}` });
            router.refresh();
          } else if (body.status === "failed" || body.result?.report?.hard_violation_count) {
            toast.error("Generation did not produce a valid timetable");
          }
          return;
        }
      } catch (err) {
        if (!stop) toast.error((err as Error).message);
      }
      if (!stop) setTimeout(tick, 1500);
    };
    void tick();
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => {
      stop = true;
      clearInterval(clock);
    };
  }, [jobId, router]);

  async function start() {
    setStarting(true);
    setJob(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time_limit_s: limit }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not start");
      started.current = Date.now();
      setJobId(body.jobId);
    } catch (err) {
      toast.error((err as Error).message, { action: { label: "Retry", onClick: () => void start() } });
    } finally {
      setStarting(false);
    }
  }

  const running = job ? job.status === "queued" || job.status === "running" : jobId !== null;
  const elapsed = started.current ? Math.round((now - started.current) / 1000) : 0;
  const objectives = (job?.progress ?? []).filter(
    (p) => p.phase === "optimise" && typeof p.objective === "number",
  );

  return (
    <Card>
      <CardHeader
        title="Run the solver"
        description={datasetLabel ?? "No dataset loaded"}
        action={
          !hasDataset ? (
            <Link href="/data">
              <Button variant="primary">Load dataset</Button>
            </Link>
          ) : null
        }
      />
      <div className="flex flex-wrap items-end gap-3 p-4">
        <label className="grid gap-1.5 text-[12px] font-medium text-gray-9">
          Time budget
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            disabled={running}
            className="h-8 rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2 text-[13px] text-gray-10 max-md:h-11"
          >
            <option value={60}>60 s · quick</option>
            <option value={120}>2 min · recommended</option>
            <option value={240}>4 min · thorough</option>
            {relay ? <option value={480}>8 min · deep</option> : null}
          </select>
        </label>
        <p className="w-full text-[12px] text-gray-8 sm:order-last">
          {relay
            ? "Runs on a 4-CPU GitHub Actions runner; allow about a minute for it to start."
            : "Runs on the always-on engine."}
        </p>
        <Button variant="primary" onClick={start} loading={starting} disabled={!hasDataset || running}>
          {!starting ? <Play className="size-3.5" /> : null}
          {running ? "Running…" : "Generate timetable"}
        </Button>
      </div>

      {jobId ? (
        <div className="border-t border-gray-4 p-4">
          {running ? (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="font-medium">
                  {PHASE_LABEL[job?.latest?.phase ?? "feasibility"] ?? "Working"}…
                </span>
                <span className="tabular text-gray-9">{elapsed}s</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-3">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${Math.min(97, (elapsed / (limit + 15)) * 100)}%` }}
                />
              </div>
              {objectives.length > 1 ? (
                <Sparkline values={objectives.map((p) => p.objective as number)} />
              ) : null}
              <p className="text-[12px] text-gray-9">
                Solutions found: <span className="tabular">{job?.latest?.solutions ?? 0}</span>. You can leave
                this page; the run continues on the server.
              </p>
            </div>
          ) : job?.versionId ? (
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <CheckCircle2 className="size-5 text-ok" />
              <span>
                Saved as version #{job.versionId}: <Badge tone="ok">0 hard</Badge> soft penalty{" "}
                <span className="tabular">{job.result?.report?.soft_total}</span>
              </span>
              <Link href="/timetable" className="text-accent hover:underline">
                View timetables →
              </Link>
            </div>
          ) : (
            <div className="flex items-start gap-3 text-[13px]">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-bad" />
              <div>
                <p className="font-medium">No valid timetable was produced.</p>
                <ul className="mt-1 list-disc pl-4 text-gray-9">
                  {(job?.result?.diagnostics ?? [job?.error ?? "Unknown error"]).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 240;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * w},${max === min ? h / 2 : ((v - min) / (max - min)) * (h - 4) + 2}`,
    )
    .join(" ");
  return (
    <div className="flex items-center gap-3">
      <svg width={w} height={h} className="text-accent" aria-label="Objective improving over time">
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="text-[12px] text-gray-9">objective improving</span>
    </div>
  );
}
