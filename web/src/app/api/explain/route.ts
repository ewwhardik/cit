import { NextResponse } from "next/server";
import { engineFailure, guard, jsonError, readJson } from "@/server/api";
import { rephraseExplanation } from "@/server/ai/explain";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { engine } from "@/server/engine";

/** "Why is this session here?" - engine trace (facts) + optional plain-language rephrasing. */
export async function POST(req: Request) {
  const user = await guard();
  if (user instanceof NextResponse) return user;
  const { session_id } = await readJson<{ session_id?: string }>(req);
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  if (!ds || !version) return jsonError("No timetable yet.", 409);
  if (!session_id) return jsonError("session_id required", 400);
  try {
    const trace = await engine.explain({ dataset: ds.json, schedule: version.schedule, session_id });
    const prose = await rephraseExplanation(trace);
    return NextResponse.json({ trace, prose });
  } catch (err) {
    return engineFailure(err);
  }
}
