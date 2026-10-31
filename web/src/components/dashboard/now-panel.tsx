"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { DAYS, periodRange } from "@/lib/time";
import { cn } from "@/lib/utils";

export type SlotInfo = {
  running: { id: string; course: string; room: string; kind: string; groups: string[] }[];
  free: { id: string; capacity: number; type: string }[];
};

const KIND_VAR: Record<string, string> = {
  lecture: "var(--kind-lecture)",
  tutorial: "var(--kind-tutorial)",
  lab: "var(--kind-lab)",
};

/**
 * "What's happening at…": defaults to the live slot, scrub any day/period to
 * see running classes and rooms free for that hour. Data is precomputed on the server.
 */
export function NowPanel({
  slots,
  live,
  next,
}: {
  slots: Record<string, SlotInfo>;
  live: { day: string; period: number; isLive: boolean };
  next: { label: string; detail: string } | null;
}) {
  const [day, setDay] = useState(live.day);
  const [period, setPeriod] = useState(live.period);
  const info = slots[`${day}|${period}`] ?? { running: [], free: [] };
  const atLive = day === live.day && period === live.period;

  return (
    <Card className="min-w-0">
      <CardHeader
        title={atLive && live.isLive ? "Right now" : "At a glance"}
        description={
          <>
            {day} {periodRange(period, period)} · <span className="tabular">{info.running.length}</span>{" "}
            classes running · <span className="tabular">{info.free.length}</span> rooms free
          </>
        }
        action={
          !atLive ? (
            <button
              type="button"
              onClick={() => {
                setDay(live.day);
                setPeriod(live.period);
              }}
              className="text-[12px] text-accent hover:underline"
            >
              Back to now
            </button>
          ) : live.isLive ? (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-ok">
              <span className="size-1.5 animate-pulse rounded-full bg-ok" /> LIVE
            </span>
          ) : null
        }
      />
      <div className="grid gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Day"
            className="flex rounded-[var(--radius-control)] bg-gray-2 p-0.5"
          >
            {DAYS.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={d === day}
                onClick={() => setDay(d)}
                className={cn(
                  "h-7 rounded-[6px] px-2.5 text-[12px] transition-colors max-md:h-9",
                  d === day ? "bg-surface font-medium shadow-sm" : "text-gray-9 hover:text-gray-10",
                )}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="flex flex-1 items-center gap-0.5">
            {Array.from({ length: 9 }, (_, i) => i + 1).map((p) => {
              const n = slots[`${day}|${p}`]?.running.length ?? 0;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={p === period}
                  title={`P${p} · ${periodRange(p, p)} · ${n} running`}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "relative h-9 min-w-0 flex-1 overflow-hidden rounded-[6px] border text-[11px] transition-colors",
                    p === 6 && "ml-1.5",
                    p === period
                      ? "border-accent text-gray-10"
                      : "border-gray-4 text-gray-8 hover:border-gray-6",
                  )}
                >
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 bg-accent/20"
                    style={{ height: `${Math.min(100, n * 7)}%` }}
                  />
                  <span className="tabular relative">P{p}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-medium tracking-wide text-gray-8 uppercase">Running</p>
            {info.running.length ? (
              <ul className="grid max-h-[220px] gap-1 overflow-y-auto pr-1">
                {info.running.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-[12px]">
                    <span
                      className="h-4 w-0.5 shrink-0 rounded-full"
                      style={{ background: KIND_VAR[r.kind] }}
                    />
                    <span className="truncate font-medium">{r.course}</span>
                    <span className="truncate text-gray-8">{r.groups.join(", ")}</span>
                    <Link
                      href={`/timetable?view=room&id=${r.room}`}
                      className="tabular ml-auto shrink-0 text-gray-9 hover:text-accent"
                    >
                      {r.room}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-gray-8">Nothing scheduled.</p>
            )}
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-medium tracking-wide text-gray-8 uppercase">Free rooms</p>
            <div className="flex max-h-[220px] flex-wrap gap-1.5 overflow-y-auto">
              {info.free.map((r) => (
                <Link
                  key={r.id}
                  href={`/timetable?view=room&id=${r.id}`}
                  title={`${r.type.replaceAll("_", " ")} · ${r.capacity} seats · open its timetable`}
                  className="tabular inline-flex h-7 items-center gap-1.5 rounded-full border border-gray-4 px-2.5 text-[12px] transition-colors hover:border-accent hover:text-accent"
                >
                  {r.id}
                  <span className="text-[10px] text-gray-8">{r.capacity}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {next ? (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-accent-soft px-3 py-2 text-[12px]">
            <span className="font-medium text-accent">{next.label}</span>
            <span className="truncate text-gray-10">{next.detail}</span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
