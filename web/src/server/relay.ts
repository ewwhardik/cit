import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import type { JobState } from "./engine";
import { env, features } from "./env";

/**
 * Solver relay: long CP-SAT jobs run on a GitHub Actions runner (4 vCPU, free
 * for public repos) instead of the small always-on engine instance.
 *
 *   web  --dispatch(job id)-->  .github/workflows/engine-relay.yml
 *   runner  --GET  /api/relay/:id-->  { path, body }      (X-Engine-Secret)
 *   runner  runs the same engine locally, then
 *   runner  --POST /api/relay/:id-->  JobState updates   (X-Engine-Secret)
 *
 * The web app polls the stored state exactly like an engine job. Records live
 * in the `settings` key/value table under `relay:<id>`. The runner never
 * writes to the repository.
 */

export type RelayRecord = {
  path: string;
  body: unknown;
  status: JobState<unknown>["status"];
  state: JobState<unknown> | null;
  createdAt: number;
  startedAt: number | null;
  updatedAt: number;
};

const PREFIX = "relay:";
const QUEUE_TIMEOUT_MS = 6 * 60_000;
const SILENCE_TIMEOUT_MS = 3 * 60_000;

export function relayEnabled(): boolean {
  return features.relay();
}

export function isRelayJob(jobId: string): boolean {
  return jobId.startsWith(PREFIX);
}

async function read(id: string): Promise<RelayRecord | null> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, `${PREFIX}${id}`) });
  return (row?.value as RelayRecord | undefined) ?? null;
}

async function write(id: string, rec: RelayRecord) {
  await db
    .insert(schema.settings)
    .values({ key: `${PREFIX}${id}`, value: rec })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: rec, updatedAt: new Date() } });
}

/** Store the request and ask GitHub to start a runner. Returns the engine-style job id. */
export async function startRelay(path: string, body: unknown): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await write(id, {
    path,
    body,
    status: "queued",
    state: null,
    createdAt: now,
    startedAt: null,
    updatedAt: now,
  });
  const {
    GITHUB_RELAY_REPO: repo,
    GITHUB_RELAY_WORKFLOW: workflow,
    GITHUB_RELAY_REF: ref,
    GITHUB_RELAY_TOKEN: token,
  } = env();
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref, inputs: { job: id } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    await db.delete(schema.settings).where(eq(schema.settings.key, `${PREFIX}${id}`));
    throw new Error(`GitHub Actions dispatch failed (${res.status})`);
  }
  return `${PREFIX}${id}`;
}

/** Engine-compatible job state for polling, with timeouts for runners that never start or go silent. */
export async function relayState<R>(jobId: string): Promise<JobState<R>> {
  const id = jobId.slice(PREFIX.length);
  const rec = await read(id);
  const base = { id: jobId, kind: "relay", progress: [] as Record<string, unknown>[], result: null };
  if (!rec) return { ...base, status: "failed", latest: null, error: "Unknown relay job" };
  const now = Date.now();
  if (rec.status === "queued" && now - rec.createdAt > QUEUE_TIMEOUT_MS)
    return {
      ...base,
      status: "failed",
      latest: null,
      error: "No GitHub Actions runner picked up the job in time.",
    };
  if (rec.status === "running" && now - rec.updatedAt > SILENCE_TIMEOUT_MS)
    return { ...base, status: "failed", latest: null, error: "The solver runner stopped responding." };
  if (rec.state) return rec.state as JobState<R>;
  return {
    ...base,
    status: rec.status === "queued" ? "queued" : "running",
    latest: { phase: rec.status === "queued" ? "relay_queued" : "relay_booting" },
    error: null,
  };
}

/** Runner side: claim the job and get what to run. */
export async function relayClaim(id: string): Promise<{ path: string; body: unknown } | null> {
  const rec = await read(id);
  if (!rec || rec.status === "done" || rec.status === "failed") return null;
  const now = Date.now();
  await write(id, { ...rec, status: "running", startedAt: rec.startedAt ?? now, updatedAt: now });
  return { path: rec.path, body: rec.body };
}

/** Runner side: store the latest engine state (progress or final). */
export async function relayUpdate(id: string, state: JobState<unknown>): Promise<boolean> {
  const rec = await read(id);
  if (!rec) return false;
  const status = state.status === "done" || state.status === "failed" ? state.status : "running";
  // Drop the (large) request body once the job is finished.
  const body = status === "running" ? rec.body : null;
  await write(id, { ...rec, body, status, state, updatedAt: Date.now() });
  return true;
}
