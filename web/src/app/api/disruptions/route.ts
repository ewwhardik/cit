import { NextResponse } from "next/server";
import { ChangeFile } from "@/lib/schemas/dataset";
import { engineFailure, guard, jsonError, readJson } from "@/server/api";
import { audit, getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";
import { engine } from "@/server/engine";

/** Admin uploads a change file; the engine computes a minimal-change repair in the background. */
export async function POST(req: Request) {
  const user = await guard("admin");
  if (user instanceof NextResponse) return user;
  const body = await readJson<{ changes?: unknown; time_limit_s?: number }>(req);
  const parsed = ChangeFile.safeParse(body.changes);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return jsonError(`Not a change file in the starter-pack format: ${i?.path.join(".")} ${i?.message}`, 422);
  }
  if (!parsed.data.changes.length) return jsonError("The change file has no changes.", 422);
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  if (!ds || !version) return jsonError("Generate a timetable first.", 409);
  try {
    const [d] = await db
      .insert(schema.disruptions)
      .values({ datasetRef: ds.id, json: parsed.data, status: "uploaded", uploadedBy: user.id })
      .returning({ id: schema.disruptions.id });
    const { job_id } = await engine.repair({
      dataset: ds.json,
      changes: parsed.data,
      baseline: version.schedule,
      time_limit_s: Math.min(180, Math.max(20, Number(body.time_limit_s) || 60)),
    });
    const [job] = await db
      .insert(schema.jobs)
      .values({
        engineJobId: job_id,
        kind: "repair",
        datasetRef: ds.id,
        createdBy: user.id,
        meta: { disruptionId: d?.id, baseVersionId: version.id, changes: parsed.data, title: String((body.changes as { description?: string })?.description ?? "") },
      })
      .returning({ id: schema.jobs.id });
    await audit(user.id, "disruption_uploaded", `disruption:${d?.id}`, null, { changes: parsed.data.changes.length });
    return NextResponse.json({ jobId: job?.id, disruptionId: d?.id });
  } catch (err) {
    return engineFailure(err);
  }
}
