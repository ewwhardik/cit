import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { aiConfigured } from "@/server/ai/client";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { requireRole } from "@/server/session";
import { ChangeAssistant } from "./assistant";

export const metadata: Metadata = { title: "Change request" };

export default async function AssistantPage() {
  const user = await requireRole("faculty", "dept_coordinator", "admin");
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  const dept = new Map(ds?.json.faculty.map((f) => [f.id, f.department]) ?? []);
  const placements = new Map(version?.schedule.sessions.map((p) => [p.session_id, p]) ?? []);
  const mine = (ds?.json.sessions ?? [])
    .filter((s) =>
      user.role === "admin"
        ? true
        : user.role === "faculty"
          ? s.faculty_id === user.facultyId
          : dept.get(s.faculty_id) === user.department,
    )
    .map((s) => {
      const p = placements.get(s.id);
      return {
        id: s.id,
        course: s.course_id,
        kind: s.kind,
        faculty: s.faculty_id,
        where: p ? `${p.day} P${p.start_period} · ${p.room_id}` : "unscheduled",
      };
    });
  const faculty =
    user.role === "faculty"
      ? (ds?.json.faculty.filter((f) => f.id === user.facultyId) ?? [])
      : (ds?.json.faculty.filter((f) => user.role === "admin" || f.department === user.department) ?? []);
  return (
    <>
      <PageHeader
        title="Change request"
        description="Ask for a schedule change in plain language. The engine checks it against every rule and finds the smallest set of moves; an Admin approves before anything changes."
      />
      <ChangeAssistant
        aiReady={aiConfigured()}
        hasTimetable={!!version}
        sessions={mine}
        faculty={faculty.map((f) => ({ id: f.id, name: f.name }))}
        examples={
          user.facultyId
            ? [
                "I can't take Thursday morning classes for the rest of the semester.",
                `Move my ${mine.find((m) => m.kind === "lecture")?.course ?? "lecture"} lecture to Friday afternoon if possible.`,
                "I'm unavailable on Monday mornings; move my lab to Wednesday.",
              ]
            : ["Move CS203-L1 to Friday", "F07 cannot teach on Tuesday afternoons"]
        }
      />
    </>
  );
}
