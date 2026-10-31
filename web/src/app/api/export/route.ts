import { NextResponse } from "next/server";
import { engineFailure, guard, jsonError } from "@/server/api";
import { audit, getActiveDataset, getCurrentVersion } from "@/server/data";
import { engine } from "@/server/engine";

/** Download the current schedule.json, re-validated by the engine (refused if any hard violation). */
export async function GET() {
  const user = await guard("admin");
  if (user instanceof NextResponse) return user;
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  if (!ds || !version) return jsonError("Generate a timetable first", 409);
  try {
    const { schedule } = await engine.export({ dataset: ds.json, schedule: version.schedule });
    await audit(user.id, "schedule_exported", `version:${version.id}`);
    return new NextResponse(`${JSON.stringify(schedule, null, 2)}\n`, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="schedule.json"`,
      },
    });
  } catch (err) {
    return engineFailure(err);
  }
}
