"use client";

import { useEffect, useRef, useState } from "react";

export type JobView = {
  kind: string;
  status: "queued" | "running" | "done" | "failed";
  latest: { phase?: string; elapsed_s?: number; solutions?: number } | null;
  error: string | null;
  result: {
    status: string;
    diagnostics: string[];
    report: { hard_violation_count: number; soft_total: number } | null;
    diff?: unknown[];
    summary?: Record<string, number>;
    ops_summary?: string[];
    fest_note?: string | null;
  } | null;
  versionId: number | null;
  proposalId: number | null;
};

/** Poll /api/jobs/:id until the job finishes. */
export function useJob(jobId: number | null, onDone?: (j: JobView) => void) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cb = useRef(onDone);
  cb.current = onDone;
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    setJob(null);
    setError(null);
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Polling failed");
        if (stop) return;
        setJob(body);
        if (body.status === "done" || body.status === "failed") {
          cb.current?.(body);
          return;
        }
      } catch (err) {
        if (!stop) setError((err as Error).message);
      }
      if (!stop) setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [jobId]);
  return { job, error, running: !!jobId && (!job || job.status === "queued" || job.status === "running") };
}

const PHASE: Record<string, string> = {
  feasibility: "Finding a valid timetable under the new constraints",
  optimise: "Minimising moves (fewest sessions, then fewest time changes)",
};

export function JobStatusLine({ job, startedAt }: { job: JobView | null; startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium">{PHASE[job?.latest?.phase ?? "feasibility"] ?? "Working"}…</span>
        <span className="tabular text-gray-9">{Math.round((now - startedAt) / 1000)}s</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-3">
        <div className="h-full w-1/3 animate-[shimmer_1.2s_linear_infinite] rounded-full bg-accent [background-size:200%_100%]" />
      </div>
    </div>
  );
}
