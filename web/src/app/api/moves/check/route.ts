import { NextResponse } from "next/server";
import { engineFailure, guard, jsonError, readJson } from "@/server/api";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { engine } from "@/server/engine";

/** Instant validity of a single move (manual scheduling), checked by the engine's rule checker. */
export async function POST(req: Request) {
  const user = await guard();
  if (user instanceof NextResponse) return user;
  const b = await readJson<{ session_id?: string; day?: string; start_period?: number; room_id?: string }>(req);
  if (!b.session_id || !b.day || !b.start_period || !b.room_id) return jsonError("session_id, day, start_period and room_id are required", 400);
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  if (!ds || !version) return jsonError("No timetable yet.", 409);
  try {
    return NextResponse.json(
      await engine.checkMove({ dataset: ds.json, schedule: version.schedule, session_id: b.session_id, day: b.day, start_period: b.start_period, room_id: b.room_id }),
    );
  } catch (err) {
    return engineFailure(err);
  }
}
