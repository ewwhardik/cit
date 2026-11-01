"use client";

import { Check, Search, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DAYS, hourLabel, periodRange, periodStartHour } from "@/lib/time";
import { cn } from "@/lib/utils";

export type Entity = { id: string; name: string; kind: "group" | "faculty"; size: number };

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const HALVES = [
  [1, 5],
  [6, 9],
] as const;

type Window = { day: string; from: number; to: number };

/** Runs of periods where everyone picked is free, kept inside a half-day (lunch splits them). */
export function freeWindows(free: (day: string, p: number) => boolean, length: number): Window[] {
  const out: Window[] = [];
  for (const day of DAYS)
    for (const [a, b] of HALVES)
      for (let p = a; p + length - 1 <= b; p++) {
        let ok = true;
        for (let q = p; q < p + length; q++) if (!free(day, q)) ok = false;
        if (ok) out.push({ day, from: p, to: p + length - 1 });
      }
  // Prefer mid-day over 08:00 and 17:00, then earlier in the week.
  const edge = (w: Window) => (w.from === 1 ? 1 : 0) + (w.to === 9 ? 1 : 0);
  return out.sort((x, y) => edge(x) - edge(y));
}

export function FreeTimeFinder({
  entities,
  busy,
  initial,
}: {
  entities: Entity[];
  busy: Record<string, Record<string, string>>;
  initial: string[];
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [query, setQuery] = useState("");
  const [length, setLength] = useState(1);
  const [cell, setCell] = useState<{ day: string; p: number } | null>(null);
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  const who = (day: string, p: number) =>
    picked.flatMap((id) => {
      const why = busy[id]?.[`${day}|${p}`];
      return why ? [{ id, why }] : [];
    });
  const windows = useMemo(
    () => freeWindows((d, p) => picked.every((id) => !busy[id]?.[`${d}|${p}`]), length),
    [picked, busy, length],
  );
  const allFree = DAYS.reduce((n, d) => n + PERIODS.filter((p) => !who(d, p).length).length, 0);
  const people = picked.reduce((n, id) => n + (byId.get(id)?.size ?? 0), 0) || 40;
  const q = query.trim().toLowerCase();
  const options = entities.filter(
    (e) => !picked.includes(e.id) && (!q || `${e.id} ${e.name}`.toLowerCase().includes(q)),
  );
  const toggle = (id: string) => {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
    setCell(null);
  };
  const roomLink = (day: string, from: number, to: number) =>
    `/rooms?day=${day}&from=${from}&to=${to}&size=${people}` as Route;
  const detail = cell ? who(cell.day, cell.p) : [];

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="h-fit p-4">
        <p className="mb-2 text-[12px] font-medium text-gray-9">Who needs to be free</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {picked.length ? (
            picked.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-accent bg-accent-soft px-2.5 text-[12px] text-accent max-md:h-9"
                aria-label={`Remove ${id}`}
              >
                {id} <X className="size-3" />
              </button>
            ))
          ) : (
            <p className="text-[12px] text-gray-8">Nobody picked yet.</p>
          )}
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute top-2 left-2 size-4 text-gray-8" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Add a group or teacher…"
            className="h-8 w-full rounded-[var(--radius-control)] border border-gray-5 bg-surface pr-2 pl-8 text-[13px] max-md:h-11"
          />
        </label>
        <ul className="mt-2 grid max-h-[300px] gap-0.5 overflow-y-auto">
          {(["group", "faculty"] as const).map((kind) => {
            const list = options.filter((o) => o.kind === kind);
            if (!list.length) return null;
            return (
              <li key={kind}>
                <p className="px-2 pt-2 pb-1 text-[11px] tracking-wide text-gray-8 uppercase">
                  {kind === "group" ? "Student groups" : "Teachers"}
                </p>
                {list.slice(0, q ? 40 : 14).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggle(e.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-gray-2"
                  >
                    <span className="tabular w-14 shrink-0 font-medium">{e.id}</span>
                    <span className="truncate text-gray-9">{e.name}</span>
                  </button>
                ))}
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader
            title="Week at a glance"
            description={
              picked.length ? (
                <>
                  <span className="tabular font-medium text-gray-10">{allFree}</span> of 45 periods free for
                  all {picked.length} picked. Click a period to see who is busy.
                </>
              ) : (
                "Add groups or teachers on the left."
              )
            }
          />
          <div className="overflow-x-auto p-3">
            <div className="ft-grid">
              <span />
              {PERIODS.map((p) => (
                <span key={p} className={cn("ft-head", p === 6 && "ft-after-lunch")}>
                  P{p}
                  <small>{hourLabel(periodStartHour(p))}</small>
                </span>
              ))}
              {DAYS.map((day) => (
                <div key={day} className="contents">
                  <span className="ft-day">{day}</span>
                  {PERIODS.map((p) => {
                    const b = who(day, p);
                    const share = picked.length ? b.length / picked.length : 0;
                    const sel = cell?.day === day && cell.p === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={sel}
                        aria-label={`${day} P${p}: ${b.length ? `${b.length} busy` : "everyone free"}`}
                        onClick={() => setCell(sel ? null : { day, p })}
                        title={b.length ? b.map((x) => `${x.id}: ${x.why}`).join("\n") : "Everyone free"}
                        className={cn(
                          "ft-cell",
                          !b.length && picked.length && "ft-free",
                          sel && "ft-sel",
                          p === 6 && "ft-after-lunch",
                        )}
                        style={b.length ? ({ "--busy": share } as React.CSSProperties) : undefined}
                      >
                        {!picked.length ? null : b.length ? (
                          <span className="tabular">{b.length}</span>
                        ) : (
                          <Check className="size-3.5" aria-label="everyone free" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-gray-9">
              <span className="inline-flex items-center gap-1.5">
                <i className="ft-key ft-free" /> everyone free
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="ft-key" style={{ "--busy": 0.3 } as React.CSSProperties} /> some busy
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="ft-key" style={{ "--busy": 1 } as React.CSSProperties} /> all busy
              </span>
              <span>The gap after P5 is lunch.</span>
            </div>
          </div>
          {cell ? (
            <div className="border-t border-gray-4 px-4 py-3 text-[12px]">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="font-medium">
                  {cell.day} {periodRange(cell.p, cell.p)}
                </p>
                {!detail.length ? (
                  <Link href={roomLink(cell.day, cell.p, cell.p)}>
                    <Button size="sm" variant="primary">
                      Find a room
                    </Button>
                  </Link>
                ) : null}
              </div>
              {detail.length ? (
                <ul className="grid gap-0.5">
                  {detail.map((d) => (
                    <li key={d.id} className="flex gap-2">
                      <span className="tabular w-14 shrink-0 font-medium">{d.id}</span>
                      <span className="text-gray-9">{d.why}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-9">Everyone picked is free.</p>
              )}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Best slots"
            description="Free for everyone, inside a morning or afternoon block."
            action={
              <div role="tablist" aria-label="Length" className="flex gap-1">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="tab"
                    aria-selected={length === n}
                    onClick={() => setLength(n)}
                    className={cn(
                      "h-7 rounded-[var(--radius-control)] border px-2 text-[12px] max-md:h-9",
                      length === n ? "border-accent bg-accent-soft text-accent" : "border-gray-4 text-gray-9",
                    )}
                  >
                    {n}h
                  </button>
                ))}
              </div>
            }
          />
          {picked.length && windows.length ? (
            <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {windows.slice(0, 9).map((w) => {
                const lab = length === 3 && (w.from === 2 || w.from === 6);
                return (
                  <li
                    key={`${w.day}${w.from}`}
                    className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-gray-4 px-3 py-2"
                  >
                    <div>
                      <p className="text-[13px] font-medium">
                        {w.day} <span className="tabular">{periodRange(w.from, w.to)}</span>
                      </p>
                      <p className="text-[11px] text-gray-9">
                        P{w.from}
                        {w.to > w.from ? `–P${w.to}` : ""}
                        {lab ? " · fits a 3-hour lab" : ""}
                      </p>
                    </div>
                    <Link href={roomLink(w.day, w.from, w.to)}>
                      <Button size="sm" variant="ghost">
                        Find a room
                      </Button>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-5 text-[13px] text-gray-9">
              {picked.length
                ? `No ${length}-hour window where everyone is free. Try a shorter length or fewer people.`
                : "Pick at least one group or teacher."}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
