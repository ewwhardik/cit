"use client";

import { CalendarClock, GitCompareArrows, Inbox as InboxIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/input";
import { ActionButton } from "@/components/workflow/action-button";
import { STATUS_LABEL, slotText } from "@/lib/format";
import type { BookingDecision } from "@/lib/schemas/schedule";
import { cn } from "@/lib/utils";

export type InboxItem = {
  key: string;
  kind: "booking" | "proposal";
  id: string;
  title: string;
  status: string;
  requester: string;
  createdAt: string;
  canDecide: boolean;
  whyNot: string | null;
  booking?: {
    payload: Record<string, unknown>;
    decision: BookingDecision | null;
    reason: string | null;
    rawText: string | null;
    parsedBy: string;
  };
  proposal?: { type: string; summary: Record<string, number>; changes: number; explanation: string | null };
};

const FILTERS = [
  ["pending", "Pending"],
  ["all", "All"],
  ["booking", "Bookings"],
  ["proposal", "Timetable changes"],
] as const;

export function Inbox({ items }: { items: InboxItem[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("pending");
  const shown = useMemo(
    () =>
      items.filter((i) =>
        filter === "pending" ? i.status === "pending" : filter === "all" ? true : i.kind === filter,
      ),
    [items, filter],
  );
  const [sel, setSel] = useState(0);
  const current = shown[Math.min(sel, shown.length - 1)];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "j") setSel((s) => Math.min(shown.length - 1, s + 1));
      if (e.key === "k") setSel((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown.length]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Filter"
          className="inline-flex rounded-[var(--radius-control)] border border-gray-4 bg-gray-2 p-0.5"
        >
          {FILTERS.map(([k, l]) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={filter === k}
              onClick={() => {
                setFilter(k);
                setSel(0);
              }}
              className={cn(
                "h-7 rounded-[5px] px-3 text-[13px] max-md:h-10",
                filter === k ? "bg-surface font-medium shadow-sm" : "text-gray-9",
              )}
            >
              {l}
              {k === "pending" ? (
                <span className="tabular ml-1.5 text-gray-8">
                  {items.filter((i) => i.status === "pending").length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-gray-8 max-md:hidden">
          <Kbd>j</Kbd> <Kbd>k</Kbd> to move
        </p>
      </div>
      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<InboxIcon className="size-7" strokeWidth={1.5} />}
            title="Nothing waiting. You're all caught up."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card className="overflow-hidden">
            <ul className="max-h-[70vh] divide-y divide-gray-4 overflow-y-auto">
              {shown.map((i, idx) => (
                <li key={i.key}>
                  <button
                    type="button"
                    onClick={() => setSel(idx)}
                    aria-current={current?.key === i.key}
                    className={cn(
                      "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left",
                      current?.key === i.key ? "bg-accent-soft/60" : "hover:bg-gray-2",
                    )}
                  >
                    {i.kind === "booking" ? (
                      <CalendarClock className="size-4 shrink-0 text-gray-8" />
                    ) : (
                      <GitCompareArrows className="size-4 shrink-0 text-gray-8" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{i.title}</span>
                      <span className="block truncate text-[12px] text-gray-9">
                        {i.requester} ·{" "}
                        {i.kind === "booking"
                          ? slotText(i.booking?.decision)
                          : `${i.proposal?.changes} session change(s)`}
                      </span>
                    </span>
                    <Badge tone={statusTone(i.status)}>{STATUS_LABEL[i.status] ?? i.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {current ? <Detail item={current} /> : null}
        </div>
      )}
    </div>
  );
}

function Detail({ item }: { item: InboxItem }) {
  if (item.kind === "proposal" && item.proposal) {
    const s = item.proposal.summary;
    return (
      <Card className="h-fit p-4">
        <div className="grid gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-gray-8 uppercase">
              {item.proposal.type.replace("_", " ")} proposal
            </p>
            <h2 className="text-[16px] font-semibold">{item.title}</h2>
            <p className="text-[12px] text-gray-9">Requested by {item.requester}</p>
          </div>
          <p className="text-[13px]">
            <span className="tabular font-semibold">{s.moved ?? item.proposal.changes}</span> moved ·{" "}
            <span className="tabular">{s.room_only ?? 0}</span> room-only ·{" "}
            <span className="tabular">{s.time_changed ?? 0}</span> time ·{" "}
            <span className="tabular text-ok">0</span> conflicts · soft{" "}
            <span className="tabular">
              {(s.soft_delta ?? 0) > 0 ? `+${s.soft_delta}` : (s.soft_delta ?? 0)}
            </span>
          </p>
          {item.proposal.explanation ? (
            <p className="text-[12px] whitespace-pre-line text-gray-9">{item.proposal.explanation}</p>
          ) : null}
          <Link href={`/approvals/p/${item.id}`}>
            <Button variant="primary" className="w-full">
              Review changes{item.status === "pending" ? " and decide" : ""}
            </Button>
          </Link>
        </div>
      </Card>
    );
  }
  const b = item.booking!;
  const p = b.payload as Record<string, any>;
  return (
    <Card className="h-fit p-4">
      <div className="grid gap-3 text-[13px]">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-gray-8 uppercase">
            Venue booking · {item.id}
          </p>
          <h2 className="text-[16px] font-semibold">{item.title}</h2>
          <p className="text-[12px] text-gray-9">
            {item.requester} · {String(p.requested_category ?? "").replaceAll("_", " ")} · {p.attendance}{" "}
            people
          </p>
        </div>
        {b.rawText ? (
          <blockquote className="rounded-[var(--radius-control)] border-l-2 border-gray-5 bg-gray-2 px-3 py-2 text-[12px] text-gray-9">
            “{b.rawText}”{" "}
            <span className="text-gray-8">
              ({b.parsedBy === "llm" ? "AI-parsed" : b.parsedBy === "fallback" ? "basic parser" : "form"})
            </span>
          </blockquote>
        ) : null}
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-gray-9">Windows</dt>
          <dd className="tabular">
            {(p.windows as any[]).map((w) => `${w.day} P${w.from_period}–P${w.to_period}`).join(", ")}
          </dd>
          <dt className="text-gray-9">Room types</dt>
          <dd>{(p.room_types as string[]).join(", ").replaceAll("_", " ")}</dd>
          <dt className="text-gray-9">Needs</dt>
          <dd>{(p.needs as string[]).join(", ").replaceAll("_", " ") || "—"}</dd>
          {p.mandatory_for_groups?.length ? (
            <>
              <dt className="text-gray-9">Compulsory for</dt>
              <dd>{p.mandatory_for_groups.join(", ")}</dd>
            </>
          ) : null}
          <dt className="text-gray-9">Engine decision</dt>
          <dd className="tabular">{slotText(b.decision)}</dd>
        </dl>
        {b.reason ? (
          <p className="rounded-[var(--radius-control)] bg-gray-2 px-3 py-2 text-[12px]">{b.reason}</p>
        ) : null}
        {item.status === "pending" ? (
          item.canDecide ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton
                url={`/api/bookings/${item.id}/decide`}
                body={{ action: "approve" }}
                success="Booking approved"
                variant="primary"
              >
                Approve
              </ActionButton>
              <ActionButton
                url={`/api/bookings/${item.id}/decide`}
                body={{ action: "reject" }}
                prompt="Reason for rejection (shown to the requester):"
                success="Booking rejected"
                variant="secondary"
              >
                Reject
              </ActionButton>
              <p className="w-full text-[11px] text-gray-8">
                Approving re-checks availability at that moment.
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-gray-9">{item.whyNot}</p>
          )
        ) : null}
      </div>
    </Card>
  );
}
