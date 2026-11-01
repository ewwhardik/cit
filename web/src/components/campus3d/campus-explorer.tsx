"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  DoorOpen,
  Footprints,
  LogOut,
  Orbit,
  Radio,
  RotateCcw,
  Search,
} from "lucide-react";
import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { groupRooms, type RoomLite, type RoomNow, type SlotState, zonesAt } from "@/lib/campus-zones";
import { DAYS, hourLabel, periodStartHour } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Inside, Mode, ViewerHandle } from "./campus-viewer";
import type { FloorLook, Occupant } from "./world";

const CampusViewer = dynamic(() => import("./campus-viewer").then((m) => m.CampusViewer), {
  ssr: false,
});

const TONE: Record<string, string> = {
  lecture: "#e8b25a",
  lab: "#ff9a5c",
  event: "#d946ef",
  free: "#6fb6e8",
  match: "#2fbf71",
  dim: "#4a5258",
};

function lookOf(r: RoomNow): FloorLook {
  if (r.state === "event") return "event";
  if (r.state === "session") return r.session.kind === "lab" ? "lab" : "lecture";
  return "free";
}

function occupantOf(r: RoomNow): Occupant {
  if (r.state === "event")
    return {
      title: r.event.title,
      detail: `Spectra event · ${r.event.attendance} expected`,
      used: r.used,
      tone: "event",
    };
  if (r.state === "session")
    return {
      title: `${r.session.course} ${r.session.kind}`,
      detail: [r.session.faculty, r.session.groups.join(", ")].filter(Boolean).join(" · "),
      used: r.used,
      tone: r.session.kind === "lab" ? "lab" : "lecture",
    };
  return { title: "Free", detail: "Nothing scheduled this period", used: 0, tone: "free" };
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * The 3D campus: every building lit storey-by-storey with what is running in
 * each room for the chosen day and period, a free-room finder that lights the
 * rooms that fit, and walk-in interiors that show the class and seat use.
 */
export function CampusExplorer({
  slots,
  rooms,
  live,
}: {
  slots: Record<string, SlotState>;
  rooms: RoomLite[];
  live: { day: string; period: number; isLive: boolean };
}) {
  const grouped = useMemo(() => groupRooms(rooms), [rooms]);
  const [day, setDay] = useState(live.day);
  const [period, setPeriod] = useState(live.period);
  const [mode, setMode] = useState<Mode>("orbit");
  const [zone, setZone] = useState<string | null>(null);
  const [insideId, setInsideId] = useState<string | null>(null);
  const [finder, setFinder] = useState(false);
  const [seats, setSeats] = useState(60);
  const [ready, setReady] = useState(false);
  const [gl, setGl] = useState(true);
  const viewer = useRef<ViewerHandle>(null);

  useEffect(() => setGl(hasWebGL()), []);

  const slot = slots[`${day}|${period}`] ?? { running: [], events: [], free: [] };
  const zones = useMemo(() => zonesAt(slot, grouped), [slot, grouped]);
  const byRoom = useMemo(
    () => new Map(zones.flatMap((z) => z.rooms.map((r) => [r.room.id, r] as const))),
    [zones],
  );
  const fits = useCallback(
    (r: RoomNow) => r.state !== "event" && r.state !== "session" && r.room.capacity >= seats,
    [seats],
  );

  const looks = useMemo(() => {
    const out: Record<string, FloorLook> = {};
    for (const r of byRoom.values()) out[r.room.id] = finder ? (fits(r) ? "match" : "dim") : lookOf(r);
    return out;
  }, [byRoom, finder, fits]);

  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const z of zones) {
      if (!z.rooms.length) continue;
      out[z.zone.id] = finder ? `${z.rooms.filter(fits).length} fit` : `${z.active}/${z.rooms.length} in use`;
    }
    return out;
  }, [zones, finder, fits]);

  const matches = useMemo(
    () => [...byRoom.values()].filter(fits).sort((a, b) => a.room.capacity - b.room.capacity),
    [byRoom, fits],
  );

  const when = `${day} P${period} · ${hourLabel(periodStartHour(period))}–${hourLabel(periodStartHour(period) + 1)}`;
  const insideRow = insideId ? byRoom.get(insideId) : undefined;
  const inside: Inside = useMemo(
    () => (insideRow ? { room: insideRow.room, occ: occupantOf(insideRow), when } : null),
    [insideRow, when],
  );
  const picked = zones.find((z) => z.zone.id === zone);
  const used = zones.reduce((n, z) => n + z.used, 0);
  const cap = zones.reduce((n, z) => n + z.capacity, 0);
  const inUse = zones.reduce((n, z) => n + z.active, 0);
  const walking = mode === "walk" || !!inside;

  function pick(zoneId: string) {
    setZone(zoneId);
    if (mode === "orbit") viewer.current?.flyTo(zoneId);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-4 px-3 py-2.5">
          <div role="tablist" aria-label="Day" className="flex gap-1">
            {DAYS.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={day === d}
                onClick={() => setDay(d)}
                className={cn(
                  "h-7 rounded-[var(--radius-control)] border px-2 text-[12px] max-md:h-9",
                  day === d ? "border-accent bg-accent-soft text-accent" : "border-gray-4 text-gray-9",
                )}
              >
                {d}
              </button>
            ))}
          </div>
          <label className="flex min-w-[200px] flex-1 items-center gap-2 text-[12px] text-gray-9">
            <span className="tabular w-[92px] shrink-0 text-gray-10">
              P{period} · {hourLabel(periodStartHour(period))}
            </span>
            <input
              type="range"
              min={1}
              max={9}
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              aria-label="Period"
              aria-valuetext={when}
              className="c3d-range flex-1"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setDay(live.day);
              setPeriod(live.period);
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-gray-4 px-2.5 text-[12px] text-gray-9 hover:border-accent hover:text-accent"
          >
            <Radio className="size-3.5" /> {live.isLive ? "Live" : "Today"}
          </button>
        </div>

        <div className="c3d-stage">
          {gl ? (
            <CampusViewer
              handle={viewer}
              rooms={rooms}
              looks={looks}
              labels={labels}
              hour={periodStartHour(period) + 0.5}
              mode={mode}
              selectedZone={zone}
              inside={inside}
              onPick={(z) => pick(z)}
              onReady={() => setReady(true)}
            />
          ) : (
            <p className="grid h-full place-items-center p-6 text-center text-[13px] text-gray-9">
              This browser can't draw 3D. The campus radar on the dashboard shows the same live status.
            </p>
          )}
          {gl && !ready ? (
            <div className="c3d-loading" role="status">
              <span className="c3d-spinner" /> Building the campus…
            </div>
          ) : null}

          <div className="c3d-ui c3d-ui-tl">
            {inside ? (
              <button type="button" onClick={() => setInsideId(null)} className="c3d-btn c3d-btn-on">
                <LogOut className="size-3.5" /> Leave {inside.room.id}
              </button>
            ) : (
              <div role="tablist" aria-label="View" className="c3d-seg">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "orbit"}
                  onClick={() => setMode("orbit")}
                >
                  <Orbit className="size-3.5" /> Fly
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "walk"}
                  onClick={() => setMode("walk")}
                >
                  <Footprints className="size-3.5" /> Walk
                </button>
              </div>
            )}
          </div>
          {!inside ? (
            <div className="c3d-ui c3d-ui-tr">
              <button
                type="button"
                aria-pressed={finder}
                onClick={() => setFinder(!finder)}
                className={cn("c3d-btn", finder && "c3d-btn-on")}
              >
                <Search className="size-3.5" /> Free rooms
              </button>
              {mode === "orbit" ? (
                <button
                  type="button"
                  onClick={() => viewer.current?.reset()}
                  className="c3d-btn"
                  aria-label="Reset view"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="c3d-ui c3d-ui-bl c3d-legend">
            {(finder && !inside
              ? [
                  ["match", `fits ${seats}+`],
                  ["dim", "taken or too small"],
                ]
              : [
                  ["lecture", "class"],
                  ["lab", "lab"],
                  ["event", "event"],
                  ["free", "free"],
                ]
            ).map(([k, l]) => (
              <span key={k}>
                <i style={{ background: TONE[k!] }} /> {l}
              </span>
            ))}
          </div>
          {walking ? (
            <>
              <p className="c3d-ui c3d-ui-bc c3d-hint max-md:hidden">
                WASD / arrows to walk · drag to look · Shift to run
              </p>
              <div className="c3d-pad md:hidden">
                {(
                  [
                    ["f", ArrowUp, "Forward"],
                    ["l", ArrowLeft, "Left"],
                    ["b", ArrowDown, "Back"],
                    ["r", ArrowRight, "Right"],
                  ] as const
                ).map(([k, Icon, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-label={label}
                    className={`c3d-pad-${k}`}
                    onPointerDown={() => viewer.current?.press(k, true)}
                    onPointerUp={() => viewer.current?.press(k, false)}
                    onPointerLeave={() => viewer.current?.press(k, false)}
                    onPointerCancel={() => viewer.current?.press(k, false)}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </Card>

      <aside className="grid content-start gap-3">
        <Card className="grid grid-cols-3 divide-x divide-gray-4">
          {[
            ["Rooms in use", `${inUse}/${rooms.length}`],
            ["Seats filled", cap ? `${Math.round((used / cap) * 100)}%` : "–"],
            ["Rooms free", String(rooms.length - inUse)],
          ].map(([k, v]) => (
            <div key={k} className="px-3 py-2.5">
              <p className="text-[11px] text-gray-8">{k}</p>
              <p className="tabular text-[18px] leading-tight font-semibold">{v}</p>
            </div>
          ))}
        </Card>

        {inside && insideRow ? (
          <RoomDetail row={insideRow} day={day} period={period} inside onEnter={() => undefined} />
        ) : finder ? (
          <Card className="p-3">
            <label className="grid gap-1.5 text-[12px] text-gray-9">
              People to seat
              <input
                type="number"
                min={1}
                value={seats}
                onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
                className="tabular h-8 rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2 text-[13px] text-gray-10 max-md:h-11"
              />
            </label>
            <p className="mt-2 text-[12px] text-gray-9">
              <span className="tabular font-medium text-gray-10">{matches.length}</span> rooms free on {when}{" "}
              with {seats}+ seats, lit green on the map.
            </p>
            <ul className="mt-2 grid max-h-[340px] gap-1 overflow-y-auto">
              {matches.map((m) => (
                <li key={m.room.id}>
                  <button
                    type="button"
                    onClick={() => {
                      const z = zones.find((x) => x.rooms.some((r) => r.room.id === m.room.id));
                      if (z) pick(z.zone.id);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-gray-2"
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ background: TONE.match }} />
                    <span className="tabular font-medium">{m.room.id}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-9">{m.room.name}</span>
                    <span className="tabular text-gray-9">{m.room.capacity}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ) : picked ? (
          <Card>
            <div className="border-b border-gray-4 px-3 py-2.5">
              <p className="font-display text-[14px] font-bold">{picked.zone.name}</p>
              <p className="text-[12px] text-gray-9">
                {picked.active} of {picked.rooms.length} rooms in use · {picked.used}/{picked.capacity} seats
              </p>
              {mode === "walk" ? (
                <button
                  type="button"
                  onClick={() => viewer.current?.walkTo(picked.zone.id)}
                  className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                >
                  <Footprints className="size-3.5" /> Walk to the entrance
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-gray-4">
              {picked.rooms.map((r) => (
                <li key={r.room.id}>
                  <RoomDetail row={r} day={day} period={period} onEnter={() => setInsideId(r.room.id)} />
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card className="p-3 text-[12px] text-gray-9">
            <p className="mb-1 font-medium text-gray-10">How to use</p>
            <p>Click a building to see each room's class, teacher and seat use for the chosen hour.</p>
            <p className="mt-1">
              Step inside a room to walk through it, or turn on <b>Free rooms</b> to light up the rooms you
              could book.
            </p>
          </Card>
        )}
      </aside>
    </div>
  );
}

function RoomDetail({
  row,
  day,
  period,
  inside,
  onEnter,
}: {
  row: RoomNow;
  day: string;
  period: number;
  inside?: boolean;
  onEnter: () => void;
}) {
  const occ = occupantOf(row);
  const r = row.room;
  const ratio = r.capacity ? Math.min(1, row.used / r.capacity) : 0;
  const free = row.state !== "event" && row.state !== "session";
  return (
    <div
      className={cn(
        "grid gap-1.5 px-3 py-2.5",
        inside && "rounded-[var(--radius-card)] border border-gray-4 bg-surface",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px]">
          <span className="tabular font-semibold">{r.id}</span>{" "}
          <span className="text-gray-9">{r.type.replaceAll("_", " ")}</span>
        </p>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] text-white"
          style={{ background: TONE[occ.tone] }}
        >
          {free ? "free" : occ.tone === "event" ? "event" : occ.tone}
        </span>
      </div>
      {!free ? (
        <p className="truncate text-[12px]">
          <span className="font-medium">{occ.title}</span> <span className="text-gray-9">{occ.detail}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-3">
          <div
            className="h-full rounded-full"
            style={{ width: `${ratio * 100}%`, background: TONE[occ.tone] }}
          />
        </div>
        <span className="tabular text-[11px] text-gray-9">
          {row.used}/{r.capacity}
        </span>
      </div>
      {r.features.length ? (
        <p className="truncate text-[11px] text-gray-8">
          {r.features.map((f) => f.replaceAll("_", " ")).join(" · ")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {!inside ? (
          <Button size="sm" variant="primary" onClick={onEnter}>
            <DoorOpen className="size-3.5" /> Step inside
          </Button>
        ) : null}
        <Link href={`/timetable?view=room&id=${r.id}` as Route}>
          <Button size="sm" variant="ghost">
            <CalendarDays className="size-3.5" /> Timetable
          </Button>
        </Link>
        {free ? (
          <Link
            href={
              `/book?room=${r.id}&day=${day}&from=${period}&to=${period}&size=${r.capacity}&type=${r.type}` as Route
            }
          >
            <Button size="sm" variant="ghost">
              Book
            </Button>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
