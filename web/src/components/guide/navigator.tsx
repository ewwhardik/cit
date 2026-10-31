"use client";

import { ArrowUp, Compass, X } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { friendlyName } from "@/lib/format";
import type { NavAction, NavReply } from "@/lib/navigator-fallback";
import { cn } from "@/lib/utils";
import { Iru } from "./iru";
import { startTour } from "./tour";

type Msg = {
  role: "user" | "assistant";
  content: string;
  action?: NavAction;
  source?: NavReply["source"];
  note?: string;
};

const SUGGESTIONS: Record<string, string[]> = {
  admin: [
    "Generate the timetable",
    "Anything waiting for approval?",
    "How do I apply a disruption?",
    "Take the tour",
  ],
  dept_coordinator: ["Approve lab bookings", "Show CSE timetables", "Run a resilience scan", "Take the tour"],
  faculty: ["Show my timetable", "I can't take Thursday mornings", "When are the midsems?", "Take the tour"],
  club: ["Book the auditorium", "Find a free room for 60", "Status of my requests", "Take the tour"],
};
const STORE = "cit-navigator";

/**
 * Iru, the floating guide. Answers questions about the app and navigates:
 * the server returns at most one action (open an allowed page / start the tour),
 * and this component is the only thing that acts on it.
 */
export function Navigator({ role, name }: { role: string; name: string }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE);
      if (saved) setMsgs(JSON.parse(saved) as Msg[]);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-20)));
    } catch {}
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
  }, [open]);

  function act(action: NavAction | undefined) {
    if (!action) return;
    if (action.type === "tour") {
      setOpen(false);
      startTour();
    } else if (action.type === "navigate" && action.href !== path) {
      setTimeout(() => router.push(action.href as Route), 650);
    }
  }

  async function send(q: string) {
    const message = q.trim();
    if (!message || busy) return;
    setText("");
    const history = msgs.map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/navigator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, path }),
      });
      const body = (await res.json()) as NavReply & { note?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Something went wrong");
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: body.reply, action: body.action, source: body.source, note: body.note },
      ]);
      act(body.action);
    } catch (err) {
      setMsgs((m) => [...m, { role: "assistant", content: (err as Error).message, source: "guide" }]);
    } finally {
      setBusy(false);
    }
  }

  const first = friendlyName(name);

  return (
    <>
      <button
        type="button"
        data-tour="navigator"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close Iru, the guide" : "Ask Iru, the guide"}
        className={cn(
          "navigator-fab fixed right-4 bottom-20 z-40 grid size-14 place-items-center rounded-full border border-gray-4 bg-surface shadow-lg md:right-6 md:bottom-6",
          open && "scale-90",
        )}
      >
        {open ? <X className="size-5 text-gray-9" /> : <Iru size={40} />}
      </button>

      {open ? (
        <section
          aria-label="Iru, the guide"
          className="navigator-panel fixed inset-x-3 bottom-36 z-40 flex max-h-[min(560px,70dvh)] flex-col overflow-hidden rounded-[var(--radius-sheet)] border border-gray-4 bg-surface shadow-2xl md:inset-x-auto md:right-6 md:bottom-24 md:w-[380px]"
        >
          <header className="flex items-center gap-3 border-b border-gray-4 bg-gradient-to-br from-accent-soft to-surface px-4 py-3">
            <Iru size={36} mood={busy ? "think" : "happy"} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] font-bold tracking-tight">Iru</p>
              <p className="truncate text-[11px] text-gray-9">
                Your guide to CIT Scheduler · can't change data
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                startTour();
              }}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-gray-5 px-2.5 text-[11px] text-gray-9 hover:text-gray-10"
            >
              <Compass className="size-3.5" /> Tour
            </button>
          </header>

          <div ref={list} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {msgs.length === 0 ? (
              <div className="grid gap-3">
                <p className="text-[13px] leading-relaxed">
                  Hi{first ? ` ${first}` : ""}! Ask me where anything is (English or Hinglish) and I'll take
                  you there.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(SUGGESTIONS[role] ?? SUGGESTIONS.club ?? []).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        if (s === "Take the tour") {
                          setOpen(false);
                          startTour();
                        } else void send(s);
                      }}
                      className="rounded-full border border-gray-5 px-3 py-1.5 text-[12px] text-gray-9 transition-colors hover:border-accent hover:text-accent"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {msgs.map((m, i) => (
              <div
                key={`${i}-${m.role}`}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
                    m.role === "user" ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md bg-gray-2",
                  )}
                >
                  {m.content}
                  {m.action?.type === "navigate" ? (
                    <button
                      type="button"
                      onClick={() =>
                        router.push(m.action && m.action.type === "navigate" ? (m.action.href as Route) : "/")
                      }
                      className="mt-2 flex items-center gap-1 text-[12px] font-medium text-accent"
                    >
                      Open {m.action.label} →
                    </button>
                  ) : null}
                  {m.role === "assistant" && (m.source === "guide" || m.note) ? (
                    <p className="mt-1 text-[10px] text-gray-8">{m.note ?? "Offline guide"}</p>
                  ) : null}
                </div>
              </div>
            ))}
            {busy ? (
              <div className="flex gap-1 px-1" role="status" aria-label="Iru is typing">
                <span className="typing-dot" />
                <span className="typing-dot [animation-delay:120ms]" />
                <span className="typing-dot [animation-delay:240ms]" />
              </div>
            ) : null}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
            className="flex items-end gap-2 border-t border-gray-4 p-3"
          >
            <textarea
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              rows={1}
              maxLength={500}
              placeholder="Where do I book a hall?"
              className="max-h-28 min-h-9 flex-1 resize-none rounded-[var(--radius-control)] border border-gray-5 bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={!text.trim() || busy}
              aria-label="Send"
              className="grid size-9 place-items-center rounded-full bg-accent text-accent-fg disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
