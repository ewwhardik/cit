import { NextResponse } from "next/server";
import { timetableIcs } from "@/lib/ics";
import type { View } from "@/lib/timetable";
import { demoToday } from "@/server/ai/context";
import { guard, jsonError } from "@/server/api";
import { getActiveDataset, getCurrentVersion } from "@/server/data";

/** Download one timetable view as an .ics calendar (weekly repeating events). */
export async function GET(req: Request) {
  const user = await guard();
  if (user instanceof NextResponse) return user;
  const url = new URL(req.url);
  const view = url.searchParams.get("view") as View | null;
  const id = url.searchParams.get("id") ?? "";
  if (!view || !["group", "faculty", "room"].includes(view) || !id)
    return jsonError("view and id are required", 422);
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  if (!ds || !version) return jsonError("No timetable yet", 409);
  const known =
    view === "group"
      ? ds.json.student_groups.some((g) => g.id === id)
      : view === "faculty"
        ? ds.json.faculty.some((f) => f.id === id)
        : ds.json.rooms.some((r) => r.id === id);
  if (!known) return jsonError("Unknown id", 404);
  const body = timetableIcs(ds.json, version.schedule, view, id, {
    weekOf: demoToday().date,
    label: `CIT timetable · ${id}`,
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="cit-${view}-${id.replace(/[^\w-]/g, "")}.ics"`,
    },
  });
}
