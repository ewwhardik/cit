"use client";

import { ArrowRight, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { type Block, TimetableGrid } from "@/components/timetable/grid";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type DiffRow = {
  session_id: string;
  kind: "added" | "removed" | "time_changed" | "room_only";
  course_id: string | null;
  faculty_id: string | null;
  groups: string[];
  from: { day: string; start_period: number; room_id: string } | null;
  to: { day: string; start_period: number; room_id: string } | null;
  why: string;
};

export type DiffSummary = {
  moved?: number;
  time_changed?: number;
  room_only?: number;
  added?: number;
  removed?: number;
  hard_violations?: number;
  soft_before?: number;
  soft_after?: number;
  soft_delta?: number;
  fest_note?: string | null;
};

const KIND: Record<DiffRow["kind"], { label: string; tone: "accent" | "warn" | "ok" | "bad" }> = {
  room_only: { label: "Room only", tone: "accent" },
  time_changed: { label: "Time change", tone: "warn" },
  added: { label: "Added", tone: "ok" },
  removed: { label: "Removed", tone: "bad" },
};

function Slot({ s }: { s: DiffRow["from"] }) {
  if (!s) return <span className="text-gray-8">—</span>;
  return (
    <span className="tabular inline-flex items-center gap-1 rounded-md border border-gray-4 bg-gray-2 px-1.5 py-0.5 text-[12px]">
      {s.day} P{s.start_period} <span className="text-gray-8">·</span> {s.room_id}
    </span>
  );
}

export function DiffSummaryBar({ summary }: { summary: DiffSummary }) {
  const items = [
    ["moved", summary.moved],
    ["room-only", summary.room_only],
    ["time", summary.time_changed],
    ["added", summary.added],
    ["removed", summary.removed],
  ].filter(([, v]) => v !== undefined && (v as number) > 0) as [string, number][];
  const delta = summary.soft_delta ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
      {items.map(([k, v]) => (
        <span key={k}>
          <span className="tabular font-semibold">{v}</span> <span className="text-gray-9">{k}</span>
        </span>
      ))}
      <span>
        <span
          className={cn(
            "tabular font-semibold",
            (summary.hard_violations ?? 0) === 0 ? "text-ok" : "text-bad",
          )}
        >
          {summary.hard_violations ?? 0}
        </span>{" "}
        <span className="text-gray-9">conflicts</span>
      </span>
      {summary.soft_after !== undefined ? (
        <span>
          <span className="text-gray-9">soft</span>{" "}
          <span className="tabular font-semibold">
            {delta > 0 ? `+${delta}` : delta} ({summary.soft_before} → {summary.soft_after})
          </span>
        </span>
      ) : null}
    </div>
  );
}

/** Changes as a list (always) and as before/after grids per affected student group. */
export function DiffView({
  rows,
  summary,
  groupBlocks,
}: {
  rows: DiffRow[];
  summary: DiffSummary;
  groupBlocks: Record<string, Block[]>;
}) {
  const groups = Object.keys(groupBlocks);
  const [group, setGroup] = useState(groups[0] ?? "");
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader title="What changes" description={<DiffSummaryBar summary={summary} />} />
        {summary.fest_note ? (
          <p className="border-b border-gray-4 px-4 py-2 text-[12px] text-gray-9">{summary.fest_note}</p>
        ) : null}
        {rows.length ? (
          <ul className="divide-y divide-gray-4">
            {rows.map((r) => (
              <li
                key={r.session_id}
                className="grid gap-1.5 px-4 py-3 md:grid-cols-[180px_1fr] md:items-center md:gap-4"
              >
                <div className="min-w-0">
                  <p className="tabular truncate text-[13px] font-medium">{r.session_id}</p>
                  <p className="truncate text-[11px] text-gray-9">
                    {[r.faculty_id, r.groups.join(", ")].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={KIND[r.kind].tone}>
                      {r.kind === "added" ? (
                        <Plus className="size-3" />
                      ) : r.kind === "removed" ? (
                        <Minus className="size-3" />
                      ) : null}
                      {KIND[r.kind].label}
                    </Badge>
                    <Slot s={r.from} />
                    <ArrowRight className="size-3.5 text-gray-8" aria-label="to" />
                    <Slot s={r.to} />
                  </div>
                  <p className="text-[12px] text-gray-9">{r.why}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-[13px] text-gray-9">
            No session moves: the timetable already satisfies the change.
          </p>
        )}
      </Card>
      {groups.length ? (
        <Card>
          <CardHeader
            title="On the timetable"
            description="New positions are outlined in green; old positions are shown as faded ghosts."
            action={
              <select
                aria-label="Student group"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="h-8 rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2 text-[13px] max-md:h-11"
              >
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            }
          />
          <div className="p-3">
            <TimetableGrid blocks={groupBlocks[group] ?? []} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
