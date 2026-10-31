import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Schedule } from "@/lib/schemas/schedule";
import { engineFailure, guard, jsonError, readJson } from "@/server/api";
import { audit, getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";
import { type DiffRow, engine } from "@/server/engine";
import { createProposal } from "@/server/proposals";

/**
 * Manual scheduling. The whole resulting timetable is validated by the engine
 * (0 hard violations required). Admin moves apply immediately; coordinators
 * (own department) and faculty (own sessions) create a proposal for an Admin.
 */
export async function POST(req: Request) {
  const user = await guard("admin", "dept_coordinator", "faculty");
  if (user instanceof NextResponse) return user;
  const b = await readJson<{ session_id?: string; day?: string; start_period?: number; room_id?: string; note?: string }>(req);
  if (!b.session_id || !b.day || !b.start_period || !b.room_id) return jsonError("session_id, day, start_period and room_id are required", 400);
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  if (!ds || !version) return jsonError("No timetable yet.", 409);
  const session = ds.json.sessions.find((s) => s.id === b.session_id);
  if (!session) return jsonError("Unknown session", 404);
  if (user.role === "faculty" && session.faculty_id !== user.facultyId) return jsonError("You can only move your own sessions.", 403);
  if (user.role === "dept_coordinator") {
    const dept = ds.json.faculty.find((f) => f.id === session.faculty_id)?.department;
    if (dept !== user.department) return jsonError("Coordinators can only move their own department's sessions.", 403);
  }

  // Basket partners move together (same day and start, their own rooms).
  const partners = session.basket_slot ? ds.json.sessions.filter((s) => s.basket_slot === session.basket_slot).map((s) => s.id) : [session.id];
  const before = new Map(version.schedule.sessions.map((p) => [p.session_id, p]));
  const schedule: Schedule = {
    ...version.schedule,
    sessions: version.schedule.sessions.map((p) =>
      p.session_id === session.id
        ? { ...p, day: b.day!, start_period: b.start_period!, room_id: b.room_id! }
        : partners.includes(p.session_id)
          ? { ...p, day: b.day!, start_period: b.start_period! }
          : p,
    ),
  };
  try {
    const report = await engine.check({ dataset: ds.json, schedule, baseline: version.schedule });
    if (report.hard_violation_count > 0) {
      return jsonError(`Blocked: this move breaks ${report.hard_violation_count} hard rule(s).`, 409, { violations: report.hard_violations.slice(0, 8) });
    }
    const diff: DiffRow[] = schedule.sessions
      .filter((p) => {
        const o = before.get(p.session_id);
        return o && (o.day !== p.day || o.start_period !== p.start_period || o.room_id !== p.room_id);
      })
      .map((p) => {
        const o = before.get(p.session_id)!;
        const s = ds.json.sessions.find((x) => x.id === p.session_id);
        return {
          session_id: p.session_id,
          kind: o.day === p.day && o.start_period === p.start_period ? "room_only" : "time_changed",
          course_id: s?.course_id ?? null,
          faculty_id: s?.faculty_id ?? null,
          groups: s?.groups ?? [],
          from: { day: o.day, start_period: o.start_period, room_id: o.room_id },
          to: { day: p.day, start_period: p.start_period, room_id: p.room_id },
          why: p.session_id === session.id ? (b.note?.slice(0, 200) || `Manual move by ${user.name}`) : "Elective basket moves together",
        };
      });
    const summary = {
      moved: diff.length,
      time_changed: diff.filter((d) => d.kind === "time_changed").length,
      room_only: diff.filter((d) => d.kind === "room_only").length,
      added: 0,
      removed: 0,
      hard_violations: 0,
      soft_before: version.report.soft_total,
      soft_after: report.soft_total,
      soft_delta: report.soft_total - version.report.soft_total,
    };
    if (user.role === "admin") {
      const versionId = await db.transaction(async (tx) => {
        await tx.update(schema.timetableVersions).set({ isCurrent: false }).where(eq(schema.timetableVersions.datasetRef, ds.id));
        const [v] = await tx
          .insert(schema.timetableVersions)
          .values({ datasetRef: ds.id, kind: "applied", parentId: version.id, schedule, report, isCurrent: true, createdBy: user.id, approvedBy: user.id })
          .returning({ id: schema.timetableVersions.id });
        return v?.id;
      });
      await audit(user.id, "manual_move_applied", `session:${session.id}`, before.get(session.id), { day: b.day, start_period: b.start_period, room_id: b.room_id });
      return NextResponse.json({ applied: true, versionId, summary });
    }
    const proposalId = await createProposal({
      type: "manual",
      title: `Move ${session.id} to ${b.day} P${b.start_period} in ${b.room_id}`,
      requestedBy: user.id,
      result: { status: "feasible", schedule, report, diff, summary, broken_before: [], diagnostics: [] },
      changes: { changes: [] },
      baseVersionId: version.id,
      datasetRef: ds.id,
      explanation: b.note ?? null,
    });
    return NextResponse.json({ applied: false, proposalId, summary });
  } catch (err) {
    return engineFailure(err);
  }
}
