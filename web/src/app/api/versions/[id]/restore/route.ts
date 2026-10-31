import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Report } from "@/lib/schemas/schedule";
import { guard, jsonError } from "@/server/api";
import { audit } from "@/server/data";
import { db, schema } from "@/server/db";

/** Admin: make an earlier, valid timetable version current again (audited). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await guard("admin");
  if (user instanceof NextResponse) return user;
  const id = Number((await ctx.params).id);
  const v = await db.query.timetableVersions.findFirst({ where: eq(schema.timetableVersions.id, id) });
  if (!v) return jsonError("Unknown version", 404);
  if ((v.report as Report).hard_violation_count !== 0)
    return jsonError("Only clash-free versions can be restored", 409);
  const prev = await db.query.timetableVersions.findFirst({
    where: and(
      eq(schema.timetableVersions.datasetRef, v.datasetRef),
      eq(schema.timetableVersions.isCurrent, true),
    ),
  });
  await db.transaction(async (tx) => {
    await tx
      .update(schema.timetableVersions)
      .set({ isCurrent: false })
      .where(eq(schema.timetableVersions.datasetRef, v.datasetRef));
    await tx
      .update(schema.timetableVersions)
      .set({ isCurrent: true })
      .where(eq(schema.timetableVersions.id, id));
  });
  await audit(user.id, "version_restored", `version:${id}`, { current: prev?.id ?? null }, { current: id });
  return NextResponse.json({ ok: true });
}
