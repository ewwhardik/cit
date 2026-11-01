"use client";

import { RotateCcw, RotateCw } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { groupRooms, type RoomLite, ZONES } from "@/lib/campus-zones";
import { cn } from "@/lib/utils";

/** How a room reads in the hologram: matches and is free, matches but is booked, or filtered out. */
export type HoloState = "free" | "busy" | "out";

const U = 54; // px per campus grid unit
const FH = 17; // px per floor
const TILT = 58;
const SPIN = -32;

// Campus extent in grid units, so the stage can be centred on the turntable.
const MAX_X = Math.max(...ZONES.map((z) => z.x + z.w)) + 0.4;
const MAX_Y = Math.max(...ZONES.map((z) => z.y + z.d)) + 0.4;
// Screen width of the turned campus at the default angle, plus a margin: what has to fit.
const SPAN =
  (MAX_X * Math.cos((SPIN * Math.PI) / 180) + MAX_Y * Math.abs(Math.sin((SPIN * Math.PI) / 180))) * U + 70;

/**
 * The campus as a CSS-3D hologram: each zone is a tower, each room one floor,
 * lit by whether it fits the current search. Pure DOM + transforms (no WebGL);
 * dragging only writes two custom properties, so React never re-renders on move.
 */
export function HoloCampus({
  rooms,
  state,
  selected,
  onSelect,
}: {
  rooms: RoomLite[];
  state: Record<string, HoloState>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const grouped = useMemo(() => groupRooms(rooms), [rooms]);
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const angle = useRef({ rx: TILT, rz: SPIN });
  const drag = useRef<{ x: number; y: number; rx: number; rz: number; moved: boolean } | null>(null);
  const swallow = useRef(false);
  const [fit, setFit] = useState(1);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setFit(Math.min(1, e.contentRect.width / SPAN));
    });
    const io = new IntersectionObserver(([e]) => setPaused(!e?.isIntersecting));
    ro.observe(el);
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  function apply() {
    const s = stage.current?.style;
    if (!s) return;
    s.setProperty("--rx", `${angle.current.rx}deg`);
    s.setProperty("--rz", `${angle.current.rz}deg`);
  }

  function turn(by: number) {
    angle.current.rz += by;
    apply();
  }

  function reset() {
    angle.current = { rx: TILT, rz: SPIN };
    apply();
  }

  const counts = { free: 0, busy: 0, out: 0 };
  for (const r of rooms) counts[state[r.id] ?? "out"]++;
  const picked = rooms.find((r) => r.id === selected);

  return (
    <div
      ref={wrap}
      className={cn("holo", paused && "holo-paused")}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        swallow.current = false;
        drag.current = { x: e.clientX, y: e.clientY, ...angle.current, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;
        if (!d.moved) {
          d.moved = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        angle.current = {
          rz: d.rz + dx * 0.45,
          rx: Math.max(28, Math.min(74, d.rx - dy * 0.3)),
        };
        apply();
      }}
      onPointerUp={(e) => {
        if (drag.current?.moved) {
          e.currentTarget.releasePointerCapture(e.pointerId);
          swallow.current = true;
        }
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onClickCapture={(e) => {
        // A drag that ends over a floor shouldn't also select it.
        if (swallow.current) e.stopPropagation();
        swallow.current = false;
      }}
    >
      <div className="holo-beam" aria-hidden />
      <div className="holo-scene">
        <div
          ref={stage}
          className="holo-stage"
          style={
            {
              width: MAX_X * U,
              height: MAX_Y * U,
              marginLeft: (-MAX_X * U) / 2,
              marginTop: (-MAX_Y * U) / 2,
              "--rx": `${TILT}deg`,
              "--rz": `${SPIN}deg`,
              "--fit": fit,
            } as CSSProperties
          }
        >
          <div className="holo-grid" aria-hidden />
          <div className="holo-rings" aria-hidden />
          <div className="holo-sweep" aria-hidden />
          {ZONES.map((z) => {
            const list = [...(grouped.get(z.id) ?? [])];
            const flat = z.id === "Z-OAT";
            const fh = flat ? 7 : FH;
            const lit = list.some((r) => state[r.id] === "free");
            return (
              <div
                key={z.id}
                className={cn("holo-zone", lit && "holo-zone-lit")}
                style={{ left: z.x * U, top: z.y * U, width: z.w * U, height: z.d * U }}
              >
                <div className="holo-pad" aria-hidden />
                {list.map((r, i) => {
                  const st = state[r.id] ?? "out";
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: a <button> can't carry preserve-3d children reliably across browsers.
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={st === "out" ? -1 : 0}
                      aria-pressed={selected === r.id}
                      aria-label={`${r.id}, ${r.name}, ${r.capacity} seats, ${READS[st]}`}
                      className={cn("holo-floor", `holo-${st}`, selected === r.id && "holo-sel")}
                      style={{ transform: `translateZ(${i * fh}px)`, "--h": `${fh - 3}px` } as CSSProperties}
                      onClick={() => onSelect(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(r.id);
                        }
                      }}
                    >
                      <i className="holo-f holo-top" />
                      <i className="holo-f holo-n" />
                      <i className="holo-f holo-s" />
                      <i className="holo-f holo-w" />
                      <i className="holo-f holo-e" />
                    </div>
                  );
                })}
                <span
                  className="holo-tag"
                  style={{ transform: `translateZ(${list.length * fh + 16}px) ${BILLBOARD}` }}
                >
                  {z.short}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="holo-scan" aria-hidden />
      <div className="holo-hud holo-hud-tl">
        <span>Holo-campus</span>
        <span className="holo-dim">
          {counts.free} free · {counts.busy} busy · {counts.out} filtered
        </span>
      </div>
      <div className="holo-hud holo-hud-br">
        <button type="button" onClick={() => turn(-30)} aria-label="Rotate left">
          <RotateCcw className="size-3.5" />
        </button>
        <button type="button" onClick={reset} className="px-2">
          Reset
        </button>
        <button type="button" onClick={() => turn(30)} aria-label="Rotate right">
          <RotateCw className="size-3.5" />
        </button>
      </div>
      <p className="holo-hud holo-hud-bl holo-dim max-sm:hidden">Drag to orbit · tap a floor</p>
      {picked ? (
        <div className="holo-hud holo-hud-tr" aria-live="polite">
          <span>{picked.id}</span>
          <span className="holo-dim">
            {picked.capacity} seats · {READS[state[picked.id] ?? "out"]}
          </span>
        </div>
      ) : null}
    </div>
  );
}

const READS: Record<HoloState, string> = { free: "free", busy: "busy", out: "doesn't match" };

// Undo the stage rotation so labels face the viewer at any angle.
const BILLBOARD = "rotateZ(calc(-1 * var(--rz))) rotateX(calc(-1 * var(--rx)))";
