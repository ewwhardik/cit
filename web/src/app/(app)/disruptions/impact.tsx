"use client";

import { useMemo } from "react";
import { DAYS } from "@/lib/time";
import { cn } from "@/lib/utils";

export type Placed = {
  id: string;
  course: string;
  faculty: string;
  groups: string[];
  room: string;
  day: string;
  start: number;
  dur: number;
};

type Change =
  | { type: "faculty_unavailable"; faculty_id: string; days: string[]; periods: number[] }
  | { type: "room_unavailable"; room_id: string; days: string[]; periods: number[] }
  | { type: "remove_session"; session_id: string }
  | { type: "add_session"; session: { id: string } }
  | { type: string };

/** Which placed classes a change file knocks out, before anything is solved. Pure. */
export function impactOf(changes: Change[], placed: Placed[]) {
  const closed = new Set<string>();
  const hit = new Map<string, { p: Placed; why: string }>();
  let added = 0;
  const overlaps = (p: Placed, days: string[], periods: number[]) =>
    days.includes(p.day) && periods.some((q) => q >= p.start && q < p.start + p.dur);
  for (const c of changes) {
    if (c.type === "faculty_unavailable" && "faculty_id" in c) {
      for (const d of c.days) for (const q of c.periods) closed.add(`${d}|${q}`);
      for (const p of placed)
        if (p.faculty === c.faculty_id && overlaps(p, c.days, c.periods))
          hit.set(p.id, { p, why: `${c.faculty_id} on leave` });
    } else if (c.type === "room_unavailable" && "room_id" in c) {
      for (const d of c.days) for (const q of c.periods) closed.add(`${d}|${q}`);
      for (const p of placed)
        if (p.room === c.room_id && overlaps(p, c.days, c.periods))
          hit.set(p.id, { p, why: `${c.room_id} closed` });
    } else if (c.type === "remove_session" && "session_id" in c) {
      const p = placed.find((x) => x.id === c.session_id);
      if (p) hit.set(p.id, { p, why: "removed" });
    } else if (c.type === "add_session") {
      added++;
    }
  }
  return { closed, hit: [...hit.values()], added };
}

/** Live preview of a change file: hit classes on the week grid, with the closed periods hatched. */
export function ImpactPreview({ text, placed }: { text: string; placed: Placed[] }) {
  const parsed = useMemo(() => {
    try {
      const j = JSON.parse(text) as { changes?: Change[] };
      return Array.isArray(j.changes) ? j.changes : null;
    } catch {
      return null;
    }
  }, [text]);
  const impact = useMemo(() => (parsed ? impactOf(parsed, placed) : null), [parsed, placed]);
  if (!text.trim()) return null;
  if (!impact) return <p className="text-[12px] text-gray-8">Preview appears once the JSON is valid.</p>;

  const at = (day: string, p: number) =>
    impact.hit.filter((h) => h.p.day === day && p >= h.p.start && p < h.p.start + h.p.dur).length;
  const groups = new Set(impact.hit.flatMap((h) => h.p.groups));
  const periods = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  return (
    <div className="grid gap-2 rounded-[var(--radius-control)] border border-gray-4 bg-gray-2 p-3">
      <p className="text-[12px]">
        <span className="font-semibold">Impact before solving:</span>{" "}
        <span className="tabular font-semibold text-bad">{impact.hit.length}</span> class
        {impact.hit.length === 1 ? "" : "es"} lose their slot or room
        {groups.size ? (
          <>
            {" "}
            · <span className="tabular">{groups.size}</span> student group{groups.size === 1 ? "" : "s"}
          </>
        ) : null}
        {impact.added ? ` · ${impact.added} new session${impact.added === 1 ? "" : "s"} to place` : ""}.
      </p>
      <div className="wh-grid">
        <span />
        {periods.map((p) => (
          <span key={p} className={cn("wh-head", p === 6 && "wh-lunch")}>
            P{p}
          </span>
        ))}
        {DAYS.map((day) => (
          <div key={day} className="contents">
            <span className="wh-day">{day}</span>
            {periods.map((p) => {
              const n = at(day, p);
              return (
                <span
                  key={p}
                  title={
                    n
                      ? `${n} class${n === 1 ? "" : "es"} hit`
                      : impact.closed.has(`${day}|${p}`)
                        ? "Closed"
                        : ""
                  }
                  className={cn(
                    "di-cell",
                    impact.closed.has(`${day}|${p}`) && "di-closed",
                    p === 6 && "wh-lunch",
                  )}
                  style={n ? ({ "--n": Math.min(1, 0.35 + n * 0.22) } as React.CSSProperties) : undefined}
                >
                  {n || ""}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      {impact.hit.length ? (
        <ul className="flex flex-wrap gap-1">
          {impact.hit.slice(0, 18).map((h) => (
            <li
              key={h.p.id}
              title={`${h.p.course} · ${h.p.groups.join(", ")} · ${h.p.day} P${h.p.start} ${h.p.room}`}
              className="tabular rounded-md border border-bad/30 bg-bad-soft px-1.5 py-0.5 text-[11px]"
            >
              {h.p.id} <span className="text-gray-9">· {h.why}</span>
            </li>
          ))}
          {impact.hit.length > 18 ? (
            <li className="text-[11px] text-gray-8">+{impact.hit.length - 18} more</li>
          ) : null}
        </ul>
      ) : (
        <p className="text-[12px] text-gray-9">
          No placed class is hit; the engine may still need to place new sessions.
        </p>
      )}
    </div>
  );
}
