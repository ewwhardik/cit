"use client";

import { CheckCircle2, CircleAlert, Info, Plus, Sparkles, Trash2, Wand2, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DayStrip } from "@/components/booking/day-strip";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { type BookingDraft, CATEGORIES, DAYS, emptyDraft, NEEDS, ROOM_TYPES } from "@/lib/booking/draft";
import { hourLabel, periodRange, periodStartHour } from "@/lib/time";
import { cn } from "@/lib/utils";

type Room = {
  id: string;
  name: string;
  type: string;
  capacity: number;
  features: string[];
  accessible: boolean;
};
type Group = { id: string; name: string };
type Outcome = {
  part: number;
  windows: { day: string; from_period: number; to_period: number }[];
  status: "approved" | "alternative_offered" | "rejected";
  reason: string;
  room_id?: string;
  day?: string;
  start_period?: number;
  end_period?: number;
  options?: { room_id: string; day: string; start_period: number; end_period: number; approved: boolean }[];
};

const PERIODS = Array.from({ length: 13 }, (_, i) => i + 1);
const label = (s: string) => s.replaceAll("_", " ");
const CATEGORY_LABEL: Record<string, string> = {
  institute_event: "Institute event",
  guest_lecture: "Guest lecture",
  department_event: "Department event",
  club_event: "Club event",
};

type Field =
  | "title"
  | "attendance"
  | "duration"
  | "windows"
  | "room_types"
  | "needs"
  | "room"
  | "groups"
  | "recurrence"
  | "category";

export function BookingStudio({
  rooms,
  groups,
  roleCap,
  defaultCategory,
  aiReady,
  examples,
  prefill,
}: {
  rooms: Room[];
  groups: Group[];
  roleCap: string;
  defaultCategory: string;
  aiReady: boolean;
  examples: string[];
  prefill: Record<string, string | undefined>;
}) {
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<BookingDraft>(() => fromPrefill(prefill));
  const [category, setCategory] = useState(defaultCategory);
  const [parsedBy, setParsedBy] = useState<"llm" | "fallback" | "manual">("manual");
  const [notice, setNotice] = useState<string | null>(null);
  const [aiFilled, setAiFilled] = useState<Set<Field>>(new Set());
  const [checking, setChecking] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string[] | null>(null);
  const capRank = (CATEGORIES as readonly string[]).indexOf(roleCap);

  const edit = (field: Field, patch: Partial<BookingDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setAiFilled((s) => {
      const n = new Set(s);
      n.delete(field);
      return n;
    });
  };

  async function parse(input = text) {
    if (!input.trim()) return;
    setParsing(true);
    setSubmitted(null);
    try {
      const res = await fetch("/api/assistant/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not read the request");
      const d = body.draft as BookingDraft;
      setDraft(d);
      setParsedBy(body.source);
      setNotice(body.notice);
      const filled = new Set<Field>();
      if (d.title) filled.add("title");
      if (d.attendance) filled.add("attendance");
      if (d.duration_periods) filled.add("duration");
      if (d.windows.length) filled.add("windows");
      if (d.room_types.length) filled.add("room_types");
      if (d.needs.length) filled.add("needs");
      if (d.requested_room) filled.add("room");
      if (d.mandatory_for_groups.length) filled.add("groups");
      if (d.recurrence_days.length) filled.add("recurrence");
      setAiFilled(filled);
      // The claim is shown, but the category is capped to what the role allows.
      const claimed = d.category_claimed ? (CATEGORIES as readonly string[]).indexOf(d.category_claimed) : -1;
      setCategory(claimed >= 0 ? CATEGORIES[Math.max(claimed, capRank)]! : defaultCategory);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setParsing(false);
    }
  }

  const submission = useMemo(
    () => ({
      title: draft.title || "Venue booking",
      attendance: draft.attendance ?? 0,
      duration_periods: draft.duration_periods ?? 0,
      windows: draft.windows,
      room_types: draft.room_types,
      needs: draft.needs,
      requested_room: draft.requested_room,
      mandatory_for_groups: draft.mandatory_for_groups,
      recurrence_days: draft.recurrence_days,
      category,
      raw_text: text || undefined,
      parsed_by: parsedBy,
    }),
    [draft, category, text, parsedBy],
  );
  const missing = [
    !draft.attendance && "attendance",
    !draft.duration_periods && "duration",
    !draft.windows.length && "a day and time",
    !draft.room_types.length && "a room type",
  ].filter(Boolean) as string[];

  const check = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const res = await fetch("/api/bookings/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Check failed");
      setOutcomes(body.outcomes);
    } catch (err) {
      setOutcomes(null);
      setCheckError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }, [submission]);

  // Re-check automatically shortly after the form becomes complete or changes.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    setOutcomes(null);
    if (missing.length) return;
    timer.current = setTimeout(() => void check(), 700);
    return () => clearTimeout(timer.current);
  }, [check, missing.length]);

  const blocked = outcomes?.some((o) => o.status === "rejected") ?? false;
  const needsAlt = outcomes?.some((o) => o.status === "alternative_offered") ?? false;

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission, accept_alternative: needsAlt }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Submit failed");
      setSubmitted(body.ids);
      toast.success(body.ids.length > 1 ? `${body.ids.length} requests submitted` : "Request submitted", {
        description: "An approver will confirm it. Track it under My requests.",
      });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const ring = (f: Field) => (aiFilled.has(f) ? "ring-2 ring-accent/35 rounded-[var(--radius-control)]" : "");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
        {/* ---------------- describe */}
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <Sparkles className="size-4 text-accent" /> Describe your booking
              </span>
            }
            description={
              aiReady
                ? "The AI fills the form; you review every field."
                : "AI is off: a built-in parser fills the form."
            }
            action={<Badge tone={aiReady ? "accent" : "neutral"}>{aiReady ? "AI on" : "Basic parser"}</Badge>}
          />
          <div className="grid gap-3 p-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void parse();
              }}
              rows={3}
              placeholder="e.g. seminar hall kal shaam 6 baje, 2 ghante, 100 log, mic chahiye"
              aria-label="Describe your booking"
              className="w-full resize-y rounded-[var(--radius-control)] border border-gray-5 bg-surface px-3 py-2 text-[14px] outline-none placeholder:text-gray-8 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={() => void parse()}
                loading={parsing}
                disabled={!text.trim()}
              >
                {!parsing ? <Wand2 className="size-3.5" /> : null} Fill the form
              </Button>
              <span className="text-[12px] text-gray-8 max-md:hidden">Ctrl/⌘ + Enter</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setText(ex);
                    void parse(ex);
                  }}
                  className="max-w-full truncate rounded-full border border-gray-4 bg-gray-2 px-2.5 py-1 text-left text-[12px] text-gray-9 transition-colors hover:border-gray-6 hover:text-gray-10 max-md:py-2"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
          {notice ? (
            <div
              role="status"
              className="flex items-start gap-2 border-t border-warn/30 bg-warn-soft px-4 py-2.5 text-[12px]"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-[color:var(--warn)]" /> {notice}
            </div>
          ) : null}
        </Card>

        {/* ---------------- form */}
        <Card>
          <CardHeader
            title="Booking details"
            description={
              aiFilled.size ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full bg-accent/50" /> Highlighted fields were
                  filled from your text ({parsedBy === "llm" ? "AI" : "basic parser"}). Edit anything.
                </span>
              ) : (
                "Fill in by hand, or describe it above."
              )
            }
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(emptyDraft());
                  setAiFilled(new Set());
                  setNotice(null);
                  setOutcomes(null);
                  setParsedBy("manual");
                }}
              >
                Clear
              </Button>
            }
          />
          {draft.follow_up || draft.assumptions.length || draft.ambiguities.length ? (
            <div className="grid gap-2 border-b border-gray-4 px-4 py-3">
              {draft.follow_up ? (
                <p className="flex items-start gap-2 text-[13px] font-medium">
                  <Info className="mt-0.5 size-4 shrink-0 text-accent" /> {draft.follow_up}
                </p>
              ) : null}
              {draft.ambiguities.map((a) => (
                <p key={a} className="flex items-start gap-2 text-[12px] text-gray-10">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-[color:var(--warn)]" /> {a}
                </p>
              ))}
              {draft.assumptions.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {draft.assumptions.map((a) => (
                    <span key={a} className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
                      Assumed: {a.replace(/^Assumed /, "")}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <div className={cn("grid gap-1.5 sm:col-span-2", ring("title"))}>
              <Label htmlFor="title">Event title</Label>
              <Input
                id="title"
                value={draft.title}
                onChange={(e) => edit("title", { title: e.target.value })}
                placeholder="e.g. Quiz finals"
              />
            </div>
            <div className={cn("grid gap-1.5", ring("attendance"))}>
              <Label htmlFor="att">Attendance</Label>
              <Input
                id="att"
                type="number"
                min={1}
                inputMode="numeric"
                value={draft.attendance ?? ""}
                onChange={(e) =>
                  edit("attendance", { attendance: e.target.value ? Number(e.target.value) : null })
                }
              />
            </div>
            <div className={cn("grid gap-1.5", ring("duration"))}>
              <Label htmlFor="dur">Duration (hours)</Label>
              <Input
                id="dur"
                type="number"
                min={1}
                max={13}
                inputMode="numeric"
                value={draft.duration_periods ?? ""}
                onChange={(e) =>
                  edit("duration", { duration_periods: e.target.value ? Number(e.target.value) : null })
                }
              />
            </div>

            <div className={cn("grid gap-1.5 sm:col-span-2", ring("windows"))}>
              <Label>When (any time inside these windows works)</Label>
              <div className="grid gap-2">
                {draft.windows.map((w, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Select
                      value={w.day}
                      onChange={(v) =>
                        edit("windows", {
                          windows: draft.windows.map((x, j) =>
                            j === i ? { ...x, day: v as (typeof DAYS)[number] } : x,
                          ),
                        })
                      }
                      options={DAYS.map((d) => [d, d])}
                      label="Day"
                    />
                    <Select
                      value={String(w.from_period)}
                      onChange={(v) =>
                        edit("windows", {
                          windows: draft.windows.map((x, j) =>
                            j === i
                              ? { ...x, from_period: Number(v), to_period: Math.max(Number(v), x.to_period) }
                              : x,
                          ),
                        })
                      }
                      options={PERIODS.map((p) => [String(p), `${hourLabel(periodStartHour(p))} · P${p}`])}
                      label="From"
                    />
                    <span className="text-[12px] text-gray-8">to</span>
                    <Select
                      value={String(w.to_period)}
                      onChange={(v) =>
                        edit("windows", {
                          windows: draft.windows.map((x, j) =>
                            j === i ? { ...x, to_period: Number(v) } : x,
                          ),
                        })
                      }
                      options={PERIODS.filter((p) => p >= w.from_period).map((p) => [
                        String(p),
                        `${hourLabel(periodStartHour(p) + 1)} · P${p}`,
                      ])}
                      label="Until"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove window"
                      onClick={() => edit("windows", { windows: draft.windows.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    size="sm"
                    onClick={() =>
                      edit("windows", {
                        windows: [...draft.windows, { day: "MON", from_period: 10, to_period: 11 }],
                      })
                    }
                  >
                    <Plus className="size-3.5" /> Add a window
                  </Button>
                </div>
              </div>
            </div>

            <ChipField
              label="Repeat weekly on"
              className={cn("sm:col-span-2", ring("recurrence"))}
              options={DAYS.map((d) => [d, d])}
              value={draft.recurrence_days}
              onChange={(v) => edit("recurrence", { recurrence_days: v as BookingDraft["recurrence_days"] })}
            />
            <ChipField
              label="Room types"
              className={cn("sm:col-span-2", ring("room_types"))}
              options={ROOM_TYPES.map((t) => [t, label(t)])}
              value={draft.room_types}
              onChange={(v) => edit("room_types", { room_types: v as BookingDraft["room_types"] })}
            />
            <ChipField
              label="Needs"
              className={cn("sm:col-span-2", ring("needs"))}
              options={NEEDS.map((t) => [t, label(t)])}
              value={draft.needs}
              onChange={(v) => edit("needs", { needs: v as BookingDraft["needs"] })}
            />
            <div className={cn("grid gap-1.5", ring("room"))}>
              <Label htmlFor="room">Preferred room (optional)</Label>
              <select
                id="room"
                value={draft.requested_room ?? ""}
                onChange={(e) => edit("room", { requested_room: e.target.value || null })}
                className="h-8 rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2 text-[13px] max-md:h-11"
              >
                <option value="">Any suitable room</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} · {r.name} ({r.capacity})
                  </option>
                ))}
              </select>
            </div>
            <div className={cn("grid gap-1.5", ring("category"))}>
              <Label htmlFor="cat">Category</Label>
              <select
                id="cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-8 rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2 text-[13px] max-md:h-11"
              >
                {CATEGORIES.map((c, i) => (
                  <option key={c} value={c} disabled={i < capRank}>
                    {CATEGORY_LABEL[c]}
                    {i < capRank ? " (not for your role)" : ""}
                  </option>
                ))}
              </select>
              {draft.category_claimed &&
              (CATEGORIES as readonly string[]).indexOf(draft.category_claimed) < capRank ? (
                <p className="text-[11px] text-[color:var(--warn)]">
                  Your text claims "{CATEGORY_LABEL[draft.category_claimed]}"; your role is capped at "
                  {CATEGORY_LABEL[roleCap]}". Priority is set by your role, not by the request text.
                </p>
              ) : null}
            </div>
            <ChipField
              label="Compulsory for groups (they must be free)"
              className={cn("sm:col-span-2", ring("groups"))}
              options={groups.map((g) => [g.id, g.id])}
              value={draft.mandatory_for_groups}
              onChange={(v) => edit("groups", { mandatory_for_groups: v })}
            />
            {draft.conditions.length ? (
              <div className="grid gap-1 sm:col-span-2">
                <Label>Conditions</Label>
                {draft.conditions.map((c, i) => (
                  <p key={i} className="text-[12px] text-gray-9">
                    {c.when}: {c.requested_room ?? c.room_types.map(label).join(", ")}
                    {c.min_attendance ? ` (for ${c.min_attendance}+ people)` : ""}. Adjust attendance or room
                    above to use it.
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      {/* ---------------- availability */}
      <div className="xl:sticky xl:top-6 xl:self-start">
        <Card>
          <CardHeader
            title="Availability"
            description="Checked by the scheduling engine against classes, Spectra events and other bookings."
          />
          <div className="grid gap-3 p-4">
            {missing.length ? (
              <p className="text-[13px] text-gray-9">Add {missing.join(", ")} to check availability.</p>
            ) : checking && !outcomes ? (
              <div className="grid gap-2">
                <div className="skeleton h-5 w-2/3" />
                <div className="skeleton h-16 w-full" />
              </div>
            ) : checkError ? (
              <div className="grid gap-2">
                <p className="text-[13px] text-bad">{checkError}</p>
                <div>
                  <Button size="sm" onClick={() => void check()}>
                    Retry
                  </Button>
                </div>
              </div>
            ) : outcomes ? (
              outcomes.map((o) => <OutcomeCard key={o.part} o={o} multi={outcomes.length > 1} />)
            ) : null}
            {submitted ? (
              <div className="rounded-[var(--radius-control)] border border-ok/30 bg-ok-soft p-3 text-[13px]">
                Submitted as <span className="tabular">{submitted.join(", ")}</span>.{" "}
                <Link href="/requests" className="font-medium text-accent hover:underline">
                  View my requests →
                </Link>
              </div>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={!outcomes || blocked || checking || missing.length > 0}
                loading={submitting}
                onClick={submit}
              >
                {blocked
                  ? "Blocked: see reason"
                  : needsAlt
                    ? "Accept alternative & submit"
                    : "Submit request"}
              </Button>
            )}
            {checking && outcomes ? (
              <p className="flex items-center gap-2 text-[11px] text-gray-8">
                <Spinner className="size-3" /> Re-checking…
              </p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function OutcomeCard({ o, multi }: { o: Outcome; multi: boolean }) {
  const tone = o.status === "approved" ? "ok" : o.status === "alternative_offered" ? "warn" : "bad";
  const Icon =
    o.status === "approved" ? CheckCircle2 : o.status === "alternative_offered" ? CircleAlert : XCircle;
  const title =
    o.status === "approved"
      ? "Available"
      : o.status === "alternative_offered"
        ? "Not as asked: alternative"
        : "Conflict blocked";
  return (
    <div
      className={cn(
        "grid gap-2 rounded-[var(--radius-control)] border p-3",
        tone === "ok" && "border-ok/30 bg-ok-soft",
        tone === "warn" && "border-warn/40 bg-warn-soft",
        tone === "bad" && "border-bad/30 bg-bad-soft",
      )}
    >
      <p className="flex items-center gap-2 text-[13px] font-semibold">
        <Icon
          className={cn(
            "size-4",
            tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-[color:var(--warn)]",
          )}
        />
        {title}
        {multi ? (
          <span className="tabular font-normal text-gray-9">· {o.windows.map((w) => w.day).join("/")}</span>
        ) : null}
      </p>
      {o.room_id ? (
        <p className="tabular text-[13px]">
          {o.room_id} · {o.day} P{o.start_period}–P{o.end_period} ·{" "}
          {periodRange(o.start_period!, o.end_period!)}
        </p>
      ) : null}
      <p className="text-[12px] text-gray-10">{o.reason}</p>
      <DayStrip
        windows={o.windows}
        given={o.room_id ? o : null}
        tone={tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--bad)"}
      />
      {o.options && o.options.length > 1 ? (
        <details className="text-[12px] text-gray-9">
          <summary className="cursor-pointer">Other free options</summary>
          <ul className="tabular mt-1 grid gap-0.5">
            {o.options.slice(1).map((x) => (
              <li key={`${x.room_id}${x.day}${x.start_period}`}>
                {x.room_id} · {x.day} P{x.start_period}–P{x.end_period} {x.approved ? "" : "(outside window)"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tabular h-8 rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2 text-[13px] max-md:h-11"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function ChipField({
  label: text,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: [string, string][];
  value: string[];
  onChange: (v: string[]) => void;
  className?: string;
}) {
  return (
    <fieldset className={cn("grid gap-1.5", className)}>
      <legend className="mb-1.5 text-[12px] font-medium text-gray-9">{text}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, l]) => {
          const on = value.includes(v);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}
              className={cn(
                "h-7 rounded-full border px-2.5 text-[12px] transition-colors duration-[120ms] max-md:h-9",
                on
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-gray-4 bg-surface text-gray-9 hover:border-gray-6",
              )}
            >
              {l}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function fromPrefill(p: Record<string, string | undefined>): BookingDraft {
  const d = emptyDraft();
  if (p.room) d.requested_room = p.room;
  if (p.type) d.room_types = [p.type as BookingDraft["room_types"][number]];
  if (p.size) d.attendance = Number(p.size) || null;
  if (p.day && p.from && p.to) {
    d.windows = [
      {
        day: p.day as BookingDraft["windows"][number]["day"],
        from_period: Number(p.from),
        to_period: Number(p.to),
      },
    ];
    d.duration_periods = Number(p.to) - Number(p.from) + 1;
  }
  return d;
}
