import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { engineFailure, guard, jsonError, readJson } from "@/server/api";
import { db, schema } from "@/server/db";
import { engine, type RepairResult } from "@/server/engine";
import { createProposal } from "@/server/proposals";

/** Submit an evaluated change request (from the assistant or the form) for Admin approval. */
export async function POST(req: Request) {
  const user = await guard("admin", "dept_coordinator", "faculty");
  if (user instanceof NextResponse) return user;
  const { jobId, note } = await readJson<{ jobId?: number; note?: string }>(req);
  const job = jobId ? await db.query.jobs.findFirst({ where: eq(schema.jobs.id, Number(jobId)) }) : null;
  if (!job || job.kind !== "evaluate") return jsonError("Unknown change request", 404);
  if (job.createdBy !== user.id) return jsonError("You can only submit your own change requests.", 403);
  const meta = (job.meta ?? {}) as { summary?: string; text?: string; baseVersionId?: number; proposalId?: number; source?: string };
  if (meta.proposalId) return NextResponse.json({ proposalId: meta.proposalId });
  try {
    // The result is fetched from the engine by job id - never taken from the client.
    const state = await engine.job<RepairResult>(job.engineJobId);
    if (state.status !== "done" || !state.result) return jsonError("The change is still being evaluated.", 409);
    if (!state.result.schedule) return jsonError("This change has no valid fix, so it cannot be submitted.", 409);
    const proposalId = await createProposal({
      type: meta.source === "manual" ? "manual" : "ai_change",
      title: meta.summary || meta.text?.slice(0, 120) || "Change request",
      requestedBy: user.id,
      result: state.result,
      changes: state.result.changes ?? { changes: [] },
      baseVersionId: meta.baseVersionId ?? 0,
      datasetRef: job.datasetRef ?? 0,
      explanation: [meta.text, note].filter(Boolean).join("\n\n") || null,
    });
    await db.update(schema.jobs).set({ meta: { ...meta, proposalId } }).where(eq(schema.jobs.id, job.id));
    return NextResponse.json({ proposalId });
  } catch (err) {
    return engineFailure(err);
  }
}
