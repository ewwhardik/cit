"use client";

import { Accessibility, CalendarDays } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { Input, Label } from "@/components/ui/input";
import { DAYS, hourLabel, periodRange, periodStartHour } from "@/lib/time";
import { cn } from "@/lib/utils";

type Room = {
  id: string;
  name: string;
  building: string;
  type: string;
  capacity: number;
  features: string[];
  accessible: boolean;
  allowed_uses: string[];
};
const NEEDS = ["projector", "pa_system", "stage", "ac", "computers", "accessible"];

export function RoomFinder({
  rooms,
  regular,
  week7,
}: {
  rooms: Room[];
  regular: Record<string, string>;
  week7: Record<string, string>;
}) {
  const [day, setDay] = useState<string>("MON");
  const [from, setFrom] = useState(3);
  const [to, setTo] = useState(4);
  const [size, setSize] = useState(40);
  const [needs, setNeeds] = useState<string[]>([]);
  const [spectra, setSpectra] = useState(false);
  const [showBusy, setShowBusy] = useState(false);
  const busy = spectra ? week7 : regular;
  const periods = Array.from({ length: 13 }, (_, i) => i + 1);

  const results = useMemo(() => {
    return rooms
      .filter((r) => r.capacity >= size)
      .filter((r) => needs.every((n) => (n === "accessible" ? r.accessible : r.features.includes(n))))
      .filter((r) => (to >= 10 ? r.allowed_uses.includes("event") : true))
      .map((r) => {
        const blockers = [] as string[];
        for (let p = from; p <= to; p++) {
          const b = busy[`${r.id}|${day}|${p}`];
          if (b) blockers.push(`P${p}: ${b}`);
        }
        return { r, blockers };
      })
      .filter((x) => showBusy || x.blockers.length === 0)
      .sort((a, b) => a.blockers.length - b.blockers.length || a.r.capacity - b.r.capacity);
  }, [rooms, size, needs, from, to, day, busy, showBusy]);

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="h-fit p-4">
        <div className="grid gap-4">
          <div
            role="tablist"
            aria-label="Week"
            className="grid grid-cols-2 rounded-[var(--radius-control)] border border-gray-4 bg-gray-2 p-0.5"
          >
            {[
              [false, "Regular week"],
              [true, "Spectra week"],
            ].map(([v, l]) => (
              <button
                key={String(v)}
                role="tab"
                type="button"
                aria-selected={spectra === v}
                onClick={() => setSpectra(v as boolean)}
                className={cn(
                  "h-7 rounded-[5px] text-[12px] max-md:h-10",
                  spectra === v ? "bg-surface font-medium shadow-sm" : "text-gray-9",
                )}
              >
                {l as string}
              </button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label>Day</Label>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={day === d}
                  onClick={() => setDay(d)}
                  className={cn(
                    "h-8 flex-1 rounded-[var(--radius-control)] border text-[12px] max-md:h-10",
                    day === d
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-gray-4 bg-surface text-gray-9",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="from">From</Label>
              <select
                id="from"
                value={from}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setFrom(v);
                  if (to < v) setTo(v);
                }}
                className="tabular h-8 rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2 text-[13px] max-md:h-11"
              >
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {hourLabel(periodStartHour(p))} · P{p}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="to">Until</Label>
              <select
                id="to"
                value={to}
                onChange={(e) => setTo(Number(e.target.value))}
                className="tabular h-8 rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2 text-[13px] max-md:h-11"
              >
                {periods
                  .filter((p) => p >= from)
                  .map((p) => (
                    <option key={p} value={p}>
                      {hourLabel(periodStartHour(p) + 1)} · P{p}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="size">People</Label>
            <Input
              id="size"
              type="number"
              min={1}
              value={size}
              onChange={(e) => setSize(Number(e.target.value) || 1)}
            />
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-[12px] font-medium text-gray-9">Needs</legend>
            <div className="flex flex-wrap gap-1.5">
              {NEEDS.map((n) => {
                const on = needs.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setNeeds(on ? needs.filter((x) => x !== n) : [...needs, n])}
                    className={cn(
                      "h-7 rounded-full border px-2.5 text-[12px] max-md:h-9",
                      on ? "border-accent bg-accent-soft text-accent" : "border-gray-4 text-gray-9",
                    )}
                  >
                    {n.replace("_", " ")}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-[12px] text-gray-9">
            <input type="checkbox" checked={showBusy} onChange={(e) => setShowBusy(e.target.checked)} /> Also
            show busy rooms
          </label>
        </div>
      </Card>
      <div className="grid content-start gap-3">
        <p className="text-[13px] text-gray-9">
          <span className="tabular font-medium text-gray-10">
            {results.filter((x) => !x.blockers.length).length}
          </span>{" "}
          rooms free on {day} <span className="tabular">{periodRange(from, to)}</span> for {size}+ people
          {spectra ? " during Spectra week" : ""}.{from <= 5 && to >= 6 ? " The span includes lunch." : ""}
        </p>
        {results.length === 0 ? (
          <Card>
            <EmptyState title="No room matches. Try fewer needs, a smaller size or another time." />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {results.map(({ r, blockers }) => {
              const canBook = r.allowed_uses.includes("event");
              return (
                <Card key={r.id} className={cn("grid gap-2 p-4", blockers.length && "opacity-70")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="tabular text-[14px] font-semibold">{r.id}</p>
                      <p className="truncate text-[12px] text-gray-9">
                        {r.name} · {r.building}
                      </p>
                    </div>
                    <Badge tone={blockers.length ? "bad" : "ok"}>{blockers.length ? "Busy" : "Free"}</Badge>
                  </div>
                  <p className="text-[12px] text-gray-9">
                    <span className="tabular text-gray-10">{r.capacity}</span> seats ·{" "}
                    {r.type.replaceAll("_", " ")}
                    {r.accessible ? (
                      <Accessibility className="ml-1.5 inline size-3.5 text-ok" aria-label="accessible" />
                    ) : null}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {r.features.map((f) => (
                      <span key={f} className="rounded bg-gray-3 px-1.5 py-0.5 text-[11px] text-gray-9">
                        {f.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                  {blockers.length ? (
                    <p className="text-[11px] text-bad">{blockers.slice(0, 2).join("; ")}</p>
                  ) : null}
                  <div className="mt-1 flex gap-2">
                    {canBook && !blockers.length ? (
                      <Link
                        href={
                          `/book?room=${r.id}&day=${day}&from=${from}&to=${to}&size=${size}&type=${r.type}` as Route
                        }
                      >
                        <Button size="sm" variant="primary">
                          Book
                        </Button>
                      </Link>
                    ) : null}
                    <Link href={`/timetable?view=room&id=${r.id}` as Route}>
                      <Button size="sm" variant="ghost">
                        <CalendarDays className="size-3.5" /> Timetable
                      </Button>
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
