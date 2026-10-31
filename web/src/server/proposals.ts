import "server-only";
import { and, eq } from "drizzle-orm";
import { applyChanges } from "@/lib/changes";
import { ChangeFile } from "@/lib/schemas/dataset";
import type { Schedule } from "@/lib/schemas/schedule";
import { audit, getActiveDataset, getCurrentVersion } from "./data";
import { db, schema } from "./db";
import { engine, type RepairResult } from "./engine";
import type { CurrentUser } from "./session";

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Store an engine proposal (repair / evaluated change) for approval. Requires 0 hard violations. */
export async function createProposal(args: {
  type: "disruption" | "ai_change" | "manual";
  title: string;
  requestedBy: string;
  result: RepairResult;
  changes: unknown;
  baseVersionId: number;
  datasetRef: number;
  disruptionId?: number | null;
  explanation?: string | null;
}) {
  const r = args.result;
  if (!r.schedule || !r.report) throw new WorkflowError("The engine did not return a schedule to propose.");
  if (r.report.hard_violation_count > 0) throw new WorkflowError("The proposed timetable has hard violations; it cannot be submitted.");
  const [row] = await db
    .insert(schema.proposals)
    .values({
      type: args.type,
      title: args.title.slice(0, 200),
      requestedBy: args.requestedBy,
      datasetRef: args.datasetRef,
      baseVersionId: args.baseVersionId,
      disruptionId: args.disruptionId ?? null,
      diff: r.diff ?? [],
      changes: args.changes ?? { changes: [] },
      summary: { ...(r.summary ?? {}), fest_note: r.fest_note ?? null },
      schedule: r.schedule,
      validation: r.report,
      explanation: args.explanation ?? null,
    })
    .returning({ id: schema.proposals.id });
  await audit(args.requestedBy, "proposal_created", `proposal:${row?.id}`, null, { type: args.type, title: args.title });
  return row?.id ?? null;
}

/**
 * Approve: re-validate against the *current* state, apply the change file to the
 * dataset and make the proposed schedule the current version. Refuses stale proposals
 * and self-approval (also enforced by a DB check constraint).
 */
export async function approveProposal(id: number, approver: CurrentUser) {
  if (approver.role !== "admin") throw new WorkflowError("Only an Admin can approve timetable changes.", 403);
  const p = await db.query.proposals.findFirst({ where: eq(schema.proposals.id, id) });
  if (!p) throw new WorkflowError("Unknown proposal", 404);
  if (p.status !== "pending") throw new WorkflowError(`This proposal is already ${p.status}.`, 409);
  if (p.requestedBy === approver.id) throw new WorkflowError("You cannot approve your own request.", 403);
  const ds = await getActiveDataset();
  if (!ds || ds.id !== p.datasetRef) throw new WorkflowError("The dataset changed since this proposal was made.", 409);
  const current = await getCurrentVersion(ds.id);
  if (!current || current.id !== p.baseVersionId)
    throw new WorkflowError("The timetable changed since this proposal was made; re-run it against the current version.", 409);

  const changes = ChangeFile.parse(p.changes ?? { changes: [] });
  const newDataset = changes.changes.length ? applyChanges(ds.json, changes) : ds.json;
  const schedule = p.schedule as Schedule;
  const report = await engine.check({ dataset: newDataset, schedule, baseline: current.schedule });
  if (report.hard_violation_count > 0)
    throw new WorkflowError(`Re-validation found ${report.hard_violation_count} hard violation(s); nothing was applied.`, 409);

  const versionId = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.proposals)
      .set({ status: "approved", approvedBy: approver.id, decidedAt: new Date() })
      .where(and(eq(schema.proposals.id, id), eq(schema.proposals.status, "pending")))
      .returning();
    if (!claimed.length) throw new WorkflowError("Someone else decided this proposal first.", 409);
    if (changes.changes.length) await tx.update(schema.datasets).set({ json: newDataset }).where(eq(schema.datasets.id, ds.id));
    await tx.update(schema.timetableVersions).set({ isCurrent: false }).where(eq(schema.timetableVersions.datasetRef, ds.id));
    const [v] = await tx
      .insert(schema.timetableVersions)
      .values({
        datasetRef: ds.id,
        kind: "applied",
        parentId: current.id,
        schedule,
        report,
        isCurrent: true,
        createdBy: p.requestedBy,
        approvedBy: approver.id,
      })
      .returning({ id: schema.timetableVersions.id });
    if (p.disruptionId) await tx.update(schema.disruptions).set({ status: "applied" }).where(eq(schema.disruptions.id, p.disruptionId));
    return v?.id ?? null;
  });
  await audit(approver.id, "proposal_approved", `proposal:${id}`, { version: current.id }, { version: versionId, changes: changes.changes.length });
  return versionId;
}

export async function rejectProposal(id: number, approver: CurrentUser, reason: string) {
  if (approver.role !== "admin") throw new WorkflowError("Only an Admin can decide timetable changes.", 403);
  const p = await db.query.proposals.findFirst({ where: eq(schema.proposals.id, id) });
  if (!p) throw new WorkflowError("Unknown proposal", 404);
  if (p.status !== "pending") throw new WorkflowError(`This proposal is already ${p.status}.`, 409);
  if (p.requestedBy === approver.id) throw new WorkflowError("You cannot decide your own request.", 403);
  await db
    .update(schema.proposals)
    .set({ status: "rejected", approvedBy: approver.id, decidedAt: new Date(), explanation: reason.slice(0, 500) || p.explanation })
    .where(eq(schema.proposals.id, id));
  if (p.disruptionId) await db.update(schema.disruptions).set({ status: "rejected" }).where(eq(schema.disruptions.id, p.disruptionId));
  await audit(approver.id, "proposal_rejected", `proposal:${id}`, null, { reason });
}
