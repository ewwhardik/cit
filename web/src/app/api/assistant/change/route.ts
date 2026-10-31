import { NextResponse } from "next/server";
import { z } from "zod";
import { type AssistantResult, ChangeOp, runAssistant, scopeCheck } from "@/server/ai/assistant";
import { engineFailure, guard, jsonError, readJson } from "@/server/api";
import { audit, getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";
import { engine } from "@/server/engine";

/**
 * Faculty change assistant: natural language -> structured ops (LLM or fallback)
 * -> scope check in code -> engine evaluation job. Nothing is applied.
 */
export async function POST(req: Request) {
  const user = await guard("admin", "dept_coordinator", "faculty");
  if (user instanceof NextResponse) return user;
  const body = await readJson<{ text?: string; ops?: unknown[] }>(req);
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  if (!ds || !version) return jsonError("No timetable yet.", 409);
  try {
    let assistant: Omit<AssistantResult, "source"> & { source: AssistantResult["source"] | "manual" };
    if (Array.isArray(body.ops)) {
      // Manual form: the user built the operations directly.
      const ops = z.array(ChangeOp).safeParse(body.ops);
      if (!ops.success) return jsonError("Invalid change operations.", 422);
      assistant = {
        reply: "",
        summary: body.text ?? "Manual change request",
        ops: ops.data,
        source: "manual" as const,
        notice: null,
        steps: [],
      };
    } else {
      if (!body.text?.trim()) return jsonError("Describe the change you need.", 400);
      assistant = await runAssistant({ user, ds: ds.json, schedule: version.schedule }, body.text.trim());
    }
    if (!assistant.ops.length) return NextResponse.json({ assistant, jobId: null });
    const scope = scopeCheck({ user, ds: ds.json, schedule: version.schedule }, assistant.ops);
    if (scope) return NextResponse.json({ assistant, jobId: null, blocked: scope });
    const { job_id } = await engine.evaluate({
      dataset: ds.json,
      baseline: version.schedule,
      ops: assistant.ops,
      time_limit_s: 45,
    });
    const [job] = await db
      .insert(schema.jobs)
      .values({
        engineJobId: job_id,
        kind: "evaluate",
        datasetRef: ds.id,
        createdBy: user.id,
        meta: {
          ops: assistant.ops,
          summary: assistant.summary,
          text: body.text ?? "",
          source: assistant.source,
          baseVersionId: version.id,
        },
      })
      .returning({ id: schema.jobs.id });
    await audit(user.id, "change_requested", `job:${job?.id}`, null, {
      ops: assistant.ops,
      source: assistant.source,
    });
    return NextResponse.json({ assistant, jobId: job?.id });
  } catch (err) {
    return engineFailure(err);
  }
}
