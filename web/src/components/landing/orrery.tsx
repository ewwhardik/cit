"use client";

/**
 * The week as a solar system: the engine is the sun and everything it schedules
 * orbits it, one planet per kind of thing in the dataset, sized by how many there
 * are. Pure CSS 3D (a tilted plane, counter-rotated planets), so it costs no GPU
 * context. The whole system leans toward the pointer; hovering or focusing a
 * planet stops time and reads it out.
 */
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type OrreryBody = { key: string; label: string; n: number | null; blurb: string; color: string };

export function Orrery({ bodies, hard }: { bodies: OrreryBody[]; hard: number | null }) {
  const stage = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const max = Math.max(1, ...bodies.map((b) => b.n ?? 1));
  const current = bodies[active];

  function lean(e: React.PointerEvent) {
    const el = stage.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--lean-x", `${((e.clientY - r.top) / r.height - 0.5) * -14}deg`);
    el.style.setProperty("--lean-y", `${((e.clientX - r.left) / r.width - 0.5) * 18}deg`);
  }

  return (
    <div className="grid items-center gap-10 lg:grid-cols-[1fr_360px]">
      <div
        ref={stage}
        className="lx-orrery"
        onPointerMove={lean}
        onPointerLeave={() => {
          stage.current?.style.setProperty("--lean-x", "0deg");
          stage.current?.style.setProperty("--lean-y", "0deg");
        }}
      >
        <div className="lx-orrery-lean">
          <div className="lx-orrery-plane">
            {bodies.map((b, i) => {
              const size = 14 + Math.sqrt((b.n ?? 1) / max) * 30;
              return (
                <div
                  key={b.key}
                  className="lx-orbit"
                  style={
                    {
                      "--r": `${24 + i * 12.5}%`,
                      "--dur": `${18 + i * 9}s`,
                      "--delay": `${-(i * 7.3) % 40}s`,
                    } as React.CSSProperties
                  }
                >
                  <div className="lx-orbit-arm">
                    <button
                      type="button"
                      aria-pressed={active === i}
                      aria-label={`${b.label}: ${b.n ?? "not loaded"}`}
                      onPointerEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onClick={() => setActive(i)}
                      className={cn("lx-planet", active === i && "lx-planet-on")}
                      style={{ "--c": b.color, "--s": `${size}px` } as React.CSSProperties}
                    >
                      <span className="lx-planet-ball" aria-hidden />
                      {b.key === "requests" ? <span className="lx-planet-ring" aria-hidden /> : null}
                      <span className="lx-planet-tag" aria-hidden>
                        {b.label}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="lx-sun" aria-hidden>
              <span className="lx-sun-corona" />
              <span className="lx-sun-core" />
            </div>
          </div>
        </div>
      </div>

      <div className="lx-card relative z-10 p-7" aria-live="polite">
        <p className="lx-eyebrow">
          <span className="lx-swatch" style={{ background: current?.color }} /> Orbit {active + 1} of{" "}
          {bodies.length}
        </p>
        <p className="lx-metric mt-5" style={{ color: current?.color }}>
          {current?.n ?? "–"}
        </p>
        <p className="lx-h3 mt-2">{current?.label}</p>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--lx-bone)]/60">{current?.blurb}</p>
        <div className="mt-7 flex items-center gap-3 border-t border-[var(--lx-line)] pt-5">
          <span className="lx-sun-mini" aria-hidden />
          <p className="text-[13px] leading-snug text-[var(--lx-bone)]/55">
            At the centre: the engine.{" "}
            {hard === null
              ? "Run Generate to light it."
              : `${hard} hard-rule violations in the current week.`}
          </p>
        </div>
      </div>
    </div>
  );
}
