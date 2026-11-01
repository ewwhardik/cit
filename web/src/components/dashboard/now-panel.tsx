import Link from "next/link";
import type { SlotState } from "@/lib/campus-zones";

const KIND_VAR: Record<string, string> = {
  lecture: "var(--kind-lecture)",
  tutorial: "var(--kind-tutorial)",
  lab: "var(--kind-lab)",
};

/** The list view of one slot: classes and events running, and teaching rooms free. */
export function SlotLists({ info }: { info: SlotState }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-2 text-[11px] font-medium tracking-wide text-gray-8 uppercase">Running</p>
        {info.running.length || info.events.length ? (
          <ul className="grid max-h-[260px] gap-1 overflow-y-auto pr-1">
            {info.events.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-[12px]">
                <span className="h-4 w-0.5 shrink-0 rounded-full bg-[#d946ef]" />
                <span className="truncate font-medium">{e.title}</span>
                <span className="truncate text-gray-8">{e.attendance} people</span>
                <Link
                  href={`/timetable?view=room&id=${e.room}`}
                  className="tabular ml-auto shrink-0 text-gray-9 hover:text-accent"
                >
                  {e.room}
                </Link>
              </li>
            ))}
            {info.running.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[12px]">
                <span className="h-4 w-0.5 shrink-0 rounded-full" style={{ background: KIND_VAR[r.kind] }} />
                <span className="truncate font-medium">{r.course}</span>
                <span className="truncate text-gray-8">{r.groups.join(", ")}</span>
                <Link
                  href={`/timetable?view=room&id=${r.room}`}
                  className="tabular ml-auto shrink-0 text-gray-9 hover:text-accent"
                >
                  {r.room}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-gray-8">Nothing scheduled.</p>
        )}
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-[11px] font-medium tracking-wide text-gray-8 uppercase">Free rooms</p>
        <div className="flex max-h-[260px] flex-wrap gap-1.5 overflow-y-auto">
          {info.free.map((r) => (
            <Link
              key={r.id}
              href={`/timetable?view=room&id=${r.id}`}
              title={`${r.type.replaceAll("_", " ")} · ${r.capacity} seats · open its timetable`}
              className="tabular inline-flex h-7 items-center gap-1.5 rounded-full border border-gray-4 px-2.5 text-[12px] transition-colors hover:border-accent hover:text-accent"
            >
              {r.id}
              <span className="text-[10px] text-gray-8">{r.capacity}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
