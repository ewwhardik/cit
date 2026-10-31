/** Pure helpers turning a dataset + schedule into grid blocks and dashboard stats. */
import type { Block } from "@/components/timetable/grid";
import type { Dataset } from "@/lib/schemas/dataset";
import type { Schedule } from "@/lib/schemas/schedule";

export type View = "group" | "faculty" | "room";

export function sessionMatches(view: View, id: string, s: Dataset["sessions"][number], roomId: string) {
  if (view === "group") return s.groups.includes(id);
  if (view === "faculty") return s.faculty_id === id;
  return roomId === id;
}

export function buildBlocks(ds: Dataset, schedule: Schedule, view: View, id: string): Block[] {
  const sessions = new Map(ds.sessions.map((s) => [s.id, s]));
  const faculty = new Map(ds.faculty.map((f) => [f.id, f]));
  const courses = new Map(ds.courses.map((c) => [c.id, c as { id: string; name?: string }]));
  const rooms = new Map(ds.rooms.map((r) => [r.id, r]));
  const blocks: Block[] = [];
  for (const p of schedule.sessions) {
    const s = sessions.get(p.session_id);
    if (!s || !sessionMatches(view, id, s, p.room_id)) continue;
    const course = courses.get(s.course_id);
    const fac = faculty.get(s.faculty_id);
    const room = rooms.get(p.room_id);
    blocks.push({
      key: p.session_id,
      day: p.day,
      start: p.start_period,
      duration: s.duration,
      kind: s.kind,
      title: s.course_id,
      subtitle:
        view === "faculty"
          ? s.groups.join(", ")
          : view === "room"
            ? `${s.groups.join(", ")} · ${s.faculty_id}`
            : (fac?.name ?? s.faculty_id),
      room: p.room_id,
      details: [
        { label: "Session", value: <span className="tabular">{s.id}</span> },
        ...(course?.name ? [{ label: "Course", value: course.name }] : []),
        { label: "Faculty", value: `${fac?.name ?? "?"} (${s.faculty_id})` },
        { label: "Groups", value: s.groups.join(", ") },
        { label: "Size", value: <span className="tabular">{s.size} students</span> },
        ...(room
          ? [
              {
                label: "Room capacity",
                value: (
                  <span className="tabular">
                    {room.capacity} · {room.type.replace("_", " ")}
                  </span>
                ),
              },
            ]
          : []),
        ...(s.basket_slot ? [{ label: "Elective basket", value: s.basket_slot }] : []),
      ],
    });
  }
  return blocks;
}

/** Fraction of teaching periods each room is in use, per day and period. */
export function roomUtilisation(ds: Dataset, schedule: Schedule) {
  const sessions = new Map(ds.sessions.map((s) => [s.id, s]));
  const busy = new Map<string, number>();
  for (const p of schedule.sessions) {
    const s = sessions.get(p.session_id);
    if (!s) continue;
    for (let q = p.start_period; q < p.start_period + s.duration; q++) {
      const k = `${p.room_id}|${p.day}|${q}`;
      busy.set(k, (busy.get(k) ?? 0) + 1);
    }
  }
  const teachingRooms = ds.rooms.filter((r) => r.allowed_uses.some((u) => u === "lecture" || u === "lab"));
  return teachingRooms.map((r) => {
    let used = 0;
    const cells: Record<string, number> = {};
    for (const day of ["MON", "TUE", "WED", "THU", "FRI"]) {
      let dayUsed = 0;
      for (let q = 1; q <= 9; q++) if (busy.has(`${r.id}|${day}|${q}`)) dayUsed++;
      cells[day] = dayUsed;
      used += dayUsed;
    }
    return { room: r, used, pct: used / 45, cells };
  });
}
