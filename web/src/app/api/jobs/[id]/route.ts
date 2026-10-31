import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { engineFailure, guard, jsonError } from "@/server/api";
import { audit } from "@/server/data";
import { db, schema } from "@/server/db";
import { engine, type GenerateResult } from "@/server/engine";

/**
 * Poll a background job. When a generation finishes with zero hard
 * violations, its schedule becomes the current timetable version (once).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await guard("admin");
  if (user instanceof NextResponse) return user;
  const id = Number((await ctx.params).id);
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, id) });
  if (!job) return jsonError("Unknown job", 404);
  try {
    const state = await engine.job<GenerateResult>(job.engineJobId);
    let versionId: number | null = null;
    if (state.status === "done" && job.status === "running" && job.kind === "generate") {
      const result = state.result;
      const report = result?.report;
      if (result?.schedule && report && report.hard_violation_count === 0 && job.datasetRef) {
        versionId = await db.transaction(async (tx) => {
          // Claim the job so concurrent pollers don't store it twice.
          const claimed = await tx
            .update(schema.jobs)
            .set({ status: "done" })
            .where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, "running")))
            .returning();
          if (!claimed.length) return null;
          await tx
            .update(schema.timetableVersions)
            .set({ isCurrent: false })
            .where(eq(schema.timetableVersions.datasetRef, job.datasetRef as number));
          const [v] = await tx
            .insert(schema.timetableVersions)
            .values({
              datasetRef: job.datasetRef as number,
              kind: "base",
              schedule: result.schedule,
              report,
              isCurrent: true,
              createdBy: job.createdBy,
              approvedBy: null,
            })
            .returning({ id: schema.timetableVersions.id });
          return v?.id ?? null;
        });
        if (versionId)
          await audit(user.id, "timetable_generated", `version:${versionId}`, null, {
            soft: report.soft_total,
          });
      } else {
        await db.update(schema.jobs).set({ status: "failed" }).where(eq(schema.jobs.id, id));
      }
    } else if (state.status === "failed" && job.status === "running") {
      await db.update(schema.jobs).set({ status: "failed" }).where(eq(schema.jobs.id, id));
    }
    return NextResponse.json({
      status: state.status,
      latest: state.latest,
      progress: state.progress,
      error: state.error,
      result: state.result
        ? {
            status: state.result.status,
            diagnostics: state.result.diagnostics,
            report: state.result.report,
            stats: state.result.stats,
          }
        : null,
      versionId,
    });
  } catch (err) {
    return engineFailure(err);
  }
}
