"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Dataset } from "@/lib/schemas/dataset";
import { audit, clearDataCache } from "@/server/data";
import { db, schema } from "@/server/db";
import { resetDemoData } from "@/server/demo";
import { requireRole } from "@/server/session";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function resetDemo(): Promise<ActionResult> {
  const user = await requireRole("admin");
  try {
    const r = await resetDemoData(db, user.id);
    clearDataCache();
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Demo data reset. Dataset ${r.datasetId} loaded; generate a timetable next.`,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function uploadDataset(text: string): Promise<ActionResult> {
  const user = await requireRole("admin");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  const res = Dataset.safeParse(parsed);
  if (!res.success) {
    const first = res.error.issues[0];
    return {
      ok: false,
      error: `Not a dataset in the starter-pack format: ${first?.path.join(".")} ${first?.message}`,
    };
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.datasets).set({ isActive: false }).where(eq(schema.datasets.isActive, true));
    await tx
      .insert(schema.datasets)
      .values({ datasetId: res.data.dataset_id, json: res.data, uploadedBy: user.id, isActive: true });
  });
  await audit(user.id, "dataset_uploaded", `dataset:${res.data.dataset_id}`);
  clearDataCache();
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Loaded ${res.data.dataset_id}: ${res.data.sessions.length} sessions. Generate a timetable next.`,
  };
}
