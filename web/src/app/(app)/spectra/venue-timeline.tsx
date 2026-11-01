"use client";

import { useState } from "react";
import { DAYS, hourLabel, periodStartHour } from "@/lib/time";
import { cn } from "@/lib/utils";

export type TimelineItem = {
  id: string;
  title: string;
  room: string;
  day: string;
  start: number;
  end: number;
  status: string;
  category: string;
  reason: string;
};

const CATEGORY_COLOR: Record<string, string> = {
  exam: "var(--kind-exam)",
  institute_event: "#d946ef",
  guest_lecture: "var(--kind-tutorial)",
  department_event: "var(--kind-lab)",
  club_event: "var(--accent)",
  regular_class: "var(--kind-lecture)",
};
const FALLBACK_COLOR = "var(--gray-8)";

const PERIODS = Array.from({ length: 13 }, (_, i) => i + 1);
const HEADER_ROWS = 2;
const GRID_TEMPLATE = "84px repeat(13, minmax(44px, 1fr))";

function colorFor(category: string) {
  return CATEGORY_COLOR[category] ?? FALLBACK_COLOR;
}

export function VenueTimeline({ items, venues }: { items: TimelineItem[]; venues: string[] }) {
  const [selected, setSelected] = useState<string>(
    () => DAYS.find((d) => items.some((i) => i.day === d)) ?? DAYS[0],
  );
  const dayItems = items.filter((i) => i.day === selected);
  const categories = [...new Set(items.map((i) => i.category))];
  const lastRow = venues.length + HEADER_ROWS + 1;

  return (
    <div className="grid gap-4">
      <div role="tablist" aria-label="Spectra day" className="flex flex-wrap gap-1">
        {DAYS.map((d) => {
          const count = items.filter((i) => i.day === d).length;
          const on = selected === d;
          return (
            <button
              key={d}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => setSelected(d)}
              className={cn(
                "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-[12px] max-md:h-10",
                on ? "border-accent bg-accent-soft text-accent" : "border-gray-4 bg-surface text-gray-9",
              )}
            >
              {d}
              <span className="tabular text-[11px] text-gray-8">{count}</span>
            </button>
          );
        })}
      </div>

      {dayItems.length === 0 ? (
        <p className="px-1 py-6 text-[13px] text-gray-9">No venue bookings on {selected}.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div
              className="relative grid min-w-[760px] text-[11px]"
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
            >
              {/* Evening tint across all rows (P10-P13) */}
              <div
                aria-hidden
                className="pointer-events-none"
                style={{
                  gridColumn: "11 / 15",
                  gridRow: `1 / ${lastRow}`,
                  background: "color-mix(in oklch, var(--kind-event) 6%, transparent)",
                }}
              />
              {/* Thin lunch divider between P5 and P6 */}
              <div
                aria-hidden
                className="pointer-events-none justify-self-start border-l border-dashed border-gray-8"
                style={{ gridColumn: "7 / 8", gridRow: `1 / ${lastRow}`, width: 0 }}
              />
              <p
                className="pointer-events-none pl-1 text-[10px] text-gray-8"
                style={{ gridColumn: "7 / 9", gridRow: 1 }}
              >
                lunch
              </p>
              <p className="pl-1 text-[10px] text-gray-8" style={{ gridColumn: "11 / 15", gridRow: 1 }}>
                evening · events only
              </p>

              {/* Header: P labels and hours */}
              <div className="tabular self-end pb-1 text-gray-8" style={{ gridColumn: 1, gridRow: 2 }} />
              {PERIODS.map((p) => (
                <div
                  key={p}
                  className="tabular flex flex-col items-center border-b border-gray-4 pb-1 text-center"
                  style={{ gridColumn: p + 1, gridRow: 2 }}
                >
                  <span className="font-medium text-gray-10">P{p}</span>
                  <span className="text-[10px] text-gray-8">{hourLabel(periodStartHour(p))}</span>
                </div>
              ))}

              {/* Venue rows: labels and grid lines */}
              {venues.map((v, idx) => {
                const row = idx + HEADER_ROWS + 1;
                return (
                  <div key={v} className="contents">
                    <div
                      className="tabular flex h-9 items-center truncate pr-2 text-gray-10"
                      style={{ gridColumn: 1, gridRow: row }}
                    >
                      {v}
                    </div>
                    {PERIODS.map((p) => (
                      <div
                        key={p}
                        className="h-9 border-t border-gray-4"
                        style={{ gridColumn: p + 1, gridRow: row }}
                      />
                    ))}
                  </div>
                );
              })}

              {/* Bars */}
              {dayItems.map((item) => {
                const row = venues.indexOf(item.room) + HEADER_ROWS + 1;
                if (row <= HEADER_ROWS) return null;
                const color = colorFor(item.category);
                const alt = item.status === "alternative_offered";
                return (
                  <button
                    type="button"
                    key={item.id}
                    aria-label={`${item.title}, P${item.start}–${item.end}, ${item.reason}`}
                    title={`${item.title} — ${item.reason}`}
                    className="tabular z-10 flex h-7 min-w-0 items-center gap-1.5 self-center rounded-[6px] px-1.5 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent"
                    style={{
                      gridColumn: `${item.start + 1} / ${item.end + 2}`,
                      gridRow: row,
                      borderLeft: `3px solid ${color}`,
                      backgroundColor: `color-mix(in oklch, ${color} 18%, var(--surface))`,
                      backgroundImage: alt
                        ? `repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklch, ${color} 22%, transparent) 6px 12px)`
                        : undefined,
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                    <span className="shrink-0 text-gray-9">
                      P{item.start}
                      {item.end > item.start ? `–${item.end}` : ""}
                    </span>
                    {alt ? (
                      <span className="shrink-0 rounded bg-surface px-1 text-[9px] text-gray-10 uppercase">
                        alt
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-gray-9">
            {categories.map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-[3px]"
                  style={{ backgroundColor: colorFor(c) }}
                />
                {c.replaceAll("_", " ")}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-[3px] border border-gray-8"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(135deg, transparent 0 3px, var(--gray-8) 3px 5px)",
                }}
              />
              alternative slot
            </span>
          </div>
        </>
      )}
    </div>
  );
}
