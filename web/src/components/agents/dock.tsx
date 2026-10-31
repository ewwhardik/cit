"use client";

import { ArrowUpRight, Send, X } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Character, type CharacterId } from "./character";

type Msg = {
  role: "user" | "assistant";
  content: string;
  links?: { label: string; href: string }[];
  notice?: string | null;
};

const CAST: { id: CharacterId; name: string; role: string; hello: string; chips: string[] }[] = [
  {
    id: "lumi",
    name: "Lumi",
    role: "Portal guide",
    hello: "Hi! I'm Lumi. Ask me how to do anything here: booking, approvals, timetables, change requests.",
    chips: ["How do I book a venue?", "How do approvals work?", "Where is my timetable?"],
  },
  {
    id: "vela",
    name: "Vela",
    role: "Venue concierge",
    hello: "I'm Vela. Tell me when, how many people and what you need, and I'll find free rooms.",
    chips: [
      "Free room Thursday 3 to 5 pm for 60 with projector",
      "Hall for 150 on Friday evening",
      "Lab with computers Tuesday afternoon",
    ],
  },
  {
    id: "orbit",
    name: "Orbit",
    role: "Timetable analyst",
    hello:
      "Orbit here. I read the timetable and decisions: who teaches what, free periods, and why things landed where they did.",
    chips: ["When is CSE-2 free on Wednesday?", "Why was BR-09 rejected?", "What does F07 teach?"],
  },
];

export function AgentDock() {
  const router = useRouter();
  const [open, setOpen] = useState<CharacterId | null>(null);
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const agent = CAST.find((c) => c.id === open);
  const thread = open ? (threads[open] ?? []) : [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the thread grows or the typing indicator toggles
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [thread.length, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send(text: string) {
    if (!open || !text.trim() || busy) return;
    const id = open;
    const next: Msg[] = [...(threads[id] ?? []), { role: "user", content: text.trim() }];
    setThreads((t) => ({ ...t, [id]: next }));
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: id, messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const body = await res.json();
      const reply: Msg = res.ok
        ? { role: "assistant", content: body.reply, links: body.links, notice: body.notice }
        : { role: "assistant", content: body.error ?? "Something went wrong. Please try again." };
      setThreads((t) => ({ ...t, [id]: [...next, reply] }));
    } catch {
      setThreads((t) => ({
        ...t,
        [id]: [...next, { role: "assistant", content: "I couldn't reach the server. Please try again." }],
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Dock */}
      <div
        className={cn(
          "fixed right-3 bottom-[4.75rem] z-40 flex items-end gap-1 md:right-6 md:bottom-6",
          open && "max-md:hidden",
        )}
      >
        {CAST.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setOpen(open === c.id ? null : c.id)}
            aria-label={`Chat with ${c.name}, ${c.role}`}
            aria-expanded={open === c.id}
            className={cn(
              "group relative grid place-items-center rounded-2xl p-1 transition-transform duration-200 hover:-translate-y-1",
              open === c.id && "-translate-y-1",
            )}
          >
            <Character id={c.id} size={44} talking={busy && open === c.id} />
            <span className="glass pointer-events-none absolute -top-8 rounded-full border border-gray-4/70 px-2 py-0.5 text-[11px] whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 max-md:hidden">
              {c.name} · {c.role}
            </span>
          </button>
        ))}
      </div>

      {/* Panel */}
      {agent ? (
        <section
          aria-label={`${agent.name}, ${agent.role}`}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-[var(--radius-sheet)] border border-gray-4/70 bg-surface-solid shadow-2xl md:inset-x-auto md:right-6 md:bottom-24 md:h-[560px] md:w-[400px] md:rounded-[var(--radius-sheet)]"
        >
          <header className="relative flex items-center gap-3 overflow-hidden border-b border-gray-4/70 px-4 py-3">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_10rem_at_0%_0%,var(--aurora-1),transparent_70%)]" />
            <Character id={agent.id} size={56} talking={busy} />
            <div className="relative min-w-0 flex-1">
              <p className="text-lagoon text-[16px] font-semibold">{agent.name}</p>
              <p className="text-[12px] text-gray-9">{agent.role} · reads live data, never changes it</p>
            </div>
            <div className="relative flex gap-1">
              {CAST.filter((c) => c.id !== agent.id).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setOpen(c.id)}
                  aria-label={`Switch to ${c.name}`}
                  className="rounded-lg p-0.5 hover:bg-gray-3"
                >
                  <Character id={c.id} size={26} />
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOpen(null)}
                aria-label="Close"
                className="grid size-8 place-items-center rounded-md text-gray-9 hover:bg-gray-3 max-md:size-11"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <Bubble from="assistant">{agent.hello}</Bubble>
            {thread.map((m, i) => (
              <div key={i} className="space-y-1.5">
                <Bubble from={m.role}>{m.content}</Bubble>
                {m.notice ? <p className="text-[11px] text-[color:var(--warn)]">{m.notice}</p> : null}
                {m.links?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {m.links.map((l) => (
                      <button
                        key={l.href}
                        type="button"
                        onClick={() => {
                          router.push(l.href as Route);
                          if (window.innerWidth < 768) setOpen(null);
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-1 text-[12px] text-accent hover:border-accent max-md:py-2"
                      >
                        {l.label} <ArrowUpRight className="size-3" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {busy ? (
              <div className="flex gap-1 px-1 py-2" role="status" aria-label="Thinking">
                {[0, 1, 2].map((d) => (
                  <span
                    key={d}
                    className="size-1.5 animate-bounce rounded-full bg-gray-7"
                    style={{ animationDelay: `${d * 120}ms` }}
                  />
                ))}
              </div>
            ) : null}
            {!thread.length ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {agent.chips.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => void send(c)}
                    className="rounded-full border border-gray-4 bg-gray-2 px-2.5 py-1 text-left text-[12px] text-gray-9 hover:border-gray-6 hover:text-gray-10 max-md:py-2"
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <form
            className="flex items-center gap-2 border-t border-gray-4/70 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask ${agent.name}…`}
              aria-label={`Message ${agent.name}`}
              className="h-10 min-w-0 flex-1 rounded-full border border-gray-5 bg-gray-1 px-4 text-[13px] outline-none focus-visible:border-accent max-md:h-11 max-md:text-base"
            />
            <button
              type="submit"
              disabled={!input.trim() || busy}
              aria-label="Send"
              className="btn-primary grid size-10 shrink-0 place-items-center rounded-full disabled:opacity-50 max-md:size-11"
            >
              <Send className="size-4" />
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}

function Bubble({ from: role, children }: { from: "user" | "assistant"; children: React.ReactNode }) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      <p
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-line",
          role === "user" ? "btn-primary rounded-br-md" : "rounded-bl-md border border-gray-4/70 bg-gray-2",
        )}
      >
        {children}
      </p>
    </div>
  );
}
