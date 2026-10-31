"use client";

import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type TourStep, tourFor } from "@/lib/tour";
import { cn } from "@/lib/utils";
import type { Role } from "@/server/db/schema";

const START_EVENT = "cit:tour";

/** Start the guided tour from anywhere (buttons, the navigator). */
export function startTour() {
  window.dispatchEvent(new Event(START_EVENT));
}

type Box = { top: number; left: number; width: number; height: number };

/**
 * Step-by-step guide: dims the page, spotlights one element, and explains what
 * it is and the task to do there. Moves between pages on its own. Optional:
 * first-time users get an invitation card (choice remembered per role in this
 * browser); the compass button and Iru can start it any time.
 */
export function Tour({ role }: { role: Role }) {
  const router = useRouter();
  const path = usePathname();
  const steps = useMemo(() => tourFor(role), [role]);
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [invite, setInvite] = useState(false);
  const step: TourStep | null = index === null ? null : (steps[index] ?? null);
  const seenKey = `cit-tour-done:${role}`;

  const close = useCallback(() => {
    setIndex(null);
    setBox(null);
    try {
      localStorage.setItem(seenKey, "1");
    } catch {}
  }, [seenKey]);

  // Start from the event (compass button, Iru). On a first visit, only offer it: the tour is optional.
  useEffect(() => {
    const start = () => {
      setInvite(false);
      setIndex(0);
    };
    window.addEventListener(START_EVENT, start);
    let seen = true;
    try {
      seen = localStorage.getItem(seenKey) === "1";
    } catch {}
    const t = !seen && path === "/dashboard" ? setTimeout(() => setInvite(true), 900) : undefined;
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener(START_EVENT, start);
    };
  }, [path, seenKey]);

  // Go to the step's page, then find and measure its target.
  useEffect(() => {
    if (!step) return;
    if (path !== step.route) {
      setBox(null);
      router.push(step.route as Route);
      return;
    }
    if (!step.target) {
      setBox(null);
      return;
    }
    let raf = 0;
    let tries = 0;
    let el: Element | null = null;
    const measure = () => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const find = () => {
      el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(measure, 350);
      } else if (tries++ < 120) raf = requestAnimationFrame(find);
      else setBox(null);
    };
    find();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, path, router]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setIndex((i) => (i !== null && i < steps.length - 1 ? i + 1 : i));
      if (e.key === "ArrowLeft") setIndex((i) => (i ? i - 1 : i));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, steps.length, close]);

  if (invite && index === null) {
    return (
      <div
        role="dialog"
        aria-label="Guided tour"
        className="navigator-panel fixed right-4 bottom-20 left-4 z-[70] rounded-[var(--radius-sheet)] border border-gray-4 bg-surface p-4 shadow-2xl sm:left-auto sm:w-[340px] md:right-24 md:bottom-6"
      >
        <p className="font-display text-[16px] font-bold tracking-[-0.02em]">New here?</p>
        <p className="mt-1 text-[13px] leading-relaxed text-gray-9">
          Take a 2-minute guided tour: each step shows what a part of the app is and what to do there. It's
          optional; the compass button starts it any time.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setInvite(false);
              close();
            }}
            className="h-8 rounded-[var(--radius-control)] px-3 text-[13px] text-gray-9 hover:bg-gray-3"
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={() => {
              setInvite(false);
              setIndex(0);
            }}
            className="h-8 rounded-[var(--radius-control)] bg-accent px-4 text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
          >
            Start tour
          </button>
        </div>
      </div>
    );
  }
  if (!step || index === null) return null;
  const last = index === steps.length - 1;
  const pad = 6;
  const spot = box
    ? { top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
    : null;
  // Card goes below the target when there is room, otherwise above; centred without a target.
  const below = spot ? spot.top + spot.height + 220 < window.innerHeight : true;
  const cardStyle: React.CSSProperties = spot
    ? {
        top: below ? spot.top + spot.height + 12 : undefined,
        bottom: below ? undefined : window.innerHeight - spot.top + 12,
        left: Math.min(Math.max(12, spot.left), window.innerWidth - 372),
      }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={`Guide: ${step.title}`}>
      {spot ? (
        <div
          aria-hidden
          className="tour-spot pointer-events-none fixed rounded-[14px] transition-all duration-300 ease-[var(--ease)]"
          style={spot}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/55 backdrop-blur-[2px]" />
      )}
      <div
        className="fixed w-[min(360px,calc(100vw-24px))] rounded-[var(--radius-sheet)] border border-gray-4 bg-surface p-4 shadow-2xl max-md:!top-auto max-md:!bottom-20 max-md:!left-3"
        style={cardStyle}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="tabular rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
            Step {index + 1} of {steps.length}
          </span>
          <button type="button" onClick={close} className="text-[12px] text-gray-8 hover:text-gray-10">
            Skip tour
          </button>
        </div>
        <h2 className="font-display text-[18px] leading-tight font-bold tracking-[-0.02em]">{step.title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-9">{step.what}</p>
        <div className="mt-3 flex gap-2 rounded-[var(--radius-control)] bg-gray-2 px-3 py-2 text-[13px]">
          <span aria-hidden className="mt-0.5 text-accent">
            ➜
          </span>
          <span>
            <span className="font-medium">Your task: </span>
            {step.task}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={cn("h-1 flex-1 rounded-full", i <= index ? "bg-accent" : "bg-gray-4")}
              />
            ))}
          </div>
          {index > 0 ? (
            <button
              type="button"
              onClick={() => setIndex(index - 1)}
              className="h-8 rounded-[var(--radius-control)] px-3 text-[13px] text-gray-9 hover:bg-gray-3"
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            ref={(el) => el?.focus({ preventScroll: true })}
            onClick={() => (last ? close() : setIndex(index + 1))}
            className="h-8 rounded-[var(--radius-control)] bg-accent px-4 text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
          >
            {last ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
