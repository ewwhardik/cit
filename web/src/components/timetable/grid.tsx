"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DAY_LABEL,
  DAYS,
  EVENT_PERIODS,
  hourLabel,
  periodRange,
  periodStartHour,
  TEACHING_PERIODS,
} from "@/lib/time";
import { cn } from "@/lib/utils";

export type BlockKind = "lecture" | "tutorial" | "lab" | "exam" | "event";

export type Block = {
  key: string;
  day: string;
  start: number;
  duration: number;
  kind: BlockKind;
  title: string;
  subtitle?: string;
  room?: string;
  /** Extra rows shown in the details sheet. */
  details?: { label: string; value: React.ReactNode }[];
  tone?: "default" | "conflict" | "ghost" | "added";
};

const KIND_LABEL: Record<BlockKind, string> = {
  lecture: "Lecture",
  tutorial: "Tutorial",
  lab: "Lab",
  exam: "Exam",
  event: "Event",
};

const KIND_VAR: Record<BlockKind, string> = {
  lecture: "var(--kind-lecture)",
  tutorial: "var(--kind-tutorial)",
  lab: "var(--kind-lab)",
  exam: "var(--kind-exam)",
  event: "var(--kind-event)",
};

/** CSS grid row for a period: header is row 1, lunch band sits between P5 and P6. */
function rowOf(p: number) {
  return p <= 5 ? p + 1 : p + 2;
}

export function TimetableGrid({
  blocks,
  showEvening = false,
  emptyLabel = "Nothing scheduled.",
}: {
  blocks: Block[];
  showEvening?: boolean;
  emptyLabel?: string;
}) {
  const [selected, setSelected] = useState<Block | null>(null);
  const [mobileDay, setMobileDay] = useState<string>(() => {
    const first = DAYS.find((d) => blocks.some((b) => b.day === d));
    return first ?? "MON";
  });
  const periods = showEvening ? [...TEACHING_PERIODS, ...EVENT_PERIODS] : [...TEACHING_PERIODS];
  const lastRow = rowOf(periods[periods.length - 1] ?? 9);

  return (
    <>
      {/* Desktop / tablet: week grid */}
      <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-gray-4 bg-surface md:block">
        <div
          className="grid min-w-[720px]"
          style={{
            gridTemplateColumns: "64px repeat(5, minmax(0, 1fr))",
            gridTemplateRows: `36px repeat(5, 60px) 22px repeat(${periods.length - 5}, 60px)`,
          }}
        >
          <div
            className="sticky left-0 z-10 border-b border-gray-4 bg-surface"
            style={{ gridRow: 1, gridColumn: 1 }}
          />
          {DAYS.map((d, i) => (
            <div
              key={d}
              className="flex items-center border-b border-l border-gray-4 px-3 text-[12px] font-medium text-gray-9"
              style={{ gridRow: 1, gridColumn: i + 2 }}
            >
              <span className="lg:hidden">{d}</span>
              <span className="hidden lg:inline">{DAY_LABEL[d]}</span>
            </div>
          ))}
          {periods.map((p) => (
            <div
              key={p}
              className={cn(
                "sticky left-0 z-10 flex flex-col items-end justify-start border-b border-gray-4 bg-surface px-2 pt-1.5",
                p >= 10 && "bg-gray-2",
              )}
              style={{ gridRow: rowOf(p), gridColumn: 1 }}
            >
              <span className="tabular text-[11px] text-gray-10">P{p}</span>
              <span className="tabular text-[10px] text-gray-8">{hourLabel(periodStartHour(p))}</span>
            </div>
          ))}
          {/* cell backgrounds */}
          {DAYS.map((d, i) =>
            periods.map((p) => (
              <div
                key={`${d}${p}`}
                className={cn("border-b border-l border-gray-4", p >= 10 && "bg-gray-2/60")}
                style={{ gridRow: rowOf(p), gridColumn: i + 2 }}
              />
            )),
          )}
          {/* lunch band */}
          <div
            className="flex items-center justify-center border-b border-gray-4 bg-[repeating-linear-gradient(135deg,var(--gray-2)_0_6px,var(--gray-3)_6px_12px)] text-[10px] font-medium tracking-wide text-gray-8 uppercase"
            style={{ gridRow: 7, gridColumn: "1 / -1" }}
          >
            Lunch · 13:00–14:00
          </div>
          {blocks
            .filter((b) => DAYS.includes(b.day as (typeof DAYS)[number]) && rowOf(b.start) <= lastRow)
            .map((b) => {
              const col = DAYS.indexOf(b.day as (typeof DAYS)[number]) + 2;
              return (
                <BlockCard
                  key={b.key}
                  block={b}
                  onClick={() => setSelected(b)}
                  style={{ gridColumn: col, gridRow: `${rowOf(b.start)} / span ${b.duration}` }}
                />
              );
            })}
        </div>
        {blocks.length === 0 ? (
          <p className="border-t border-gray-4 px-4 py-3 text-[13px] text-gray-9">{emptyLabel}</p>
        ) : null}
      </div>

      {/* Phone: day switcher + agenda */}
      <div className="md:hidden">
        <div role="tablist" aria-label="Day" className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {DAYS.map((d) => {
            const count = blocks.filter((b) => b.day === d).length;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={mobileDay === d}
                onClick={() => setMobileDay(d)}
                className={cn(
                  "flex h-11 shrink-0 flex-col items-center justify-center rounded-[var(--radius-control)] border px-3.5 text-[12px] font-medium",
                  mobileDay === d
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-gray-4 bg-surface text-gray-9",
                )}
              >
                {d}
                <span className="tabular text-[10px] opacity-80">{count}</span>
              </button>
            );
          })}
        </div>
        <AgendaList
          blocks={blocks.filter((b) => b.day === mobileDay)}
          onSelect={setSelected}
          emptyLabel={emptyLabel}
        />
      </div>

      <BlockSheet block={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function BlockCard({
  block,
  onClick,
  style,
}: {
  block: Block;
  onClick: () => void;
  style: React.CSSProperties;
}) {
  const color = KIND_VAR[block.kind];
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${block.title} · ${block.room ?? ""} · ${periodRange(block.start, block.start + block.duration - 1)}`}
      className={cn(
        "relative z-[1] m-[3px] flex min-w-0 flex-col overflow-hidden rounded-[6px] border-l-2 px-2 py-1 text-left",
        "transition-[transform,box-shadow] duration-[120ms] ease-[var(--ease)] hover:-translate-y-px hover:shadow-md",
        block.tone === "ghost" &&
          "opacity-50 [background-image:repeating-linear-gradient(135deg,transparent_0_5px,var(--gray-3)_5px_10px)]",
        block.tone === "conflict" && "ring-2 ring-bad",
        block.tone === "added" && "ring-2 ring-ok",
      )}
      style={{
        ...style,
        borderLeftColor: color,
        background: `color-mix(in oklch, ${color} 12%, var(--surface))`,
      }}
    >
      <span className="shrink-0 truncate text-[12px] leading-[15px] font-semibold text-gray-10">
        {block.title}
      </span>
      {block.subtitle ? (
        <span className="truncate text-[11px] leading-tight text-gray-9">{block.subtitle}</span>
      ) : null}
      <span className="mt-auto flex items-center justify-between gap-1 pt-0.5">
        <span className="tabular truncate text-[10px] text-gray-9">{block.room}</span>
        <span className="tabular shrink-0 text-[10px] text-gray-8">
          {block.duration > 1 ? `P${block.start}–${block.start + block.duration - 1}` : `P${block.start}`}
        </span>
      </span>
    </button>
  );
}

function AgendaList({
  blocks,
  onSelect,
  emptyLabel,
}: {
  blocks: Block[];
  onSelect: (b: Block) => void;
  emptyLabel: string;
}) {
  const sorted = useMemo(() => [...blocks].sort((a, b) => a.start - b.start), [blocks]);
  if (!sorted.length) {
    return (
      <p className="rounded-[var(--radius-card)] border border-gray-4 bg-surface px-4 py-8 text-center text-[13px] text-gray-9">
        {emptyLabel}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-gray-4 overflow-hidden rounded-[var(--radius-card)] border border-gray-4 bg-surface">
      {sorted.map((b) => (
        <li key={b.key}>
          <button
            type="button"
            onClick={() => onSelect(b)}
            className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left"
          >
            <span className="h-9 w-0.5 shrink-0 rounded-full" style={{ background: KIND_VAR[b.kind] }} />
            <span className="tabular w-[84px] shrink-0 text-[12px] text-gray-9">
              {periodRange(b.start, b.start + b.duration - 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{b.title}</span>
              <span className="block truncate text-[12px] text-gray-9">
                {[b.subtitle, b.room].filter(Boolean).join(" · ")}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function BlockSheet({ block, onClose }: { block: Block | null; onClose: () => void }) {
  return (
    <Dialog.Root open={block !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/25 transition-opacity duration-[280ms] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed z-50 bg-surface shadow-2xl transition-transform duration-[280ms] ease-[var(--ease)]",
            "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[var(--radius-sheet)] border-t border-gray-4 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full",
            "md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[400px] md:rounded-none md:border-t-0 md:border-l md:data-[ending-style]:translate-x-full md:data-[ending-style]:translate-y-0 md:data-[starting-style]:translate-x-full md:data-[starting-style]:translate-y-0",
          )}
        >
          {block ? (
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-3 border-b border-gray-4 px-5 py-4">
                <div className="min-w-0">
                  <p
                    className="text-[11px] font-medium tracking-wide uppercase"
                    style={{ color: KIND_VAR[block.kind] }}
                  >
                    {KIND_LABEL[block.kind]}
                  </p>
                  <Dialog.Title className="mt-0.5 text-[16px] font-semibold">{block.title}</Dialog.Title>
                  {block.subtitle ? (
                    <Dialog.Description className="text-[13px] text-gray-9">
                      {block.subtitle}
                    </Dialog.Description>
                  ) : null}
                </div>
                <Dialog.Close
                  className="grid size-8 place-items-center rounded-md text-gray-9 hover:bg-gray-3 max-md:size-11"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </Dialog.Close>
              </div>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5 overflow-y-auto px-5 py-4 text-[13px]">
                <dt className="text-gray-9">When</dt>
                <dd className="tabular">
                  {DAY_LABEL[block.day] ?? block.day} · P{block.start}
                  {block.duration > 1 ? `–P${block.start + block.duration - 1}` : ""} ·{" "}
                  {periodRange(block.start, block.start + block.duration - 1)}
                </dd>
                {block.room ? (
                  <>
                    <dt className="text-gray-9">Room</dt>
                    <dd className="tabular">{block.room}</dd>
                  </>
                ) : null}
                {block.details?.map((d) => (
                  <div key={d.label} className="contents">
                    <dt className="text-gray-9">{d.label}</dt>
                    <dd className="min-w-0 break-words">{d.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function KindLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px] text-gray-9">
      {(Object.keys(KIND_LABEL) as BlockKind[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: KIND_VAR[k] }} />
          {KIND_LABEL[k]}
        </span>
      ))}
    </div>
  );
}
