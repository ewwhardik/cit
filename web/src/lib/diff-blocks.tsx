import type { DiffRow } from "@/components/diff/diff-view";
import type { Block } from "@/components/timetable/grid";
import type { Dataset } from "@/lib/schemas/dataset";
import type { Schedule } from "@/lib/schemas/schedule";
import { buildBlocks } from "@/lib/timetable";

/** Per affected group: the new timetable with moved sessions highlighted and their old spots as ghosts. */
export function diffGroupBlocks(
  ds: Dataset,
  after: Schedule,
  rows: DiffRow[],
  limit = 8,
): Record<string, Block[]> {
  const sessions = new Map(ds.sessions.map((s) => [s.id, s]));
  const changed = new Map(rows.map((r) => [r.session_id, r]));
  const groups = [...new Set(rows.flatMap((r) => r.groups))].slice(0, limit);
  const out: Record<string, Block[]> = {};
  for (const g of groups) {
    const blocks = buildBlocks(ds, after, "group", g).map((b) =>
      changed.has(b.key) ? { ...b, tone: "added" as const } : b,
    );
    for (const r of rows) {
      if (!r.from || !r.groups.includes(g)) continue;
      const s = sessions.get(r.session_id);
      blocks.push({
        key: `${r.session_id}-before`,
        day: r.from.day,
        start: r.from.start_period,
        duration: s?.duration ?? 1,
        kind: s?.kind ?? "lecture",
        title: r.course_id ?? r.session_id,
        subtitle: "before",
        room: r.from.room_id,
        tone: "ghost",
        details: [
          {
            label: "Moved to",
            value: r.to ? `${r.to.day} P${r.to.start_period} · ${r.to.room_id}` : "removed",
          },
        ],
      });
    }
    out[g] = blocks;
  }
  return out;
}
