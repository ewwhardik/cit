"use client";

import { Armchair, X } from "lucide-react";
import { useMemo, useRef } from "react";
import { type SeatRoom, seatingPlan } from "@/lib/exam-seating";
import { cn } from "@/lib/utils";

const PALETTE = ["#e8833a", "#3f8fd6", "#3dae6a", "#c75bd1", "#d6b43f", "#d65151", "#4bb7b0", "#8a7be0"];

/**
 * An exam card that opens its seating plan: every room as a seat map with
 * alternate seats left empty, coloured by group, plus each group's roll ranges
 * per room. Computed in the browser from sizes only, so nothing extra is sent.
 */
export function ExamSeating({
  title,
  rooms,
  groups,
  total,
  focus,
  children,
}: {
  title: string;
  rooms: SeatRoom[];
  groups: { id: string; size: number }[];
  total: number;
  /** Group picked in the page filter; its seats stay bright. */
  focus: string | null;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const plan = useMemo(() => seatingPlan(rooms, groups, total), [rooms, groups, total]);
  const color = new Map(groups.map((g, i) => [g.id, PALETTE[i % PALETTE.length]!]));
  const seated = plan.blocks.reduce((n, b) => n + b.to - b.from + 1, 0);

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="group w-full rounded-[var(--radius-control)] border-l-2 border-kind-exam bg-[color-mix(in_oklch,var(--kind-exam)_10%,transparent)] px-2.5 py-1.5 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--kind-exam)_18%,transparent)]"
      >
        {children}
        <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-kind-exam group-hover:underline">
          <Armchair className="size-3" /> Seating plan
        </span>
      </button>
      <dialog
        ref={dialog}
        className="ex-dialog"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") dialog.current?.close();
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-4 px-4 py-3">
          <div className="min-w-0">
            <p className="font-display text-[15px] font-bold">Seating · {title}</p>
            <p className="text-[12px] text-gray-9">
              <span className="tabular">{seated}</span> of <span className="tabular">{total}</span> students
              seated in {rooms.length} room{rooms.length === 1 ? "" : "s"}; every other seat stays empty (half
              capacity).
              {plan.unseated ? <span className="text-bad"> {plan.unseated} have no seat.</span> : null}
            </p>
          </div>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-gray-3"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="grid gap-4 overflow-y-auto p-4">
          <table className="w-full text-[12px]">
            <thead className="text-left text-gray-8">
              <tr>
                <th className="pb-1 font-medium">Group</th>
                <th className="pb-1 font-medium">Rolls</th>
                <th className="pb-1 font-medium">Room</th>
              </tr>
            </thead>
            <tbody>
              {plan.blocks.map((b) => (
                <tr
                  key={`${b.group}-${b.room}-${b.from}`}
                  className={cn(focus && focus !== b.group && "opacity-45")}
                >
                  <td className="py-0.5">
                    <span
                      className="mr-1.5 inline-block size-2.5 rounded-sm align-middle"
                      style={{ background: color.get(b.group) }}
                    />
                    {b.group}
                  </td>
                  <td className="tabular py-0.5">
                    {b.from}–{b.to}
                  </td>
                  <td className="tabular py-0.5">{b.room}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.rooms.map((r) => (
            <figure key={r.id} className="grid gap-1.5">
              <figcaption className="flex items-center justify-between text-[12px]">
                <span className="tabular font-semibold">{r.id}</span>
                <span className="tabular text-gray-9">
                  {r.seats.filter((s) => s).length}/{r.usable} exam seats used
                </span>
              </figcaption>
              <div className="ex-board">Board</div>
              <div
                className="ex-seats"
                style={{ gridTemplateColumns: `repeat(${r.cols}, minmax(0, 1fr))` }}
                role="img"
                aria-label={`${r.id} seat map`}
              >
                {r.seats.map((s, i) => (
                  <span
                    key={`seat-${i}`}
                    className={cn(
                      "ex-seat",
                      s === false && "ex-gap",
                      s && focus && focus !== s.group && "ex-dim",
                    )}
                    style={s ? { background: color.get(s.group) } : undefined}
                    title={s ? `${s.group} roll ${s.roll}` : s === false ? "Left empty" : "Spare"}
                  />
                ))}
              </div>
            </figure>
          ))}
        </div>
      </dialog>
    </>
  );
}
