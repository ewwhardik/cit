"use client";

import { CheckCircle2, HelpCircle, MoveRight, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { DAYS, hourLabel, periodStartHour } from "@/lib/time";
import { cn } from "@/lib/utils";

type Trace = {
  summary: string;
  blocked_by: Record<string, number>;
  free_start_times: number;
  checked_start_times: number;
  options: {
    day: string;
    start_period: number;
    room_id: string;
    rooms: string[];
    soft_delta: number | null;
  }[];
  /** One verdict per possible start time (engine order: day, then period). */
  slots?: {
    day: string;
    start_period: number;
    ok: boolean;
    rule?: string;
    reason?: string;
    rooms?: string[];
  }[];
};

const RULE: Record<string, string> = {
  H9: "Lunch / lab rules",
  H14: "Fixed slot",
  H7: "Teacher unavailable",
  H2: "Teacher busy",
  H3: "Students busy",
  H12: "Teacher's daily limit",
  H4: "No free room",
  H5: "Room too small",
  H6: "Room type",
  H8: "Room closed",
  H10: "Accessibility",
};
const RULE_COLOR: Record<string, string> = {
  H9: "var(--gray-7)",
  H14: "var(--gray-8)",
  H7: "var(--bad)",
  H2: "var(--kind-exam)",
  H3: "var(--kind-event)",
  H12: "var(--warn)",
  H4: "var(--kind-tutorial)",
};

export type MoveMode = "apply" | "propose" | null;

/** "Why here?" (engine trace + optional AI rephrase) and "Move" with live hard-rule checking. */
export function SessionActions({
  sessionId,
  current,
  rooms,
  moveMode,
}: {
  sessionId: string;
  current: { day: string; start: number; room?: string };
  rooms: string[];
  moveMode: MoveMode;
}) {
  const router = useRouter();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [prose, setProse] = useState<{ text: string; source: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [target, setTarget] = useState({
    day: current.day,
    start: current.start,
    room: current.room ?? rooms[0] ?? "",
  });
  const [check, setCheck] = useState<{ ok: boolean; blockers: { rule: string; reason: string }[] } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  async function explain() {
    setLoading(true);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not explain");
      setTrace(body.trace);
      setProse(body.prose);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!showMove) return;
    const same = target.day === current.day && target.start === current.start && target.room === current.room;
    if (same) {
      setCheck(null);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/moves/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            day: target.day,
            start_period: target.start,
            room_id: target.room,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Check failed");
        setCheck(body);
      } catch (err) {
        setCheck({ ok: false, blockers: [{ rule: "!", reason: (err as Error).message }] });
      } finally {
        setChecking(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [target, showMove, sessionId, current]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/moves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          day: target.day,
          start_period: target.start,
          room_id: target.room,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Move failed");
      toast.success(
        body.applied ? "Moved: new timetable version is live" : "Move requested: waiting for an Admin",
      );
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const total = trace
    ? Object.values(trace.blocked_by).reduce((a, b) => a + b, 0) + trace.free_start_times
    : 0;

  return (
    <div className="grid gap-3 border-t border-gray-4 px-5 py-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={explain} loading={loading}>
          {!loading ? <HelpCircle className="size-3.5" /> : null} Why here?
        </Button>
        {moveMode ? (
          <Button
            size="sm"
            variant={showMove ? "primary" : "secondary"}
            onClick={() => setShowMove((s) => !s)}
          >
            <MoveRight className="size-3.5" /> Move
          </Button>
        ) : null}
      </div>

      {trace && prose ? (
        <div className="grid gap-2.5">
          <p className="text-[13px] leading-relaxed">{prose.text}</p>
          <div
            className="flex h-2 overflow-hidden rounded-full bg-gray-3"
            role="img"
            aria-label="Start times by outcome"
          >
            {Object.entries(trace.blocked_by).map(([k, v]) => (
              <span
                key={k}
                title={`${RULE[k] ?? k}: ${v}`}
                style={{ width: `${(v / total) * 100}%`, background: RULE_COLOR[k] ?? "var(--gray-7)" }}
              />
            ))}
            <span
              title={`Free: ${trace.free_start_times}`}
              style={{ width: `${(trace.free_start_times / total) * 100}%`, background: "var(--ok)" }}
            />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-9">
            {Object.entries(trace.blocked_by).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span
                  className="size-2 rounded-sm"
                  style={{ background: RULE_COLOR[k] ?? "var(--gray-7)" }}
                />
                {RULE[k] ?? k} <span className="tabular">{v}</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-sm bg-ok" /> Free{" "}
              <span className="tabular">{trace.free_start_times}</span>
            </span>
          </div>
          {trace.slots?.length ? (
            <SlotMap
              slots={trace.slots}
              current={current}
              onPick={
                moveMode
                  ? (day, start, room) => {
                      setTarget({ day, start, room });
                      setShowMove(true);
                    }
                  : null
              }
            />
          ) : null}
          {trace.options.length ? (
            <div className="grid gap-1">
              <p className="text-[11px] font-medium text-gray-8">Best free alternatives</p>
              {trace.options.slice(0, 4).map((o) => (
                <button
                  key={`${o.day}${o.start_period}`}
                  type="button"
                  disabled={!moveMode}
                  onClick={() => {
                    setShowMove(true);
                    setTarget({ day: o.day, start: o.start_period, room: o.room_id });
                  }}
                  className="tabular flex items-center justify-between rounded-md border border-gray-4 px-2 py-1 text-left text-[12px] enabled:hover:border-accent disabled:cursor-default"
                >
                  <span>
                    {o.day} P{o.start_period} · {o.room_id}
                  </span>
                  <span className={cn((o.soft_delta ?? 0) > 0 ? "text-[color:var(--warn)]" : "text-ok")}>
                    soft {(o.soft_delta ?? 0) > 0 ? `+${o.soft_delta}` : (o.soft_delta ?? 0)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-[10px] text-gray-8">
            Facts from the scheduling engine{prose.source === "llm" ? "; wording by AI" : ""}.
          </p>
        </div>
      ) : null}

      {showMove ? (
        <div className="grid gap-2 rounded-[var(--radius-control)] border border-gray-4 bg-gray-2 p-3">
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Day"
              value={target.day}
              onChange={(e) => setTarget({ ...target, day: e.target.value })}
              className="h-8 rounded-md border border-gray-5 bg-surface px-2 text-[12px] max-md:h-10"
            >
              {DAYS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <select
              aria-label="Start"
              value={target.start}
              onChange={(e) => setTarget({ ...target, start: Number(e.target.value) })}
              className="tabular h-8 rounded-md border border-gray-5 bg-surface px-2 text-[12px] max-md:h-10"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => (
                <option key={p} value={p}>
                  P{p} · {hourLabel(periodStartHour(p))}
                </option>
              ))}
            </select>
            <select
              aria-label="Room"
              value={target.room}
              onChange={(e) => setTarget({ ...target, room: e.target.value })}
              className="tabular h-8 rounded-md border border-gray-5 bg-surface px-2 text-[12px] max-md:h-10"
            >
              {rooms.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          {checking ? (
            <p className="flex items-center gap-2 text-[12px] text-gray-9">
              <Spinner className="size-3" /> Checking every hard rule…
            </p>
          ) : check ? (
            check.ok ? (
              <p className="flex items-center gap-1.5 text-[12px] text-ok">
                <CheckCircle2 className="size-4" /> Valid: no clashes.
              </p>
            ) : (
              <ul className="grid gap-1 text-[12px] text-bad">
                {check.blockers.map((b) => (
                  <li key={b.reason} className="flex items-start gap-1.5">
                    <XCircle className="mt-0.5 size-3.5 shrink-0" /> <Badge tone="bad">{b.rule}</Badge>{" "}
                    {b.reason}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="text-[12px] text-gray-9">Pick a new slot; it is checked instantly.</p>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={!check?.ok || checking}
            loading={saving}
            onClick={save}
          >
            {moveMode === "apply" ? "Apply move" : "Request move (needs Admin approval)"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every start time the engine tried, as a week grid: green where the session
 * could go, coloured by the first rule that blocks it elsewhere, and the
 * current slot outlined. Clicking a green cell loads it into Move.
 */
function SlotMap({
  slots,
  current,
  onPick,
}: {
  slots: NonNullable<Trace["slots"]>;
  current: { day: string; start: number };
  onPick: ((day: string, start: number, room: string) => void) | null;
}) {
  const at = new Map(slots.map((s) => [`${s.day}|${s.start_period}`, s]));
  const periods = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <div className="grid gap-1">
      <p className="text-[11px] font-medium text-gray-8">
        Every start time the engine checked{onPick ? " · click a green slot to try moving there" : ""}
      </p>
      <div className="wh-grid">
        <span />
        {periods.map((p) => (
          <span key={p} className={cn("wh-head", p === 6 && "wh-lunch")}>
            P{p}
          </span>
        ))}
        {DAYS.map((day) => (
          <div key={day} className="contents">
            <span className="wh-day">{day}</span>
            {periods.map((p) => {
              const s = at.get(`${day}|${p}`);
              const here = day === current.day && p === current.start;
              const label = here
                ? "Current slot"
                : !s
                  ? "Not a valid start"
                  : s.ok
                    ? `Free · ${s.rooms?.slice(0, 4).join(", ")}`
                    : `${RULE[s.rule ?? ""] ?? s.rule}: ${s.reason ?? ""}`;
              const room = s?.ok ? s.rooms?.[0] : undefined;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!onPick || !room}
                  title={label}
                  aria-label={`${day} P${p}: ${label}`}
                  onClick={() => room && onPick?.(day, p, room)}
                  className={cn("wh-cell", here && "wh-here", s?.ok && "wh-ok", p === 6 && "wh-lunch")}
                  style={
                    !here && s && !s.ok
                      ? { background: RULE_COLOR[s.rule ?? ""] ?? "var(--gray-6)" }
                      : undefined
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
