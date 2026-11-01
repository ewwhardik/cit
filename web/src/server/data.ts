import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { cache } from "react";
import type { Dataset } from "@/lib/schemas/dataset";
import type { Report, Schedule } from "@/lib/schemas/schedule";
import { db, schema } from "./db";
import type { Role } from "./db/schema";

export type ActiveDataset = { id: number; datasetId: string; json: Dataset };
export type CurrentVersion = {
  id: number;
  schedule: Schedule;
  report: Report;
  createdAt: Date;
  kind: string;
};

type CacheEntry<T> = { data: T; expiresAt: number };
let cachedActiveDataset: CacheEntry<ActiveDataset | null> | null = null;
const cachedCurrentVersions = new Map<number, CacheEntry<CurrentVersion | null>>();

const DATA_CACHE_TTL_MS = 20_000; // 20 seconds warm in-memory cache across requests

/** Clear the in-memory dataset and version cache when datasets or timetables mutate. */
export function clearDataCache() {
  cachedActiveDataset = null;
  cachedCurrentVersions.clear();
}

/**
 * The active dataset (~140 KB of JSON). Cached both per-request via React cache()
 * and short-lived in-memory across requests, cutting WAN roundtrips on tab navigation.
 */
export const getActiveDataset = cache(async (): Promise<ActiveDataset | null> => {
  const now = Date.now();
  if (cachedActiveDataset && cachedActiveDataset.expiresAt > now) {
    return cachedActiveDataset.data;
  }
  const row = await db.query.datasets.findFirst({
    where: eq(schema.datasets.isActive, true),
    orderBy: desc(schema.datasets.createdAt),
  });
  const data = row ? { id: row.id, datasetId: row.datasetId, json: row.json as Dataset } : null;
  cachedActiveDataset = { data, expiresAt: now + DATA_CACHE_TTL_MS };
  return data;
});

/** The current timetable version for a dataset. Cached in-memory and per-request. */
export const getCurrentVersion = cache(async (datasetRef: number): Promise<CurrentVersion | null> => {
  const now = Date.now();
  const cached = cachedCurrentVersions.get(datasetRef);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const row = await db.query.timetableVersions.findFirst({
    where: and(
      eq(schema.timetableVersions.datasetRef, datasetRef),
      eq(schema.timetableVersions.isCurrent, true),
    ),
    orderBy: desc(schema.timetableVersions.createdAt),
  });
  const data = row
    ? {
        id: row.id,
        schedule: row.schedule as Schedule,
        report: row.report as Report,
        createdAt: row.createdAt,
        kind: row.kind,
      }
    : null;
  cachedCurrentVersions.set(datasetRef, { data, expiresAt: now + DATA_CACHE_TTL_MS });
  return data;
});

/**
 * Pending approval counts for bookings and proposals.
 * Parallelizes both queries and memoizes per request so layout and dashboard share the result.
 */
export const getPendingCounts = cache(
  async (role: Role): Promise<{ bookingCount: number; proposalCount: number; total: number }> => {
    if (role !== "admin" && role !== "dept_coordinator") {
      return { bookingCount: 0, proposalCount: 0, total: 0 };
    }
    const [bRes, pRes] = await Promise.all([
      db
        .select({ n: count() })
        .from(schema.bookingRequests)
        .where(eq(schema.bookingRequests.status, "pending")),
      role === "admin"
        ? db.select({ n: count() }).from(schema.proposals).where(eq(schema.proposals.status, "pending"))
        : Promise.resolve([{ n: 0 }]),
    ]);
    const bookingCount = bRes[0]?.n ?? 0;
    const proposalCount = pRes[0]?.n ?? 0;
    return { bookingCount, proposalCount, total: bookingCount + proposalCount };
  },
);

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
