"use client";

/**
 * The finale: the wordmark drawn in a few thousand stars, and the pointer is a
 * black hole. Stars near it are pulled in and whipped into an accretion disk,
 * fast cursor moves drag a wake through the letters, and a click sets off a
 * supernova that blows the word apart before gravity springs it back together.
 * With no pointer around (touch, or idle) the hole drifts across on its own.
 */
import { useEffect, useRef } from "react";

const BONE = "239,230,210";
const EMBER = "255,90,31";
const LIME = "198,255,61";

type Wave = { x: number; y: number; r: number; life: number };

export function Singularity({
  text,
  onStats,
}: {
  text: string;
  onStats?: (captured: number, total: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statsRef = useRef(onStats);
  statsRef.current = onStats;

  useEffect(() => {
    const el = host.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!el || !canvas || !ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    // Struct-of-arrays so the per-frame loop stays allocation free.
    let n = 0;
    let px = new Float32Array(0);
    let py = new Float32Array(0);
    let vx = new Float32Array(0);
    let vy = new Float32Array(0);
    let hx = new Float32Array(0);
    let hy = new Float32Array(0);
    let seed = new Float32Array(0);
    const waves: Wave[] = [];
    const hole = { x: -999, y: -999, tx: -999, ty: -999, vx: 0, vy: 0, power: 0, spin: 0 };
    let pointerAt = 0;
    let pointerIn = false;

    function sample() {
      dpr = Math.min(devicePixelRatio || 1, 1.5);
      w = el!.clientWidth;
      h = el!.clientHeight;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Lay the word out on an offscreen canvas in the display face, then keep every few pixels.
      const lines = w < 720 ? text.split("/").map((t, i, a) => (i < a.length - 1 ? `${t}/` : t)) : [text];
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.round(w));
      off.height = Math.max(1, Math.round(h));
      const o = off.getContext("2d", { willReadFrequently: true });
      if (!o) return;
      const family = getComputedStyle(el!).getPropertyValue("--lx-display").trim() || "sans-serif";
      let size = Math.min(h / (lines.length * 1.05), 260);
      o.font = `800 ${size}px ${family}`;
      const widest = Math.max(...lines.map((l) => o.measureText(l).width));
      if (widest > w * 0.92) size *= (w * 0.92) / widest;
      o.font = `800 ${size}px ${family}`;
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.fillStyle = "#fff";
      const lh = size * 0.98;
      lines.forEach((l, i) => {
        o.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh);
      });
      const data = o.getImageData(0, 0, off.width, off.height).data;
      const budget = w < 720 ? 2600 : 5200;
      let gap = Math.max(3, Math.round(size / 42));
      let pts: number[] = [];
      for (;;) {
        pts = [];
        for (let y = 0; y < off.height; y += gap)
          for (let x = 0; x < off.width; x += gap)
            if ((data[(y * off.width + x) * 4 + 3] ?? 0) > 128) pts.push(x, y);
        if (pts.length / 2 <= budget || gap > 12) break;
        gap += 1;
      }
      const prevN = n;
      const oldX = px;
      const oldY = py;
      n = pts.length / 2;
      px = new Float32Array(n);
      py = new Float32Array(n);
      vx = new Float32Array(n);
      vy = new Float32Array(n);
      hx = new Float32Array(n);
      hy = new Float32Array(n);
      seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        hx[i] = (pts[i * 2] ?? 0) + (Math.random() - 0.5) * gap * 0.6;
        hy[i] = (pts[i * 2 + 1] ?? 0) + (Math.random() - 0.5) * gap * 0.6;
        seed[i] = Math.random();
        if (i < prevN) {
          px[i] = oldX[i] ?? 0;
          py[i] = oldY[i] ?? 0;
        } else {
          // First build: stars stream in from a wide ring around the word.
          const a = Math.random() * Math.PI * 2;
          const r = Math.max(w, h) * (0.6 + Math.random() * 0.5);
          px[i] = w / 2 + Math.cos(a) * r;
          py[i] = h / 2 + Math.sin(a) * r * 0.6;
        }
        if (reduced) {
          px[i] = hx[i] ?? 0;
          py[i] = hy[i] ?? 0;
        }
      }
    }

    function step(now: number) {
      // Autopilot: with no pointer for a while, the hole wanders a slow figure-eight over the word.
      const idle = !pointerIn && now - pointerAt > 1400;
      if (idle) {
        const t = now / 4200;
        hole.tx = w / 2 + Math.sin(t) * w * 0.36;
        hole.ty = h / 2 + Math.sin(t * 2) * h * 0.22;
      }
      const lastX = hole.x;
      const lastY = hole.y;
      const ease = idle ? 0.04 : 0.32;
      hole.x += (hole.tx - hole.x) * ease;
      hole.y += (hole.ty - hole.y) * ease;
      hole.vx = hole.x - lastX;
      hole.vy = hole.y - lastY;
      hole.power += ((idle ? 0.45 : pointerIn ? 1 : 0) - hole.power) * 0.06;
      hole.spin += 0.035 + hole.power * 0.02;

      const R = Math.min(190, Math.max(110, w * 0.13));
      const R2 = R * R;
      const pull = 0.85 * hole.power;
      const swirl = 1.9 * hole.power;
      const drag = 0.18 * hole.power;
      let captured = 0;

      for (let i = 0; i < n; i++) {
        let x = px[i] ?? 0;
        let y = py[i] ?? 0;
        let ax = ((hx[i] ?? 0) - x) * 0.011;
        let ay = ((hy[i] ?? 0) - y) * 0.011;
        const dx = hole.x - x;
        const dy = hole.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2 && hole.power > 0.02) {
          const d = Math.sqrt(d2) + 0.5;
          const f = 1 - d / R;
          const ux = dx / d;
          const uy = dy / d;
          ax += ux * f * pull - uy * f * swirl + hole.vx * f * drag;
          ay += uy * f * pull + ux * f * swirl + hole.vy * f * drag;
          captured++;
        }
        for (const wv of waves) {
          const ex = x - wv.x;
          const ey = y - wv.y;
          const ed = Math.sqrt(ex * ex + ey * ey) + 0.5;
          // Only the expanding shell pushes, so the blast travels outward through the word.
          const band = Math.abs(ed - wv.r);
          if (band < 60) {
            const k = (1 - band / 60) * wv.life * 2.6;
            ax += (ex / ed) * k;
            ay += (ey / ed) * k;
          }
        }
        let nvx = ((vx[i] ?? 0) + ax) * 0.9;
        let nvy = ((vy[i] ?? 0) + ay) * 0.9;
        const sp = nvx * nvx + nvy * nvy;
        if (sp > 900) {
          const s = 30 / Math.sqrt(sp);
          nvx *= s;
          nvy *= s;
        }
        x += nvx;
        y += nvy;
        vx[i] = nvx;
        vy[i] = nvy;
        px[i] = x;
        py[i] = y;
      }
      for (let i = waves.length - 1; i >= 0; i--) {
        const wv = waves[i];
        if (!wv) continue;
        wv.r += 14;
        wv.life -= 0.022;
        if (wv.life <= 0) waves.splice(i, 1);
      }
      return captured;
    }

    function render() {
      // Translucent wipe instead of a clear, so fast stars leave light trails.
      ctx!.globalCompositeOperation = "source-over";
      ctx!.fillStyle = "rgba(7,6,5,0.3)";
      ctx!.fillRect(0, 0, w, h);

      // Accretion glow under the stars.
      if (hole.power > 0.02) {
        const R = Math.min(190, Math.max(110, w * 0.13));
        const g = ctx!.createRadialGradient(hole.x, hole.y, 0, hole.x, hole.y, R * 1.15);
        g.addColorStop(0, `rgba(${EMBER},${0.0})`);
        g.addColorStop(0.12, `rgba(${EMBER},${0.38 * hole.power})`);
        g.addColorStop(0.32, `rgba(${LIME},${0.08 * hole.power})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(hole.x, hole.y, R * 1.15, 0, Math.PI * 2);
        ctx!.fill();
      }

      // Stars, bucketed by speed: bone at rest, ember when moving, lime when screaming.
      ctx!.globalCompositeOperation = "lighter";
      for (let pass = 0; pass < 3; pass++) {
        ctx!.fillStyle =
          pass === 0 ? `rgba(${BONE},0.85)` : pass === 1 ? `rgba(${EMBER},0.95)` : `rgba(${LIME},1)`;
        for (let i = 0; i < n; i++) {
          const a = vx[i] ?? 0;
          const b = vy[i] ?? 0;
          const sp = a * a + b * b;
          const bucket = sp < 2.2 ? 0 : sp < 40 ? 1 : 2;
          if (bucket !== pass) continue;
          const s = 1.1 + (seed[i] ?? 0) * 1.3 + (bucket ? 0.5 : 0);
          ctx!.fillRect((px[i] ?? 0) - s / 2, (py[i] ?? 0) - s / 2, s, s);
        }
      }
      ctx!.globalCompositeOperation = "source-over";

      // Shock shells from clicks.
      for (const wv of waves) {
        ctx!.strokeStyle = `rgba(${LIME},${wv.life * 0.7})`;
        ctx!.lineWidth = 2 + wv.life * 6;
        ctx!.beginPath();
        ctx!.arc(wv.x, wv.y, wv.r, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.strokeStyle = `rgba(${EMBER},${wv.life * 0.5})`;
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.arc(wv.x, wv.y, wv.r * 0.82, 0, Math.PI * 2);
        ctx!.stroke();
      }

      // The hole itself: photon ring, two spinning disk arcs, and a true-black event horizon.
      if (hole.power > 0.02) {
        const p = hole.power;
        const core = 14 + p * 8;
        ctx!.save();
        ctx!.translate(hole.x, hole.y);
        ctx!.rotate(hole.spin);
        for (const [rx, ry, col, lw] of [
          [core * 2.6, core * 0.9, EMBER, 3],
          [core * 2.1, core * 0.7, LIME, 1.5],
        ] as const) {
          const grad = ctx!.createLinearGradient(-rx, 0, rx, 0);
          grad.addColorStop(0, `rgba(${col},0)`);
          grad.addColorStop(0.5, `rgba(${col},${0.9 * p})`);
          grad.addColorStop(1, `rgba(${col},0)`);
          ctx!.strokeStyle = grad;
          ctx!.lineWidth = lw;
          ctx!.beginPath();
          ctx!.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
          ctx!.stroke();
        }
        ctx!.restore();
        ctx!.strokeStyle = `rgba(255,240,220,${0.85 * p})`;
        ctx!.lineWidth = 1.5;
        ctx!.shadowColor = `rgba(${EMBER},1)`;
        ctx!.shadowBlur = 18;
        ctx!.beginPath();
        ctx!.arc(hole.x, hole.y, core + 2, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.shadowBlur = 0;
        ctx!.fillStyle = "#000";
        ctx!.beginPath();
        ctx!.arc(hole.x, hole.y, core, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    let raf = 0;
    let running = false;
    let frame = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const captured = step(now);
      render();
      if (++frame % 8 === 0) statsRef.current?.(captured, n);
    };
    const play = () => {
      if (running || reduced) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const pause = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const ready = document.fonts?.ready ?? Promise.resolve();
    let alive = true;
    ready.then(() => {
      if (!alive) return;
      sample();
      if (reduced) {
        ctx.fillStyle = "#070605";
        ctx.fillRect(0, 0, w, h);
        render();
      }
      statsRef.current?.(0, n);
    });

    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      hole.tx = p.x;
      hole.ty = p.y;
      if (!pointerIn) {
        hole.x = p.x;
        hole.y = p.y;
      }
      pointerIn = true;
      pointerAt = performance.now();
    };
    const onLeave = () => {
      pointerIn = false;
      pointerAt = performance.now();
    };
    const onDown = (e: PointerEvent) => {
      const p = local(e);
      waves.push({ x: p.x, y: p.y, r: 4, life: 1 });
      // The blast also kicks every star directly, strongest close to the hole.
      for (let i = 0; i < n; i++) {
        const ex = (px[i] ?? 0) - p.x;
        const ey = (py[i] ?? 0) - p.y;
        const d = Math.sqrt(ex * ex + ey * ey) + 1;
        const k = 26 / (1 + d / 90);
        vx[i] = (vx[i] ?? 0) + (ex / d) * k;
        vy[i] = (vy[i] ?? 0) + (ey / d) * k;
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);

    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !document.hidden) play();
      else pause();
    });
    io.observe(el);
    const onVis = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", onVis);

    let resizeTimer = 0;
    let lastW = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastW) return;
      lastW = el.clientWidth;
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        sample();
        if (reduced) render();
      }, 150);
    });
    ro.observe(el);

    return () => {
      alive = false;
      pause();
      clearTimeout(resizeTimer);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
    };
  }, [text]);

  return (
    <div ref={host} data-cursor="hide" className="lx-singularity">
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
    </div>
  );
}
