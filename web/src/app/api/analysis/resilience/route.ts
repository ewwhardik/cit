import { NextResponse } from "next/server";
import { engineFailure, guard, jsonError, readJson } from "@/server/api";
import { audit, getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";
import { engine } from "@/server/engine";

/** Start a resilience scan of the current timetable (analysis only; nothing is applied). */
export async function POST(req: Request) {
  const user = await guard("admin", "dept_coordinator");
  if (user instanceof NextResponse) return user;
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  if (!ds || !version) return jsonError("Generate a timetable first", 409);
  const body = await readJson<{ depth?: "quick" | "deep" }>(req);
  const deep = body.depth === "deep";
  const relay = engine.relayEnabled();
  // Without the 4-CPU relay, keep the scan small enough for the always-on engine.
  const opts = relay
    ? { limit: deep ? 30 : 16, per_scenario_s: deep ? 60 : 40 }
    : { limit: deep ? 8 : 4, per_scenario_s: 30 };
  try {
    const { job_id } = await engine.resilience({ dataset: ds.json, baseline: version.schedule, ...opts });
    const [row] = await db
      .insert(schema.jobs)
      .values({
        engineJobId: job_id,
        kind: "resilience",
        datasetRef: ds.id,
        createdBy: user.id,
        meta: { baseVersionId: version.id },
      })
      .returning();
    await audit(user.id, "resilience_started", `job:${row?.id}`, null, opts);
    return NextResponse.json({ jobId: row?.id, relay, ...opts });
  } catch (err) {
    return engineFailure(err);
  }
}
