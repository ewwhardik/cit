"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Spinner } from "@/components/ui/button";
import type { View } from "@/lib/timetable";
import { cn } from "@/lib/utils";

type Opt = { id: string; label: string };
const VIEWS: { key: View; label: string }[] = [
  { key: "group", label: "Group" },
  { key: "faculty", label: "Faculty" },
  { key: "room", label: "Room" },
];

export function TimetablePicker({
  view,
  id,
  options,
}: {
  view: View;
  id: string;
  options: Record<View, Opt[]>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (v: View, i: string) =>
    start(() => router.push(`/timetable?view=${v}&id=${encodeURIComponent(i)}` as Route));

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <div
        role="tablist"
        aria-label="Timetable view"
        className="inline-flex rounded-[var(--radius-control)] border border-gray-4 bg-gray-2 p-0.5"
      >
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            onClick={() => go(v.key, options[v.key][0]?.id ?? "")}
            onMouseEnter={() => router.prefetch(`/timetable?view=${v.key}&id=${encodeURIComponent(options[v.key][0]?.id ?? "")}` as Route)}
            className={cn(
              "h-7 rounded-[5px] px-3 text-[13px] transition-colors duration-[120ms] max-md:h-10",
              view === v.key
                ? "bg-surface font-medium text-gray-10 shadow-sm"
                : "text-gray-9 hover:text-gray-10",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
      <select
        aria-label={`Choose ${view}`}
        value={id}
        onChange={(e) => go(view, e.target.value)}
        className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2 text-[13px] sm:w-72 sm:flex-none max-md:h-11"
      >
        {options[view].map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {pending ? <Spinner className="text-gray-8" /> : null}
    </div>
  );
}
