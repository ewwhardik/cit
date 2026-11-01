"use client";

/** Small interaction primitives for the landing page: tilt + spotlight cards, magnetic links, count-up numbers, reveal on scroll, text decode, mission clock, comet cursor. */
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function prefersReduced() {
  return typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Card that tilts toward the pointer and carries a soft light where the pointer is. */
export function TiltCard({
  children,
  className,
  max = 7,
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  max?: number;
  as?: "div" | "article" | "li";
} & React.HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  function move(e: React.PointerEvent) {
    const el = ref.current;
    if (!el || e.pointerType === "touch" || prefersReduced()) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--rx", `${(0.5 - py) * max}deg`);
    el.style.setProperty("--ry", `${(px - 0.5) * max}deg`);
    el.style.setProperty("--mx", `${px * 100}%`);
    el.style.setProperty("--my", `${py * 100}%`);
  }
  function leave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }
  return (
    <Tag
      // biome-ignore lint/suspicious/noExplicitAny: polymorphic ref across div/article/li
      ref={ref as any}
      onPointerMove={move}
      onPointerLeave={leave}
      className={cn("lx-tilt", className)}
      {...rest}
    >
      <span aria-hidden className="lx-spot" />
      {children}
    </Tag>
  );
}

/** Link whose pill drifts toward the pointer. */
export function MagneticLink({
  href,
  children,
  className,
  onClick,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  function move(e: React.PointerEvent) {
    const el = ref.current;
    if (!el || e.pointerType === "touch" || prefersReduced()) return;
    const r = el.getBoundingClientRect();
    el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px, ${(e.clientY - r.top - r.height / 2) * 0.28}px)`;
  }
  return (
    <Link
      ref={ref}
      href={href as never}
      onClick={onClick}
      onPointerMove={move}
      onPointerLeave={() => {
        if (ref.current) ref.current.style.transform = "";
      }}
      className={cn("lx-magnet", className)}
    >
      {children}
    </Link>
  );
}

/** Number that counts up the first time it scrolls into view. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReduced()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min((now - t0) / 1200, 1);
        setShown(Math.round(value * (1 - (1 - t) ** 4)));
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return (
    <span ref={ref} className={className}>
      {shown.toLocaleString("en-IN")}
    </span>
  );
}

/** Fades and lifts its children in when they enter the viewport. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={cn("lx-reveal", inView && "lx-in", className)}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/** Headline text that rises in letter by letter from behind a mask. Screen readers get the plain string. */
export function SplitWords({ text, delay = 0 }: { text: string; delay?: number }) {
  const chars = [...text].map((ch, i) => ({ ch, id: `${text}:${i}`, at: delay + i * 45 }));
  return (
    <span className="lx-split">
      <span className="sr-only">{text}</span>
      {chars.map((c) => (
        <span key={c.id} aria-hidden className="lx-char" style={{ animationDelay: `${c.at}ms` }}>
          {c.ch === " " ? "\u00a0" : c.ch}
        </span>
      ))}
    </span>
  );
}

const GLYPHS = "!<>-_\\/[]{}=+*^?#01✺◦·";

/** Text that decodes from random glyphs into place the first time it scrolls into view. */
export function Scramble({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const run = (now: number) => {
          const done = (now - t0) / 28;
          let out = "";
          for (let i = 0; i < text.length; i++) {
            const ch = text[i] ?? "";
            out += ch === " " || i < done - 6 ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          }
          el.textContent = out;
          if (done - 6 < text.length) raf = requestAnimationFrame(run);
          else el.textContent = text;
        };
        raf = requestAnimationFrame(run);
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [text]);
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span ref={ref} aria-hidden>
        {text}
      </span>
    </span>
  );
}

/** "T+00:01:23" since the page opened, ticking without re-rendering anything else. */
export function MissionClock() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const t0 = Date.now();
    const tick = () => {
      const s = Math.floor((Date.now() - t0) / 1000);
      const pad = (v: number) => String(v).padStart(2, "0");
      if (ref.current)
        ref.current.textContent = `T+${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span ref={ref} className="tabular-nums" suppressHydrationWarning />;
}

const TRAIL = 7;

/** A blend-mode cursor ring with a comet tail that swells over anything clickable (fine pointers only). */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const tail = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (!matchMedia("(pointer: fine)").matches || prefersReduced()) return;
    const d = dot.current;
    const r = ring.current;
    if (!d || !r) return;
    document.documentElement.classList.add("lx-has-cursor");
    const target = { x: innerWidth / 2, y: innerHeight / 2 };
    const pos = { ...target };
    const trail = Array.from({ length: TRAIL }, () => ({ ...target }));
    let raf = 0;
    const move = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      d.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      const over = e.target as Element | null;
      const hot = over?.closest("a, button, textarea, input, [role=button]");
      r.classList.toggle("lx-ring-hot", Boolean(hot) && !over?.closest("[data-cursor=hide]"));
      document.documentElement.classList.toggle(
        "lx-cursor-away",
        Boolean(over?.closest("[data-cursor=hide]")),
      );
    };
    const loop = () => {
      pos.x += (target.x - pos.x) * 0.16;
      pos.y += (target.y - pos.y) * 0.16;
      r.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      // Each tail bead chases the one in front of it, so fast moves draw a comet.
      let lead = target;
      trail.forEach((p, i) => {
        p.x += (lead.x - p.x) * 0.42;
        p.y += (lead.y - p.y) * 0.42;
        lead = p;
        const bead = tail.current[i];
        if (bead) bead.style.transform = `translate(${p.x}px, ${p.y}px) scale(${1 - i / TRAIL})`;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("pointermove", move);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      document.documentElement.classList.remove("lx-has-cursor", "lx-cursor-away");
    };
  }, []);
  return (
    <>
      {Array.from({ length: TRAIL }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            tail.current[i] = el;
          }}
          aria-hidden
          className="lx-comet"
          style={{ opacity: 0.55 * (1 - i / TRAIL) }}
        />
      ))}
      <div ref={ring} aria-hidden className="lx-ring" />
      <div ref={dot} aria-hidden className="lx-cursor-dot" />
    </>
  );
}
