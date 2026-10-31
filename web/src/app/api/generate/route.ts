import { NextResponse } from "next/server";
import { engineFailure, guard, jsonError } from "@/server/api";
import { audit, getActiveDataset } from "@/server/data";
import { db, schema } from "@/server/db";
import { engine } from "@/server/engine";

/** Admin: start a full generation (timetable + exams + Spectra bookings) on the engine. */
export async function POST(req: Request) {
  const user = await guard("admin");
  if (user instanceof NextResponse) return user;
  const ds = await getActiveDataset();
  if (!ds) return jsonError("Load a dataset first", 409);
  const body = (await req.json().catch(() => ({}))) as { time_limit_s?: number };
  const timeLimit = Math.min(300, Math.max(20, Number(body.time_limit_s) || 120));
  try {
    const { job_id } = await engine.generate({ dataset: ds.json, time_limit_s: timeLimit });
    const [row] = await db
      .insert(schema.jobs)
      .values({ engineJobId: job_id, kind: "generate", datasetRef: ds.id, createdBy: user.id })
      .returning();
    await audit(user.id, "generate_started", `job:${row?.id}`, null, { time_limit_s: timeLimit });
    return NextResponse.json({ jobId: row?.id });
  } catch (err) {
    return engineFailure(err);
  }
}
