import { NextResponse } from "next/server";
import { fallbackNavigator } from "@/lib/navigator-fallback";
import { pagesFor } from "@/lib/sitemap";
import { aiFailureReason } from "@/server/ai/client";
import { type ChatTurn, runNavigator } from "@/server/ai/navigator";
import { guard, jsonError, readJson } from "@/server/api";
import { env } from "@/server/env";

// Per-user rate limit for the LLM (best effort, per server instance); the offline guide is unlimited.
const recent = new Map<string, number[]>();

function allowAi(userId: string): boolean {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= env().NAVIGATOR_RATE_PER_MIN) {
    recent.set(userId, hits);
    return false;
  }
  hits.push(now);
  recent.set(userId, hits);
  return true;
}

export async function POST(req: Request) {
  const user = await guard();
  if (user instanceof NextResponse) return user;
  const body = await readJson<{ message?: string; history?: ChatTurn[]; path?: string }>(req);
  const message = String(body.message ?? "")
    .trim()
    .slice(0, 500);
  if (!message) return jsonError("Say something first", 422);
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string")
    .slice(-6)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 500) }));
  const path = String(body.path ?? "/dashboard").slice(0, 80);

  if (!allowAi(user.id)) {
    const r = fallbackNavigator(message, pagesFor(user.role));
    return NextResponse.json({ ...r, note: "AI is cooling down; the offline guide answered." });
  }
  try {
    return NextResponse.json(await runNavigator(user.role, message, history, path));
  } catch (err) {
    const r = fallbackNavigator(message, pagesFor(user.role));
    return NextResponse.json({ ...r, note: `${aiFailureReason(err)}; the offline guide answered.` });
  }
}
