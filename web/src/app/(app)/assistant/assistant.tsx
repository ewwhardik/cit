"use client";

import { Bot, CircleAlert, Send, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { type DiffRow, DiffSummaryBar } from "@/components/diff/diff-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/input";
import { JobStatusLine, useJob } from "@/components/workflow/job-progress";
import { DAYS } from "@/lib/time";
import { cn } from "@/lib/utils";

type Op = {
  op: string;
  faculty_id?: string;
  session_id?: string;
  days?: string[];
  periods?: number[];
  starts?: number[];
};
type AssistantOut = {
  reply: string;
  summary: string;
  ops: Op[];
  source: string;
  notice: string | null;
  steps: string[];
};
type Session = { id: string; course: string; kind: string; faculty: string; where: string };

function opText(o: Op) {
  if (o.op === "mark_unavailable")
    return `${o.faculty_id} unavailable ${o.days?.join("/")} ${o.periods?.length === 9 ? "all day" : `P${Math.min(...(o.periods ?? [1]))}–P${Math.max(...(o.periods ?? [1]))}`}`;
  if (o.op === "move_session")
    return `Move ${o.session_id} → ${[o.days?.join("/"), o.starts?.map((s) => `P${s}`).join("/")].filter(Boolean).join(" ")}`;
  return `${o.op.replace("_", " ")} ${o.session_id ?? ""}`;
}

export function ChangeAssistant({
  aiReady,
  hasTimetable,
  sessions,
  faculty,
  examples,
}: {
  aiReady: boolean;
  hasTimetable: boolean;
  sessions: Session[];
  faculty: { id: string; name: string }[];
  examples: string[];
}) {
  const [mode, setMode] = useState<"chat" | "form">("chat");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<AssistantOut | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [proposalId, setProposalId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const started = useRef(0);
  const { job, running } = useJob(jobId);

  // manual form state
  const [kind, setKind] = useState<"unavailable" | "move">("unavailable");
  const [fid, setFid] = useState(faculty[0]?.id ?? "");
  const [days, setDays] = useState<string[]>([]);
  const [part, setPart] = useState<"morning" | "afternoon" | "all">("morning");
  const [sid, setSid] = useState(sessions[0]?.id ?? "");

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    setOut(null);
    setBlocked(null);
    setJobId(null);
    setProposalId(null);
    try {
      const res = await fetch("/api/assistant/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      setOut(body.assistant);
      setBlocked(body.blocked ?? null);
      if (body.jobId) {
        started.current = Date.now();
        setJobId(body.jobId);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function sendForm() {
    const periods =
      part === "morning"
        ? [1, 2, 3, 4, 5]
        : part === "afternoon"
          ? [6, 7, 8, 9]
          : [1, 2, 3, 4, 5, 6, 7, 8, 9];
    if (!days.length) return toast.error("Pick at least one day.");
    const ops: Op[] =
      kind === "unavailable"
        ? [{ op: "mark_unavailable", faculty_id: fid, days, periods }]
        : [{ op: "move_session", session_id: sid, days, ...(part === "all" ? {} : { starts: periods }) }];
    void send({ ops, text: ops.map(opText).join("; ") });
  }

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Submit failed");
      setProposalId(body.proposalId);
      toast.success("Sent to an Admin for approval");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const result = job?.result;
  const diff = (result?.diff ?? []) as DiffRow[];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Bot className="size-4 text-accent" /> What do you need?
            </span>
          }
          action={
            <div
              role="tablist"
              className="inline-flex rounded-[var(--radius-control)] border border-gray-4 bg-gray-2 p-0.5"
            >
              {(["chat", "form"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  type="button"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "h-7 rounded-[5px] px-3 text-[12px] max-md:h-9",
                    mode === m ? "bg-surface font-medium shadow-sm" : "text-gray-9",
                  )}
                >
                  {m === "chat" ? (aiReady ? "Ask AI" : "Plain language") : "Form"}
                </button>
              ))}
            </div>
          }
        />
        {mode === "chat" ? (
          <div className="grid gap-3 p-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              aria-label="Describe the change"
              placeholder="e.g. I can't take Thursday morning classes next month, move my DS lab to Friday if possible."
              className="w-full resize-y rounded-[var(--radius-control)] border border-gray-5 bg-surface px-3 py-2 text-[14px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={() => void send({ text })}
                loading={busy}
                disabled={!text.trim() || !hasTimetable}
              >
                {!busy ? <Send className="size-3.5" /> : null} Check this change
              </Button>
              {!aiReady ? <Badge>AI off: basic parser</Badge> : <Badge tone="accent">AI on</Badge>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setText(ex)}
                  className="max-w-full truncate rounded-full border border-gray-4 bg-gray-2 px-2.5 py-1 text-[12px] text-gray-9 hover:border-gray-6 max-md:py-2"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 p-4">
            <div className="flex gap-2">
              {(
                [
                  ["unavailable", "Mark unavailable"],
                  ["move", "Move a session"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "h-8 flex-1 rounded-[var(--radius-control)] border text-[13px] max-md:h-11",
                    kind === k ? "border-accent bg-accent-soft text-accent" : "border-gray-4 text-gray-9",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            {kind === "unavailable" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="fac">Faculty</Label>
                <select
                  id="fac"
                  value={fid}
                  onChange={(e) => setFid(e.target.value)}
                  className="h-8 rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2 text-[13px] max-md:h-11"
                >
                  {faculty.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.id} · {f.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="ses">Session</Label>
                <select
                  id="ses"
                  value={sid}
                  onChange={(e) => setSid(e.target.value)}
                  className="h-8 rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2 text-[13px] max-md:h-11"
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} · {s.kind} · now {s.where}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>{kind === "unavailable" ? "Days" : "Move to (any of)"}</Label>
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={days.includes(d)}
                    onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
                    className={cn(
                      "h-8 flex-1 rounded-[var(--radius-control)] border text-[12px] max-md:h-10",
                      days.includes(d)
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-gray-4 text-gray-9",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Part of day</Label>
              <div className="flex gap-1">
                {(["morning", "afternoon", "all"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={part === p}
                    onClick={() => setPart(p)}
                    className={cn(
                      "h-8 flex-1 rounded-[var(--radius-control)] border text-[12px] max-md:h-10",
                      part === p ? "border-accent bg-accent-soft text-accent" : "border-gray-4 text-gray-9",
                    )}
                  >
                    {p === "all" ? (kind === "move" ? "Any time" : "All day") : p}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="primary" onClick={sendForm} loading={busy} disabled={!hasTimetable}>
              Check this change
            </Button>
          </div>
        )}
      </Card>

      <div className="grid content-start gap-4">
        {out ? (
          <Card className="p-4">
            <div className="grid gap-2 text-[13px]">
              {out.notice ? (
                <p className="flex items-start gap-2 text-[12px] text-[color:var(--warn)]">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {out.notice}
                </p>
              ) : null}
              {out.reply ? <p>{out.reply}</p> : null}
              {out.ops.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {out.ops.map((o, i) => (
                    <span
                      key={i}
                      className="tabular rounded-md border border-gray-4 bg-gray-2 px-2 py-0.5 text-[12px]"
                    >
                      {opText(o)}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="text-[11px] text-gray-8">
                {out.source === "llm"
                  ? "Interpreted by AI"
                  : out.source === "manual"
                    ? "From the form"
                    : "Interpreted by the basic parser"}
                ; validated by the scheduling engine.
              </p>
              {blocked ? (
                <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-bad-soft px-3 py-2 text-[12px] text-bad">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" /> Not allowed: {blocked}
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}
        {jobId ? (
          <Card className="p-4">
            {running ? (
              <JobStatusLine job={job} startedAt={started.current} />
            ) : result?.status === "infeasible" || result?.status === "invalid" ? (
              <div className="grid gap-2 text-[13px]">
                <p className="font-medium text-bad">This change isn't possible as asked.</p>
                <ul className="list-disc pl-4 text-gray-10">
                  {result.diagnostics.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : result ? (
              <div className="grid gap-3">
                <p className="text-[13px] font-medium">Proposed fix</p>
                {result.summary ? <DiffSummaryBar summary={result.summary} /> : null}
                <ul className="grid gap-1.5">
                  {diff.map((r) => (
                    <li key={r.session_id} className="tabular text-[12px]">
                      <span className="font-medium">{r.session_id}</span>{" "}
                      <span className="text-gray-9">
                        {r.from ? `${r.from.day} P${r.from.start_period} ${r.from.room_id}` : "new"} →{" "}
                        {r.to ? `${r.to.day} P${r.to.start_period} ${r.to.room_id}` : "removed"}
                      </span>
                    </li>
                  ))}
                  {!diff.length ? (
                    <li className="text-[12px] text-gray-9">No session needs to move.</li>
                  ) : null}
                </ul>
                {proposalId ? (
                  <Link
                    href={`/approvals/p/${proposalId}`}
                    className="text-[13px] font-medium text-accent hover:underline"
                  >
                    View your request →
                  </Link>
                ) : (
                  <Button variant="primary" onClick={submit} loading={submitting}>
                    Submit for Admin approval
                  </Button>
                )}
              </div>
            ) : job?.status === "failed" ? (
              <p className="text-[13px] text-bad">{job.error}</p>
            ) : null}
          </Card>
        ) : null}
        {!out && !jobId ? (
          <Card className="p-6 text-center text-[13px] text-gray-9">
            Describe a change on the left. You'll see exactly which sessions would move before anything is
            sent for approval.
          </Card>
        ) : null}
      </div>
    </div>
  );
}
