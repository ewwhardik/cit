"use client";

import { useMemo, useState } from "react";
import { boxFaces, DRAW_ORDER, iso, pts, type RoomLite, ZONES, zoneOf } from "@/lib/campus-zones";
import { cn } from "@/lib/utils";
import type { DiffRow } from "./diff-view";

const COLOR = { room_only: "#7dd3fc", time_changed: "#fbbf24" } as const;

const BOUNDS = (() => {
  const all = ZONES.flatMap((z) => Object.values(boxFaces(z)).flat());
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs) - 24;
  const y0 = Math.min(...ys) - 110;
  return { x0, y0, w: Math.max(...xs) - x0 + 24, h: Math.max(...ys) - y0 + 24 };
})();
const GROUND = pts([iso(-0.2, -0.2), iso(9.4, -0.2), iso(9.4, 6.9), iso(-0.2, 6.9)]);

type Move = {
  row: DiffRow & { kind: "room_only" | "time_changed" };
  d: string;
  a: [number, number];
  b: [number, number];
};

function roof(zoneId: string): [number, number] {
  const z = ZONES.find((x) => x.id === zoneId) ?? ZONES[0]!;
  return iso(z.x + z.w / 2, z.y + z.d / 2, z.h);
}

/**
 * Where a change sends each session, drawn on the campus: one arc per moved
 * session from its old building to its new one (a loop when it stays in the
 * same building). Static SVG; the only motion is a dash flow on the arcs.
 */
export function MoveMap({ rows, rooms }: { rows: DiffRow[]; rooms: RoomLite[] }) {
  const [on, setOn] = useState<string | null>(null);
  const { moves, touched } = useMemo(() => {
    const zone = new Map(rooms.map((r) => [r.id, zoneOf(r)]));
    const pairs = new Map<string, number>();
    const touched = new Set<string>();
    const moves: Move[] = [];
    for (const row of rows) {
      if ((row.kind !== "room_only" && row.kind !== "time_changed") || !row.from || !row.to) continue;
      const za = zone.get(row.from.room_id);
      const zb = zone.get(row.to.room_id);
      if (!za || !zb) continue;
      touched.add(za).add(zb);
      const key = `${za}>${zb}`;
      const n = pairs.get(key) ?? 0;
      pairs.set(key, n + 1);
      const a = roof(za);
      const b = roof(zb);
      let d: string;
      if (za === zb) {
        const r = 16 + n * 7;
        d = `M${a[0]} ${a[1]} C${a[0] - r} ${a[1] - r * 2.6} ${a[0] + r} ${a[1] - r * 2.6} ${a[0]} ${a[1]}`;
      } else {
        const lift = 36 + Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.28 + n * 10;
        const mx = (a[0] + b[0]) / 2;
        const my = Math.min(a[1], b[1]) - lift;
        d = `M${a[0]} ${a[1]} Q${mx} ${my} ${b[0]} ${b[1]}`;
      }
      moves.push({ row: row as Move["row"], d, a, b });
    }
    return { moves, touched };
  }, [rows, rooms]);

  if (!moves.length) return null;

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="mm-screen">
        <svg
          viewBox={`${BOUNDS.x0} ${BOUNDS.y0} ${BOUNDS.w} ${BOUNDS.h}`}
          className="block h-auto w-full"
          aria-labelledby="mm-title"
        >
          <title id="mm-title">
            Campus map of {moves.length} moved session{moves.length === 1 ? "" : "s"}
          </title>
          <polygon points={GROUND} className="cr-ground" />
          {DRAW_ORDER.map((z) => {
            const f = boxFaces(z);
            const [lx, ly] = iso(z.x + z.w / 2, z.y + z.d / 2, z.h);
            return (
              <g key={z.id} className={cn("mm-zone", touched.has(z.id) && "mm-zone-on")}>
                <polygon points={pts(f.left)} className="cr-face-l" />
                <polygon points={pts(f.right)} className="cr-face-r" />
                <polygon points={pts(f.top)} className="cr-face-t" />
                <text x={lx} y={ly + 4} className="mm-label">
                  {z.short}
                </text>
              </g>
            );
          })}
          {moves.map((m) => {
            const c = COLOR[m.row.kind];
            const dim = on && on !== m.row.session_id;
            return (
              <g key={m.row.session_id} className={cn("mm-move", dim && "mm-dim")} style={{ color: c }}>
                <path d={m.d} className="mm-arc-glow" />
                <path d={m.d} className="mm-arc" />
                <circle cx={m.a[0]} cy={m.a[1]} r={3.2} className="mm-from" />
                <circle cx={m.b[0]} cy={m.b[1]} r={3.6} className="mm-to" />
              </g>
            );
          })}
        </svg>
        <div className="mm-legend">
          <span>
            <i style={{ background: COLOR.room_only }} /> room only
          </span>
          <span>
            <i style={{ background: COLOR.time_changed }} /> time change
          </span>
          <span className="opacity-70">○ from · ● to</span>
        </div>
      </div>
      <ul className="grid max-h-[340px] content-start gap-1 overflow-y-auto pr-1">
        {moves.map((m) => (
          <li key={m.row.session_id}>
            <button
              type="button"
              aria-pressed={on === m.row.session_id}
              onMouseEnter={() => setOn(m.row.session_id)}
              onMouseLeave={() => setOn(null)}
              onFocus={() => setOn(m.row.session_id)}
              onBlur={() => setOn(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[12px] hover:border-gray-4 hover:bg-gray-2",
                on === m.row.session_id && "border-gray-4 bg-gray-2",
              )}
            >
              <span className="h-4 w-0.5 shrink-0 rounded-full" style={{ background: COLOR[m.row.kind] }} />
              <span className="tabular min-w-0 flex-1 truncate font-medium">{m.row.session_id}</span>
              <span className="tabular shrink-0 text-[11px] text-gray-9">
                {m.row.from?.room_id} → {m.row.to?.room_id}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
