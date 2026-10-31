"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Status = { ok: boolean; ms: number; version: string | null; workers: number | null };

/** Live engine health pill. Polls every 30 s; "Wake" pings with a long timeout for sleeping hosts. */
export function EngineStatus() {
  const [s, setS] = useState<Status | null>(null);
  const [waking, setWaking] = useState(false);

  const check = useCallback(async (wake = false) => {
    try {
      const r = await fetch(`/api/engine/status${wake ? "?wake=1" : ""}`, { cache: "no-store" });
      setS((await r.json()) as Status);
    } catch {
      setS({ ok: false, ms: 0, version: null, workers: null });
    }
  }, []);

  useEffect(() => {
    void check();
    const id = setInterval(() => {
      if (!document.hidden) void check();
    }, 30_000);
    return () => clearInterval(id);
  }, [check]);

  const tone = s === null ? "idle" : s.ok ? "ok" : "bad";
  return (
    <div
      data-tour="engine"
      className="flex items-center gap-2 rounded-full border border-gray-4 bg-surface py-1 pr-1 pl-3 text-[12px]"
    >
      <span className="relative flex size-2">
        {tone === "ok" ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-ok opacity-60" />
        ) : null}
        <span
          className={cn(
            "relative size-2 rounded-full",
            tone === "ok" ? "bg-ok" : tone === "bad" ? "bg-bad" : "bg-gray-6",
          )}
        />
      </span>
      <span className="text-gray-9">
        Engine{" "}
        <span className="font-medium text-gray-10">
          {s === null ? "checking…" : s.ok ? "online" : waking ? "waking up…" : "asleep"}
        </span>
        {s?.ok ? (
          <span className="tabular text-gray-8">
            {" "}
            · {s.ms} ms{s.workers ? ` · ${s.workers} worker${s.workers > 1 ? "s" : ""}` : ""}
          </span>
        ) : null}
      </span>
      {s && !s.ok ? (
        <button
          type="button"
          disabled={waking}
          onClick={async () => {
            setWaking(true);
            await check(true);
            setWaking(false);
          }}
          className="h-6 rounded-full bg-accent px-2.5 text-[11px] font-medium text-accent-fg disabled:opacity-60"
        >
          {waking ? "…" : "Wake"}
        </button>
      ) : (
        <span className="w-1" />
      )}
    </div>
  );
}
