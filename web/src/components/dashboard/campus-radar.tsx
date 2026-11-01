"use client";

/**
 * Campus radar: the live campus status as an isometric map. Each building is a
 * box coloured by what is in it for the chosen slot (lime lectures, amber labs,
 * magenta fest events, ghost when empty), filled up its side by seats in use,
 * with a beacon on top while anything runs. Scrub the week along the bottom,
 * click a building to inspect its rooms. All data is precomputed on the server;
 * the map is plain SVG + CSS animation, paused while off screen.
 */
import { Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { playBlip, playChime, playTick } from "@/lib/audio-haptics";
import {
  boxFaces,
  DRAW_ORDER,
  groupRooms,
  iso,
  pts,
  type RoomLite,
  type SlotState,
  ZONES,
  type ZoneNow,
  type ZoneStatus,
  zonesAt,
} from "@/lib/campus-zones";
import { DAYS, periodRange } from "@/lib/time";
import { cn } from "@/lib/utils";
import { SlotLists } from "./now-panel";

const COLOR: Record<ZoneStatus, string> = {
  lecture: "#c6ff3d",
  lab: "#ff9a6b",
  event: "#d946ef",
  empty: "#efe6d2",
};
const STATUS_LABEL: Record<ZoneStatus, string> = {
  lecture: "Classes",
  lab: "Labs",
  event: "Fest event",
  empty: "Quiet",
};
const PERIODS = 9;
const EMPTY: SlotState = { running: [], events: [], free: [] };

// Map bounds from every corner of every building (plus beacon headroom).
const BOUNDS = (() => {
  const all = ZONES.flatMap((z) => Object.values(boxFaces(z)).flat());
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const pad = 24;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad - 34;
  return { x0, y0, w: Math.max(...xs) - x0 + pad, h: Math.max(...ys) - y0 + pad };
})();
const GROUND = pts([iso(-0.2, -0.2), iso(9.4, -0.2), iso(9.4, 6.9), iso(-0.2, 6.9)]);
const CENTER = iso(4.6, 3.35);

export function CampusRadar({
  slots,
  live,
  next,
  rooms,
}: {
  slots: Record<string, SlotState>;
  live: { day: string; period: number; isLive: boolean };
  next: { label: string; detail: string } | null;
  rooms: RoomLite[];
}) {
  const card = useRef<HTMLDivElement>(null);
  const [day, setDay] = useState(live.day);
  const [period, setPeriod] = useState(live.period);
  const [view, setView] = useState<"radar" | "list">("radar");
  const [picked, setPicked] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [sound, setSound] = useState(false);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      setSound(localStorage.getItem("cit_sfx") === "1");
    }
  }, []);

  const grouped = useMemo(() => groupRooms(rooms), [rooms]);
  const info = slots[`${day}|${period}`] ?? EMPTY;
  const zones = useMemo(() => zonesAt(info, grouped), [info, grouped]);
  const byId = useMemo(() => new Map(zones.map((z) => [z.zone.id, z])), [zones]);
  const atLive = day === live.day && period === live.period;
  const busiest = zones.reduce<ZoneNow | undefined>((a, z) => (!a || z.used > a.used ? z : a), undefined);
  const selected = (picked ? byId.get(picked) : undefined) ?? busiest;
  const seats = zones.reduce((n, z) => n + z.used, 0);
  const liveRooms = zones.reduce((n, z) => n + z.active, 0);

  // Week-long activity strip under the scrubber.
  const strip = useMemo(
    () =>
      DAYS.flatMap((d) =>
        Array.from({ length: PERIODS }, (_, i) => {
          const s = slots[`${d}|${i + 1}`];
          return {
            d,
            p: i + 1,
            n: (s?.running.length ?? 0) + (s?.events.length ?? 0),
            ev: Boolean(s?.events.length),
          };
        }),
      ),
    [slots],
  );
  const peak = Math.max(1, ...strip.map((s) => s.n));
  const index = Math.max(0, DAYS.indexOf(day as (typeof DAYS)[number])) * PERIODS + period - 1;

  // Stop the sweep and pulses while the card is off screen.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => setPaused(!e[0]?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  function jump(i: number) {
    const d = DAYS[Math.floor(i / PERIODS)];
    if (!d) return;
    const p = (i % PERIODS) + 1;
    if (d !== day || p !== period) {
      playTick(sound);
    }
    setDay(d);
    setPeriod(p);
  }

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader
        title={atLive && live.isLive ? "Campus radar · live" : "Campus radar"}
        description={
          <>
            {day} {periodRange(period, period)} · <span className="tabular">{liveRooms}</span> rooms in use ·{" "}
            <span className="tabular">{seats.toLocaleString("en-IN")}</span> seats filled ·{" "}
            <span className="tabular">{info.free.length}</span> rooms free
          </>
        }
        action={
          <div className="flex shrink-0 items-center gap-2">
            {!atLive ? (
              <button
                type="button"
                onClick={() => {
                  playChime(sound);
                  setDay(live.day);
                  setPeriod(live.period);
                }}
                className="text-[12px] text-accent hover:underline"
              >
                Back to {live.isLive ? "live" : "now"}
              </button>
            ) : live.isLive ? (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-ok">
                <span className="size-1.5 animate-pulse rounded-full bg-ok" /> LIVE
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setSound((s) => {
                  const next = !s;
                  if (typeof localStorage !== "undefined") {
                    localStorage.setItem("cit_sfx", next ? "1" : "0");
                  }
                  if (next) playBlip(true);
                  return next;
                });
              }}
              title={sound ? "Mute audio haptics" : "Enable synthesized audio haptics"}
              className={cn(
                "flex h-6 items-center gap-1 rounded-[6px] px-2 text-[11px] transition-colors max-md:h-8",
                sound
                  ? "bg-surface font-medium text-accent shadow-sm"
                  : "text-gray-8 hover:text-gray-10",
              )}
            >
              {sound ? <Volume2 className="size-3" /> : <VolumeX className="size-3 text-gray-7" />}
              <span className="max-sm:hidden">{sound ? "SFX" : "Muted"}</span>
            </button>
            <div
              role="tablist"
              aria-label="View"
              className="flex rounded-[var(--radius-control)] bg-gray-2 p-0.5"
            >
              {(["radar", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "h-6 rounded-[6px] px-2 text-[11px] capitalize transition-colors max-md:h-8",
                    view === v ? "bg-surface font-medium shadow-sm" : "text-gray-9 hover:text-gray-10",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div ref={card} className="grid gap-4 p-4">
        {view === "radar" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className={cn("cr-screen", paused && "cr-paused")}>
              <div aria-hidden className="cr-sweep-plane">
                <div className="cr-sweep" />
              </div>
              <p aria-hidden className="cr-hud cr-hud-tl">
                <span>
                  Sweep · {day} P{period}
                </span>
                <span>{periodRange(period, period)}</span>
              </p>
              <svg
                viewBox={`${BOUNDS.x0} ${BOUNDS.y0} ${BOUNDS.w} ${BOUNDS.h}`}
                className="relative block h-auto w-full"
              >
                <title>{`Campus map for ${day} period ${period}`}</title>
                <polygon points={GROUND} className="cr-ground" />
                {[1, 2, 3].map((r) => (
                  <ellipse
                    key={r}
                    cx={CENTER[0]}
                    cy={CENTER[1]}
                    rx={r * 110}
                    ry={r * 55}
                    className="cr-range"
                    style={{ opacity: 0.5 - r * 0.1 }}
                  />
                ))}
                {DRAW_ORDER.map((z) => {
                  const now = byId.get(z.id);
                  return now ? (
                    <Pod
                      key={z.id}
                      now={now}
                      selected={selected?.zone.id === z.id}
                      onPick={() => setPicked(z.id)}
                      sound={sound}
                    />
                  ) : null;
                })}
              </svg>
              <ul aria-hidden className="cr-hud cr-legend">
                {(["lecture", "lab", "event", "empty"] as const).map((s) => (
                  <li key={s}>
                    <span style={{ background: COLOR[s], opacity: s === "empty" ? 0.35 : 1 }} />
                    {s === "empty" ? "Free" : STATUS_LABEL[s]}
                  </li>
                ))}
              </ul>
            </div>
            {selected ? <Inspector now={selected} /> : null}
          </div>
        ) : (
          <SlotLists info={info} />
        )}

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
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
            <p className="tabular text-[11px] text-gray-8">Drag to scrub the week · lunch 13:00–14:00</p>
          </div>
          <div className="cr-scrub">
            <div aria-hidden className="cr-strip">
              {strip.map((s, i) => (
                <span
                  key={`${s.d}${s.p}`}
                  className={cn(
                    "cr-bar",
                    i === index && "cr-bar-on",
                    s.p === 1 && i > 0 && "cr-bar-day",
                    s.ev && "cr-bar-ev",
                  )}
                  style={{ height: `${12 + (s.n / peak) * 88}%` }}
                />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={DAYS.length * PERIODS - 1}
              value={index}
              onChange={(e) => jump(Number(e.target.value))}
              aria-label="Time slot"
              aria-valuetext={`${day} period ${period}, ${periodRange(period, period)}`}
              className="cr-range-input"
            />
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

function Pod({
  now,
  selected,
  onPick,
  sound,
}: {
  now: ZoneNow;
  selected: boolean;
  onPick: () => void;
  sound: boolean;
}) {
  const { zone, status, ratio, active } = now;
  const c = COLOR[status];
  const on = status !== "empty";
  const f = boxFaces(zone);
  const fill = boxFaces(zone, zone.h * Math.min(1, ratio));
  const top = iso(zone.x + zone.w / 2, zone.y + zone.d / 2, zone.h);
  const foot = pts([
    iso(zone.x - 0.15, zone.y - 0.15),
    iso(zone.x + zone.w + 0.15, zone.y - 0.15),
    iso(zone.x + zone.w + 0.15, zone.y + zone.d + 0.15),
    iso(zone.x - 0.15, zone.y + zone.d + 0.15),
  ]);
  const fillPath = `M${pts(fill.left).replaceAll(" ", " L")}Z`;
  const handlePick = () => {
    playBlip(sound);
    onPick();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${zone.name}: ${STATUS_LABEL[status]}, ${active} of ${now.rooms.length} rooms in use, ${Math.round(ratio * 100)}% of seats`}
      onClick={handlePick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handlePick();
        }
      }}
      className={cn("cr-pod", on && "cr-pod-on", selected && "cr-pod-sel")}
      style={{ "--c": c } as React.CSSProperties}
    >
      <title>{`${zone.name} (${zone.short}): ${STATUS_LABEL[status]} · ${active}/${now.rooms.length} rooms active · ${Math.round(ratio * 100)}% seats filled`}</title>
      <polygon points={foot} className="cr-foot" />
      <polygon points={pts(f.left)} className="cr-face-l" />
      <polygon points={pts(f.right)} className="cr-face-r" />
      {ratio > 0 ? <path d={fillPath} className="cr-fill" /> : null}
      <polygon points={pts(f.top)} className="cr-face-t" />
      {on ? (
        <g className="cr-beacon">
          <line x1={top[0]} y1={top[1]} x2={top[0]} y2={top[1] - 30} />
          <ellipse cx={top[0]} cy={top[1]} rx={16} ry={8} className="cr-pulse" />
          <circle cx={top[0]} cy={top[1] - 30} r={2.6} />
        </g>
      ) : null}
      <text x={top[0]} y={top[1] - (on ? 38 : 8)} className="cr-label">
        {zone.short}
      </text>
    </g>
  );
}

function Inspector({ now }: { now: ZoneNow }) {
  const { zone, status, ratio, used, capacity, rooms } = now;
  const c = COLOR[status];
  const features = [...new Set(rooms.flatMap((r) => r.room.features))];
  return (
    <div className="cr-inspector" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-[14px] font-bold tracking-tight text-gray-10">
            {zone.name}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-8">
            {now.active} of {rooms.length} rooms in use
          </p>
        </div>
        <span className="cr-chip" style={{ "--c": c } as React.CSSProperties}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      <div className="mt-3">
        <div className="flex items-baseline justify-between text-[11px] text-gray-8">
          <span>Seats</span>
          <span className="tabular text-gray-10">
            {used.toLocaleString("en-IN")} / {capacity.toLocaleString("en-IN")} · {Math.round(ratio * 100)}%
          </span>
        </div>
        <div className="cr-gauge mt-1.5">
          <span
            style={{
              width: `${Math.min(100, ratio * 100)}%`,
              background: status === "empty" ? undefined : c,
            }}
          />
        </div>
      </div>
      <ul className="mt-3 grid max-h-[230px] gap-1.5 overflow-y-auto pr-1">
        {rooms.map((r) => {
          const tone =
            r.state === "event"
              ? COLOR.event
              : r.state === "session"
                ? r.session.kind === "lab"
                  ? COLOR.lab
                  : COLOR.lecture
                : null;
          return (
            <li key={r.room.id}>
              <Link href={`/timetable?view=room&id=${r.room.id}`} className="cr-room">
                <span
                  className="cr-dot"
                  style={tone ? { background: tone, boxShadow: `0 0 8px ${tone}` } : undefined}
                />
                <span className="tabular w-[68px] shrink-0 font-medium text-gray-10">{r.room.id}</span>
                <span className="min-w-0 flex-1 truncate text-gray-9">
                  {r.state === "event"
                    ? r.event.title
                    : r.state === "session"
                      ? `${r.session.course} · ${r.session.groups.join(", ")}${r.session.faculty ? ` · ${r.session.faculty}` : ""}`
                      : r.state === "free"
                        ? `Free · ${r.room.capacity} seats`
                        : "Not open for classes"}
                </span>
                <span className="tabular shrink-0 text-[10px] text-gray-8">
                  {r.used ? `${r.used}/${r.room.capacity}` : r.room.capacity}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {features.length ? (
        <div className="mt-3 flex flex-wrap gap-1 border-t border-gray-4 pt-3">
          {features.map((f) => (
            <span key={f} className="rounded-full border border-gray-4 px-2 py-0.5 text-[10px] text-gray-9">
              {f.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
