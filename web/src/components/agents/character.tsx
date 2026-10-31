"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type CharacterId = "lumi" | "vela" | "orbit";

/** Per-character palette (hue in OKLCH) and accessory. */
const LOOK: Record<CharacterId, { hue: number; accent: number; accessory: "halo" | "antenna" | "moon" }> = {
  lumi: { hue: 195, accent: 160, accessory: "halo" },
  vela: { hue: 300, accent: 330, accessory: "antenna" },
  orbit: { hue: 60, accent: 25, accessory: "moon" },
};

/**
 * A CSS-3D character: glossy sphere head with a glass visor, eyes that follow
 * the pointer, idle float, blinking, and a talking mouth while `talking`.
 */
export function Character({
  id,
  size = 56,
  talking = false,
  className,
}: {
  id: CharacterId;
  size?: number;
  talking?: boolean;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const look = LOOK[id];

  useEffect(() => {
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = root.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
        const dy = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
        el.style.setProperty("--look-x", `${Math.max(-1, Math.min(1, dx * 2.2)).toFixed(3)}`);
        el.style.setProperty("--look-y", `${Math.max(-1, Math.min(1, dy * 2.2)).toFixed(3)}`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={root}
      aria-hidden
      className={cn("char-root", talking && "char-talking", className)}
      style={
        {
          width: size,
          height: size * 1.18,
          "--c-h": look.hue,
          "--c-a": look.accent,
          "--s": `${size}px`,
        } as React.CSSProperties
      }
    >
      <div className="char-float">
        <div className="char-head">
          {look.accessory === "halo" ? <div className="char-halo" /> : null}
          {look.accessory === "antenna" ? (
            <div className="char-antenna">
              <span />
            </div>
          ) : null}
          <div className="char-sphere">
            <div className="char-visor">
              <div className="char-eyes">
                <i />
                <i />
              </div>
              <div className="char-mouth" />
            </div>
            <div className="char-cheek left" />
            <div className="char-cheek right" />
          </div>
          {look.accessory === "moon" ? (
            <div className="char-orbit">
              <span />
            </div>
          ) : null}
        </div>
      </div>
      <div className="char-shadow" />
    </div>
  );
}
