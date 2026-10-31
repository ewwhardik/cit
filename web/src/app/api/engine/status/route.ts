import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";

/**
 * Engine liveness for the dashboard. `?wake=1` waits long enough for a
 * sleeping free-tier instance to boot; the normal check gives up after 4 s.
 */
export async function GET(req: Request) {
  await requireUser();
  const wake = new URL(req.url).searchParams.get("wake") === "1";
  const base = process.env.ENGINE_URL ?? "http://localhost:8000";
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(wake ? 75_000 : 4_000),
    });
    const body = (await res.json().catch(() => ({}))) as { version?: string; solver_workers?: number };
    return NextResponse.json({
      ok: res.ok,
      ms: Date.now() - t0,
      version: body.version ?? null,
      workers: body.solver_workers ?? null,
    });
  } catch {
    return NextResponse.json({ ok: false, ms: Date.now() - t0, version: null, workers: null });
  }
}
