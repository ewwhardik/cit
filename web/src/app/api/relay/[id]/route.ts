import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/server/api";
import type { JobState } from "@/server/engine";
import { relayClaim, relayUpdate } from "@/server/relay";

/** Endpoints for the GitHub Actions solver runner; authenticated with the engine shared secret. */
function authorised(req: Request): boolean {
  const expected = process.env.ENGINE_SHARED_SECRET ?? "";
  const got = req.headers.get("x-engine-secret") ?? "";
  if (!expected || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!authorised(req)) return jsonError("Forbidden", 403);
  const job = await relayClaim((await ctx.params).id);
  return job ? NextResponse.json(job) : jsonError("No such pending job", 404);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!authorised(req)) return jsonError("Forbidden", 403);
  const state = await readJson<JobState<unknown>>(req);
  if (!state || typeof state.status !== "string") return jsonError("Bad state", 422);
  return (await relayUpdate((await ctx.params).id, state))
    ? NextResponse.json({ ok: true })
    : jsonError("Unknown job", 404);
}
