import "server-only";
import type { ChangeFile, Dataset } from "@/lib/schemas/dataset";
import type { Report, Schedule } from "@/lib/schemas/schedule";
import { isRelayJob, relayEnabled, relayState, startRelay } from "./relay";

/** Typed client for the Python scheduling engine (FastAPI). */

const BASE = process.env.ENGINE_URL ?? "http://localhost:8000";

export class EngineError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

async function call<T>(
  path: string,
  body?: unknown,
  init?: { timeoutMs?: number; method?: string },
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.ENGINE_SHARED_SECRET) headers["X-Engine-Secret"] = process.env.ENGINE_SHARED_SECRET;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(init?.timeoutMs ?? 60_000),
    });
  } catch (err) {
    throw new EngineError(`Scheduling engine unreachable at ${BASE}: ${(err as Error).message}`, 503);
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => undefined);
    const msg =
      typeof detail?.detail === "string"
        ? detail.detail
        : (detail?.detail?.message ?? `Engine error ${res.status}`);
    throw new EngineError(msg, res.status, detail?.detail);
  }
  return (await res.json()) as T;
}

type WithData = { dataset: Dataset; changes?: ChangeFile | null };

/**
 * Long solver jobs go to the GitHub Actions relay when it is configured (real
 * CPUs), and fall back to the always-on engine if the dispatch fails.
 */
async function startJob(path: string, body: unknown): Promise<{ job_id: string }> {
  if (relayEnabled()) {
    try {
      return { job_id: await startRelay(path, body) };
    } catch (err) {
      console.warn(`[engine] relay unavailable, using ${BASE}: ${(err as Error).message}`);
    }
  }
  return call<{ job_id: string }>(path, body);
}

export type ResilienceResult = {
  status: string;
  scenarios: {
    id: string;
    kind: "faculty_leave" | "room_closed";
    target: string;
    day: string;
    label: string;
    load: number;
    ok: boolean;
    status: string;
    moved: number;
    time_changed: number;
    room_only: number;
    blockers: string[];
  }[];
  summary: {
    total: number;
    fixable: number;
    infeasible: number;
    timed_out: number;
    median_moved: number;
    max_moved: number;
    score: number;
    elapsed_s: number;
  };
};

export type JobState<R> = {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed";
  latest: Record<string, unknown> | null;
  progress: Record<string, unknown>[];
  result: R | null;
  error: string | null;
};

export type GenerateResult = {
  status: string;
  schedule: Schedule | null;
  report: Report | null;
  decisions?: unknown[];
  diagnostics: string[];
  stats?: Record<string, unknown>;
};

export type DiffRow = {
  session_id: string;
  kind: "added" | "removed" | "time_changed" | "room_only";
  course_id: string | null;
  faculty_id: string | null;
  groups: string[];
  from: { day: string; start_period: number; room_id: string } | null;
  to: { day: string; start_period: number; room_id: string } | null;
  why: string;
};

export type RepairResult = {
  status: string;
  ops_summary?: string[];
  changes?: unknown;
  trace?: ExplainTrace;
  schedule?: Schedule;
  report?: Report;
  diff?: DiffRow[];
  summary?: Record<string, number>;
  broken_before: string[];
  diagnostics: string[];
  fest_note?: string | null;
};

export type ExplainTrace = {
  session_id: string;
  summary: string;
  blocked_by: Record<string, number>;
  free_start_times: number;
  checked_start_times: number;
  top_blockers: Record<string, string[]>;
  current: {
    day: string;
    start_period: number;
    room_id: string;
    soft_contribution: Record<string, number>;
  } | null;
  options: {
    day: string;
    start_period: number;
    room_id: string;
    rooms: string[];
    soft_delta: number | null;
  }[];
  slots: {
    day: string;
    start_period: number;
    ok: boolean;
    rule?: string;
    reason?: string;
    rooms?: string[];
  }[];
  error?: string;
};

export type Blocker = { rule: string; reason: string; blockers: string[] };

export const engine = {
  health: () => call<{ ok: boolean; version: string }>("/health", undefined, { timeoutMs: 5000 }),
  generate: (b: WithData & { time_limit_s?: number; team?: string }) => startJob("/pipeline/generate", b),
  repair: (b: WithData & { baseline: Schedule; time_limit_s?: number }) => startJob("/disruptions/repair", b),
  resilience: (b: WithData & { baseline: Schedule; per_scenario_s?: number; limit?: number }) =>
    startJob("/analysis/resilience", b),
  job: <R>(id: string) =>
    isRelayJob(id) ? relayState<R>(id) : call<JobState<R>>(`/jobs/${id}`, undefined, { timeoutMs: 10_000 }),
  relayEnabled,
  check: (b: WithData & { schedule: Schedule; baseline?: Schedule }) => call<Report>("/timetable/check", b),
  checkMove: (
    b: WithData & {
      schedule: Schedule;
      session_id: string;
      day: string;
      start_period: number;
      room_id: string;
    },
  ) => call<{ ok: boolean; blockers: Blocker[] }>("/timetable/check-move", b, { timeoutMs: 15_000 }),
  allocate: (b: WithData & { schedule: Schedule }) => call<Record<string, unknown>>("/bookings/allocate", b),
  checkOne: (b: WithData & { schedule: Schedule; request: Record<string, unknown> }) =>
    call<Record<string, unknown>>("/bookings/check-one", b, { timeoutMs: 15_000 }),
  explain: (b: WithData & { schedule: Schedule; session_id: string; week7?: boolean }) =>
    call<ExplainTrace>("/timetable/explain", b, { timeoutMs: 20_000 }),
  evaluate: (b: WithData & { baseline: Schedule; ops: unknown[]; time_limit_s?: number }) =>
    startJob("/changes/evaluate", b),
  export: (b: WithData & { schedule: Schedule; baseline?: Schedule }) =>
    call<{ schedule: Schedule; report: Report }>("/export", b),
};
