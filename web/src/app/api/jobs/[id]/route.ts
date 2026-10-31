import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { engineFailure, guard, jsonError } from "@/server/api";
import { audit } from "@/server/data";
import { db, schema } from "@/server/db";
import { SYSTEM_USER_ID } from "@/server/demo";
import { engine, type GenerateResult, type RepairResult } from "@/server/engine";
import { createProposal } from "@/server/proposals";

type Meta = {
  disruptionId?: number;
  baseVersionId?: number;
  changes?: unknown;
  title?: string;
  summary?: string;
};

/** Atomically move a job from running -> status; returns false if someone else already did. */
async function claim(id: number, status: string) {
  const rows = await db
    .update(schema.jobs)
    .set({ status })
    .where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, "running")))
    .returning();
  return rows.length > 0;
}

/**
 * Poll a background job.
 * - generate: on success (0 hard) the schedule becomes the current timetable version.
 * - repair (disruption): on success a proposal authored by the scheduling engine is created for Admin review.
 * - evaluate (change request): the result is returned; the requester submits it as a proposal.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await guard();
  if (user instanceof NextResponse) return user;
  const id = Number((await ctx.params).id);
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, id) });
  if (!job) return jsonError("Unknown job", 404);
  if (job.createdBy !== user.id && user.role !== "admin") return jsonError("Not your job", 403);
  const meta = (job.meta ?? {}) as Meta;
  try {
    const state = await engine.job<GenerateResult & RepairResult>(job.engineJobId);
    let versionId: number | null = null;
    let proposalId: number | null = null;
    const result = state.result;

    if (state.status === "failed" && job.status === "running") await claim(id, "failed");

    if (state.status === "done" && job.status === "running") {
      if (job.kind === "generate") {
        const report = result?.report;
        if (
          result?.schedule &&
          report &&
          report.hard_violation_count === 0 &&
          job.datasetRef &&
          (await claim(id, "done"))
        ) {
          versionId = await db.transaction(async (tx) => {
            await tx
              .update(schema.timetableVersions)
              .set({ isCurrent: false })
              .where(eq(schema.timetableVersions.datasetRef, job.datasetRef as number));
            const [v] = await tx
              .insert(schema.timetableVersions)
              .values({
                datasetRef: job.datasetRef as number,
                kind: "base",
                schedule: result.schedule!,
                report,
                isCurrent: true,
                createdBy: job.createdBy,
              })
              .returning({ id: schema.timetableVersions.id });
            return v?.id ?? null;
          });
          if (versionId)
            await audit(job.createdBy, "timetable_generated", `version:${versionId}`, null, {
              soft: report.soft_total,
            });
        } else if (!(result?.schedule && report && report.hard_violation_count === 0)) {
          await claim(id, "failed");
        }
      } else if (job.kind === "repair") {
        if (
          result?.schedule &&
          result.report?.hard_violation_count === 0 &&
          job.datasetRef &&
          meta.baseVersionId &&
          (await claim(id, "done"))
        ) {
          proposalId = await createProposal({
            type: "disruption",
            title: meta.title || `Change file #${meta.disruptionId}`,
            requestedBy: SYSTEM_USER_ID,
            result,
            changes: meta.changes,
            baseVersionId: meta.baseVersionId,
            datasetRef: job.datasetRef,
            disruptionId: meta.disruptionId ?? null,
          });
          if (meta.disruptionId)
            await db
              .update(schema.disruptions)
              .set({ status: "proposed" })
              .where(eq(schema.disruptions.id, meta.disruptionId));
          await db
            .update(schema.jobs)
            .set({ meta: { ...meta, proposalId } })
            .where(eq(schema.jobs.id, id));
        } else if (await claim(id, "done")) {
          // Infeasible: no proposal; diagnostics are returned below.
        }
      } else if (job.kind === "evaluate") {
        await claim(id, "done");
      }
    }
    const fresh = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, id) });
    return NextResponse.json({
      kind: job.kind,
      status: state.status,
      latest: state.latest,
      progress: state.progress,
      error: state.error,
      result: result
        ? {
            status: result.status,
            diagnostics: result.diagnostics,
            report: result.report,
            stats: (result as GenerateResult).stats,
            diff: (result as RepairResult).diff,
            summary: (result as RepairResult).summary,
            ops_summary: (result as RepairResult).ops_summary,
            fest_note: (result as RepairResult).fest_note,
          }
        : null,
      versionId,
      proposalId: proposalId ?? ((fresh?.meta ?? {}) as { proposalId?: number }).proposalId ?? null,
    });
  } catch (err) {
    return engineFailure(err);
  }
}
