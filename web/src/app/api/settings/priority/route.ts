import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Dataset } from "@/lib/schemas/dataset";
import { guard, jsonError, readJson } from "@/server/api";
import { audit, getActiveDataset } from "@/server/data";
import { db, schema } from "@/server/db";

/** Exams and regular classes always come first, so no booking can displace the timetable. */
export const LOCKED = ["exam", "regular_session"] as const;
export const EVENTS = ["institute_event", "guest_lecture", "department_event", "club_event"] as const;

/** Admin: change the booking priority order (problem statement §4). Applies at the next Generate. */
export async function POST(req: Request) {
  const user = await guard("admin");
  if (user instanceof NextResponse) return user;
  const { order } = await readJson<{ order?: unknown }>(req);
  if (
    !Array.isArray(order) ||
    order.length !== EVENTS.length ||
    new Set(order).size !== EVENTS.length ||
    !order.every((c) => (EVENTS as readonly string[]).includes(String(c)))
  )
    return jsonError("Send the four event categories in the new order", 422);
  const ds = await getActiveDataset();
  if (!ds) return jsonError("Load a dataset first", 409);
  const before = ds.json.priority_order;
  const next: Dataset = { ...ds.json, priority_order: [...LOCKED, ...(order as string[])] };
  await db.update(schema.datasets).set({ json: next }).where(eq(schema.datasets.id, ds.id));
  await audit(
    user.id,
    "priority_order_changed",
    `dataset:${ds.id}`,
    { order: before },
    { order: next.priority_order },
  );
  return NextResponse.json({ ok: true, order: next.priority_order });
}
