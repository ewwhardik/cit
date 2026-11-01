"use client";

/**
 * The deep-space backdrop behind the whole landing page, on one 2D canvas.
 *
 * Three depth layers of stars drift with scroll (near ones faster), lean toward
 * the pointer, bend away from it like light around a mass, and stretch into
 * warp streaks when the page scrolls fast. Now and then a shooting star crosses.
 * Static for reduced motion; paused while the tab is hidden.
 */
import { useEffect, useRef } from "react";

type Star = { x: number; y: number; z: number; r: number; tw: number; c: string };
type Meteor = { x: number; y: number; vx: number; vy: number; life: number };

const TINTS = ["#efe6d2", "#efe6d2", "#efe6d2", "#ffd9c4", "#ff9a6b", "#e4ffb0", "#cfe0ff"];
const LENS = 150;

export function Cosmos() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = matchMedia("(pointer: fine)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let stars: Star[] = [];
    const meteors: Meteor[] = [];

    function build() {
      dpr = Math.min(devicePixelRatio || 1, 1.5);
      w = innerWidth;
      h = innerHeight;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(Math.round((w * h) / 2600), 720);
      stars = Array.from({ length: n }, () => {
        const z = Math.random() ** 2.2 * 0.95 + 0.05;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          z,
          r: 0.35 + z * 1.5,
          tw: Math.random() * Math.PI * 2,
          c: TINTS[Math.floor(Math.random() * TINTS.length)] ?? "#efe6d2",
        };
      });
    }
    build();

    const pointer = { x: w / 2, y: h / 2, tx: w / 2, ty: h / 2, on: false };
    let lastY = scrollY;
    let warp = 0;
    let nextMeteor = performance.now() + 2500;

    function draw(now: number) {
      const sy = scrollY;
      const dy = sy - lastY;
      lastY = sy;
      warp += (Math.min(Math.abs(dy), 120) * Math.sign(dy) - warp) * 0.12;
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      const ox = (pointer.x - w / 2) / w;
      const oy = (pointer.y - h / 2) / h;

      ctx!.clearRect(0, 0, w, h);
      for (const s of stars) {
        // Parallax: near stars travel further with scroll and lean more toward the pointer.
        let x = s.x - ox * 26 * s.z;
        let y = ((((s.y - sy * s.z * 0.35) % h) + h) % h) - oy * 18 * s.z;
        if (pointer.on) {
          const ddx = x - pointer.x;
          const ddy = y - pointer.y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < LENS * LENS) {
            // Light bends around the cursor: push the star outward, strongest near the edge of the lens.
            const d = Math.sqrt(d2) + 0.01;
            const k = (1 - d / LENS) ** 2 * 26;
            x += (ddx / d) * k;
            y += (ddy / d) * k;
          }
        }
        const twinkle = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(now / (700 + s.z * 900) + s.tw);
        ctx!.globalAlpha = Math.min(1, (0.25 + s.z * 0.75) * twinkle);
        ctx!.fillStyle = s.c;
        const streak = Math.abs(warp) * s.z * 0.5;
        if (streak > 1.2) {
          ctx!.fillRect(x - s.r * 0.5, y - (warp > 0 ? 0 : streak), s.r, streak + s.r);
        } else if (s.r > 1.3) {
          ctx!.beginPath();
          ctx!.arc(x, y, s.r * 0.75, 0, Math.PI * 2);
          ctx!.fill();
          if (s.z > 0.82) {
            // Brightest stars get a soft cross flare.
            ctx!.globalAlpha *= 0.35;
            ctx!.fillRect(x - s.r * 3, y - 0.3, s.r * 6, 0.6);
            ctx!.fillRect(x - 0.3, y - s.r * 3, 0.6, s.r * 6);
          }
        } else {
          ctx!.fillRect(x - s.r / 2, y - s.r / 2, s.r, s.r);
        }
      }

      if (!reduced && now > nextMeteor) {
        nextMeteor = now + 3500 + Math.random() * 6000;
        const fromLeft = Math.random() < 0.5;
        meteors.push({
          x: fromLeft ? Math.random() * w * 0.5 : w * 0.5 + Math.random() * w * 0.5,
          y: Math.random() * h * 0.4,
          vx: (fromLeft ? 1 : -1) * (9 + Math.random() * 6),
          vy: 3.5 + Math.random() * 3,
          life: 1,
        });
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        if (!m) continue;
        m.x += m.vx;
        m.y += m.vy;
        m.life -= 0.014;
        if (m.life <= 0) {
          meteors.splice(i, 1);
          continue;
        }
        const tail = 16;
        const g = ctx!.createLinearGradient(m.x, m.y, m.x - m.vx * tail, m.y - m.vy * tail);
        g.addColorStop(0, `rgba(255,236,214,${m.life})`);
        g.addColorStop(0.3, `rgba(255,90,31,${m.life * 0.5})`);
        g.addColorStop(1, "rgba(255,90,31,0)");
        ctx!.globalAlpha = 1;
        ctx!.strokeStyle = g;
        ctx!.lineWidth = 1.6;
        ctx!.beginPath();
        ctx!.moveTo(m.x, m.y);
        ctx!.lineTo(m.x - m.vx * tail, m.y - m.vy * tail);
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
    }

    let raf = 0;
    const loop = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (reduced) draw(0);
      else raf = requestAnimationFrame(loop);
    };
    start();

    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        build();
        if (reduced) draw(0);
      }, 120);
    };
    const onMove = (e: PointerEvent) => {
      pointer.tx = e.clientX;
      pointer.ty = e.clientY;
      pointer.on = fine && e.pointerType !== "touch";
    };
    const onOut = () => {
      pointer.on = false;
      pointer.tx = w / 2;
      pointer.ty = h / 2;
    };
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else start();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onOut);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onOut);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="lx-cosmos" />;
}
