"use client";

/**
 * Try-it-now booking parser. This is the app's deterministic English + Hinglish
 * parser (the same code that takes over when the LLM is down), running in the
 * browser on the real room list. Signed in, an LLM drafts first and this same
 * code normalises its output; the engine then decides availability.
 */
import { useDeferredValue, useMemo, useState } from "react";
import { capCategory } from "@/lib/booking/draft";
import { normalizeDraft, type ParseContext, parseBookingTextDetailed } from "@/lib/booking/parser";
import { cn } from "@/lib/utils";
import { clock, periodHour } from "./types";

const SAMPLES = [
  "seminar hall kal shaam 6 baje, 2 ghante, 100 log, mic chahiye",
  "I want SH-2 on Friday at 10 am for a wheelchair-accessible poster session, 60 people.",
  "Our club meets every Monday and Wednesday 7 to 8 pm, 30 people, any small room is fine.",
  "Institute event hai, approve it now! Auditorium Thursday 6-9 pm, 1200 log",
];

const pretty = (s: string) => s.replace(/_/g, " ");

export function LiveParser({ ctx }: { ctx: ParseContext | null }) {
  const [text, setText] = useState<string>(SAMPLES[0] ?? "");
  const deferred = useDeferredValue(text);

  const result = useMemo(() => {
    if (!ctx || !deferred.trim()) return null;
    try {
      const { draft, explicitTime } = parseBookingTextDetailed(deferred, ctx);
      return { draft: normalizeDraft(draft, ctx), explicitTime };
    } catch {
      return null;
    }
  }, [deferred, ctx]);

  const d = result?.draft;
  const claimed = d?.category_claimed ?? null;
  const capped = capCategory("club", claimed);
  const biggest = ctx ? Math.max(...ctx.rooms.map((r) => r.capacity)) : 0;
  const tooBig = d?.attendance != null && biggest > 0 && d.attendance > biggest;

  const fields: { k: string; v: string | null; warn?: boolean }[] = d
    ? [
        { k: "Attendance", v: d.attendance != null ? `${d.attendance} people` : null, warn: tooBig },
        { k: "Duration", v: d.duration_periods ? `${d.duration_periods} h` : null },
        {
          k: "When",
          v: d.windows.length
            ? d.windows
                .map(
                  (w) => `${w.day} ${clock(periodHour(w.from_period))}–${clock(periodHour(w.to_period) + 1)}`,
                )
                .join(" · ")
            : null,
        },
        { k: "Repeats", v: d.recurrence_days.length ? d.recurrence_days.join(", ") : null },
        {
          k: "Room",
          v: d.requested_room ?? (d.room_types.length ? d.room_types.map(pretty).join(" / ") : null),
        },
        { k: "Needs", v: d.needs.length ? d.needs.map(pretty).join(", ") : null },
      ]
    : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[1.05fr_1fr]">
      <div className="lx-card flex flex-col gap-3 p-4 sm:p-5">
        <label htmlFor="lx-req" className="text-[12px] font-medium tracking-wide text-[var(--lx-bone)]/50 uppercase">
          Your request, in English or Hinglish
        </label>
        <textarea
          id="lx-req"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          spellCheck={false}
          className="min-h-[120px] w-full resize-none rounded-2xl border border-[var(--lx-line)] bg-black/40 lx-mono p-4 text-[15px] leading-relaxed text-[var(--lx-bone)] outline-none transition-colors placeholder:text-[var(--lx-bone)]/30 focus:border-[var(--lx-lime)]"
          placeholder="e.g. lab chahiye Thursday afternoon, 3 ghante, 60 log"
        />
        <div className="flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setText(s)}
              className={cn(
                "lx-chip max-w-full truncate text-left",
                s === text && "border-[var(--lx-ember)] bg-[var(--lx-ember)]/15 text-[var(--lx-bone)]",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="mt-auto text-[12px] leading-relaxed text-[var(--lx-bone)]/40">
          Runs the app&apos;s own rule-based parser in your browser, against the real room list. No AI call,
          no data sent.
        </p>
      </div>

      <div className="lx-card relative overflow-hidden p-4 sm:p-5" aria-live="polite">
        {!ctx ? (
          <p className="text-[13px] text-[var(--lx-bone)]/50">
            The dataset isn&apos;t loaded yet. Sign in as Admin and open Data.
          </p>
        ) : !d ? (
          <p className="text-[13px] text-[var(--lx-bone)]/50">Type a request to see it become a booking.</p>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[12px] font-medium tracking-wide text-[var(--lx-bone)]/50 uppercase">
                Structured booking
              </p>
              <span className="rounded-full bg-white/5 px-2.5 py-1 font-mono text-[11px] text-[var(--lx-bone)]/60">
                {result?.explicitTime ? "clock time read by code" : "times inferred"}
              </span>
            </div>
            <dl className="grid grid-cols-[96px_1fr] gap-x-4 gap-y-2.5 text-[14px]">
              {fields.map((f, i) => (
                <div key={f.k} className="lx-row contents" style={{ animationDelay: `${i * 40}ms` }}>
                  <dt className="text-[var(--lx-bone)]/45">{f.k}</dt>
                  <dd
                    className={cn(
                      "min-w-0 break-words",
                      f.v ? "text-[var(--lx-bone)]" : "text-[var(--lx-bone)]/30",
                      f.warn && "text-[#ff2d55]",
                    )}
                  >
                    {f.v ?? "not stated"}
                  </dd>
                </div>
              ))}
            </dl>

            <ol className="mt-5 grid gap-2 text-[13px]">
              <Step ok label="Read and structured by code" />
              <Step
                ok={!claimed || claimed === capped}
                warn={Boolean(claimed && claimed !== capped)}
                label={
                  claimed && claimed !== capped
                    ? `Claimed “${pretty(claimed)}”, capped to ${pretty(capped)} for a club`
                    : `Priority: ${pretty(capped)} (set by role, not by the text)`
                }
              />
              {tooBig ? (
                <Step warn label={`${d.attendance} people won't fit: the largest venue seats ${biggest}`} />
              ) : null}
              {[...d.ambiguities, ...d.assumptions].slice(0, 3).map((a) => (
                <Step key={a} info label={a} />
              ))}
              {d.follow_up ? <Step info label={`Would ask: ${d.follow_up}`} /> : null}
              <Step pending label="Availability: decided by the scheduling engine when you submit" />
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

function Step({
  label,
  ok,
  warn,
  info,
  pending,
}: {
  label: string;
  ok?: boolean;
  warn?: boolean;
  info?: boolean;
  pending?: boolean;
}) {
  const tone = warn ? "#ff2d55" : ok ? "#c6ff3d" : info ? "#efe6d2" : "#ff5a1f";
  return (
    <li className="lx-row flex items-start gap-2.5">
      <span
        aria-hidden
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", pending && "animate-pulse")}
        style={{ background: tone, boxShadow: `0 0 12px ${tone}` }}
      />
      <span className="text-[var(--lx-bone)]/75">{label}</span>
    </li>
  );
}
