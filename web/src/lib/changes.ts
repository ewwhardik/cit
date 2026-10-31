/** Apply a change file to a dataset (same semantics as the engine / official validator). Pure. */
import type { ChangeFile, Dataset } from "@/lib/schemas/dataset";

export function applyChanges(ds: Dataset, file: ChangeFile): Dataset {
  const out: Dataset = structuredClone(ds);
  for (const ch of file.changes) {
    if (ch.type === "faculty_unavailable") {
      const f = out.faculty.find((x) => x.id === ch.faculty_id);
      if (!f) throw new Error(`Unknown faculty ${ch.faculty_id}`);
      for (const day of ch.days) f.unavailable.push({ day, periods: ch.periods, reason: ch.reason ?? "" });
    } else if (ch.type === "room_unavailable") {
      for (const day of ch.days)
        out.room_unavailability.push({ room_id: ch.room_id, day, periods: ch.periods, reason: ch.reason ?? "" });
    } else if (ch.type === "add_faculty") {
      out.faculty.push(ch.faculty);
    } else if (ch.type === "add_session") {
      out.sessions.push(ch.session);
    } else if (ch.type === "remove_session") {
      out.sessions = out.sessions.filter((s) => s.id !== ch.session_id);
    }
  }
  return out;
}

export function describeChange(ch: ChangeFile["changes"][number]): string {
  const span = (ps: number[]) => (ps.length > 1 ? `P${Math.min(...ps)}–P${Math.max(...ps)}` : `P${ps[0]}`);
  switch (ch.type) {
    case "faculty_unavailable":
      return `${ch.faculty_id} unavailable ${ch.days.join(", ")} ${span(ch.periods)}${ch.reason ? ` · ${ch.reason}` : ""}`;
    case "room_unavailable":
      return `${ch.room_id} closed ${ch.days.join(", ")} ${span(ch.periods)}${ch.reason ? ` · ${ch.reason}` : ""}`;
    case "add_faculty":
      return `New faculty ${ch.faculty.id} (${ch.faculty.name})`;
    case "add_session":
      return `New session ${ch.session.id} (${ch.session.course_id} ${ch.session.kind}, ${ch.session.faculty_id}, ${ch.session.groups.join(", ")})`;
    case "remove_session":
      return `Remove session ${ch.session_id}`;
  }
}
