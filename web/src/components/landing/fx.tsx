"use client";

/** Small interaction primitives for the landing page: tilt + spotlight cards, magnetic links, count-up numbers, reveal on scroll. */
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

/** A blend-mode cursor ring that trails the pointer and swells over anything clickable (fine pointers only). */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!matchMedia("(pointer: fine)").matches || prefersReduced()) return;
    const d = dot.current;
    const r = ring.current;
    if (!d || !r) return;
    document.documentElement.classList.add("lx-has-cursor");
    const target = { x: innerWidth / 2, y: innerHeight / 2 };
    const pos = { ...target };
    let raf = 0;
    const move = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      d.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      const hot = (e.target as Element | null)?.closest("a, button, textarea, input, [role=button]");
      r.classList.toggle("lx-ring-hot", Boolean(hot));
    };
    const loop = () => {
      pos.x += (target.x - pos.x) * 0.16;
      pos.y += (target.y - pos.y) * 0.16;
      r.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("pointermove", move);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      document.documentElement.classList.remove("lx-has-cursor");
    };
  }, []);
  return (
    <>
      <div ref={ring} aria-hidden className="lx-ring" />
      <div ref={dot} aria-hidden className="lx-cursor-dot" />
    </>
  );
}
