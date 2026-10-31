/**
 * Demo data: four role accounts and the bundled public dataset.
 * Used by `pnpm seed` and by the Admin "Reset demo data" button.
 * (No "server-only" import so the seed script can run under tsx.)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DEMO_PASSWORD_DEFAULT } from "@/lib/demo";
import { Dataset } from "@/lib/schemas/dataset";
import * as schema from "./db/schema";

type DB = NodePgDatabase<typeof schema>;

export function bundledDatasetPath() {
  return (
    process.env.DEMO_DATASET_PATH ?? path.join(process.cwd(), "..", "starter", "data", "cit_public.json")
  );
}

export async function loadBundledDataset(): Promise<Dataset> {
  // The file is bundled explicitly via outputFileTracingIncludes in next.config.ts.
  const raw = JSON.parse(await readFile(/*turbopackIgnore: true*/ bundledDatasetPath(), "utf-8"));
  return Dataset.parse(raw);
}

export const DEMO_USERS: {
  email: string;
  name: string;
  role: schema.Role;
  department?: string;
  facultyId?: string;
  clubName?: string;
}[] = [
  { email: "admin@cit.demo", name: "Dean's Office", role: "admin" },
  { email: "coord.cse@cit.demo", name: "CSE Coordinator", role: "dept_coordinator", department: "CSE" },
  { email: "faculty.f07@cit.demo", name: "F07", role: "faculty", facultyId: "F07" },
  { email: "club.coding@cit.demo", name: "Coding Club", role: "club", clubName: "Coding Club" },
];

export async function ensureDemoUsers(db: DB, dataset?: Dataset) {
  const password = await hashPassword(process.env.DEMO_PASSWORD ?? DEMO_PASSWORD_DEFAULT);
  for (const u of DEMO_USERS) {
    const name =
      u.facultyId && dataset ? (dataset.faculty.find((f) => f.id === u.facultyId)?.name ?? u.name) : u.name;
    const existing = await db.query.user.findFirst({ where: eq(schema.user.email, u.email) });
    const id = existing?.id ?? crypto.randomUUID();
    const fields = {
      name,
      role: u.role,
      department: u.department ?? null,
      facultyId: u.facultyId ?? null,
      clubName: u.clubName ?? null,
      emailVerified: true,
    };
    if (existing) {
      await db.update(schema.user).set(fields).where(eq(schema.user.id, id));
    } else {
      await db.insert(schema.user).values({ id, email: u.email, ...fields });
    }
    const acct = await db.query.account.findFirst({ where: eq(schema.account.userId, id) });
    if (acct) {
      await db.update(schema.account).set({ password }).where(eq(schema.account.id, acct.id));
    } else {
      await db.insert(schema.account).values({
        id: crypto.randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password,
      });
    }
  }
}

/** Wipe every app table (users and their sessions survive) and load the bundled dataset. */
export async function resetDemoData(db: DB, actorId: string | null) {
  const dataset = await loadBundledDataset();
  await db.execute(
    sql`TRUNCATE TABLE proposals, booking_requests, timetable_versions, disruptions, jobs, audit_log, settings, datasets RESTART IDENTITY CASCADE`,
  );
  await ensureDemoUsers(db, dataset);
  const [row] = await db
    .insert(schema.datasets)
    .values({ datasetId: dataset.dataset_id, json: dataset, uploadedBy: actorId, isActive: true })
    .returning({ id: schema.datasets.id });
  await db.insert(schema.auditLog).values({
    actor: actorId,
    action: "reset_demo_data",
    entity: `dataset:${row?.id}`,
    after: { dataset_id: dataset.dataset_id },
  });
  return { datasetRef: row?.id, datasetId: dataset.dataset_id };
}
