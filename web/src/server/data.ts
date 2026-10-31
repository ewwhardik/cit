import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { Dataset } from "@/lib/schemas/dataset";
import type { Report, Schedule } from "@/lib/schemas/schedule";
import { db, schema } from "./db";

export type ActiveDataset = { id: number; datasetId: string; json: Dataset };
export type CurrentVersion = {
  id: number;
  schedule: Schedule;
  report: Report;
  createdAt: Date;
  kind: string;
};

export async function getActiveDataset(): Promise<ActiveDataset | null> {
  const row = await db.query.datasets.findFirst({
    where: eq(schema.datasets.isActive, true),
    orderBy: desc(schema.datasets.createdAt),
  });
  return row ? { id: row.id, datasetId: row.datasetId, json: row.json as Dataset } : null;
}

export async function getCurrentVersion(datasetRef: number): Promise<CurrentVersion | null> {
  const row = await db.query.timetableVersions.findFirst({
    where: and(
      eq(schema.timetableVersions.datasetRef, datasetRef),
      eq(schema.timetableVersions.isCurrent, true),
    ),
    orderBy: desc(schema.timetableVersions.createdAt),
  });
  return row
    ? {
        id: row.id,
        schedule: row.schedule as Schedule,
        report: row.report as Report,
        createdAt: row.createdAt,
        kind: row.kind,
      }
    : null;
}

export async function audit(
  actor: string | null,
  action: string,
  entity: string,
  before?: unknown,
  after?: unknown,
) {
  await db
    .insert(schema.auditLog)
    .values({ actor, action, entity, before: before ?? null, after: after ?? null });
}
