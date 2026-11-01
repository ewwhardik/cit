import { CalendarX2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { requireUser } from "@/server/session";
import { ExamSeating } from "./seating";

export const metadata: Metadata = { title: "Midsem exams" };

const DEFAULT_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DEFAULT_SLOTS = [
  { id: "AM", start: "09:30", end: "11:30" },
  { id: "PM", start: "14:00", end: "16:00" },
];
const DAY_LABEL: Record<string, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
};

export default async function ExamsPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const user = await requireUser();
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  const placed = version?.schedule.exams ?? [];

  if (!ds || !version || placed.length === 0) {
    return (
      <>
        <PageHeader title="Midsem exams" />
        <EmptyState
          icon={<CalendarX2 className="size-8" strokeWidth={1.5} />}
          title={!ds ? "No dataset is loaded yet." : "Exams are scheduled when the timetable is generated."}
          action={
            user.role === "admin" ? (
              <Link href={!ds ? "/data" : "/generate"}>
                <Button variant="primary">{!ds ? "Load dataset" : "Generate timetable"}</Button>
              </Link>
            ) : null
          }
        />
      </>
    );
  }

  const sp = await searchParams;
  const cal = (ds.json.calendar ?? {}) as {
    exam_week?: { days?: string[]; sessions?: { id: string; start: string; end: string }[] };
  };
  const days = cal.exam_week?.days ?? DEFAULT_DAYS;
  const slots = cal.exam_week?.sessions ?? DEFAULT_SLOTS;
  const exams = new Map(ds.json.exams.map((e) => [e.id, e]));
  const rooms = new Map(ds.json.rooms.map((r) => [r.id, r]));
  const groups = ds.json.student_groups;
  const groupSize = new Map(groups.map((g) => [g.id, g.size]));
  const group = sp.group && groups.some((g) => g.id === sp.group) ? sp.group : null;

  const rows = placed.flatMap((p) => {
    const e = exams.get(p.exam_id);
    if (!e || (group && !e.groups.includes(group))) return [];
    const seats = p.rooms.reduce((n, id) => n + Math.floor((rooms.get(id)?.capacity ?? 0) / 2), 0);
    return [{ ...p, exam: e, seats }];
  });
  const at = (day: string, slot: string) => rows.filter((r) => r.day === day && r.session === slot);

  return (
    <>
      <PageHeader
        title="Midsem exams"
        description={
          <>
            Exam week (Week 8) · <span className="tabular">{rows.length}</span> exams
            {group ? ` for ${group}` : ""} · rooms seat half their capacity during exams
          </>
        }
      />

      <nav
        aria-label="Filter by group"
        className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
      >
        <FilterChip href="/exams" active={!group} label="All groups" />
        {groups.map((g) => (
          <FilterChip key={g.id} href={`/exams?group=${g.id}`} active={group === g.id} label={g.id} />
        ))}
      </nav>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {days.map((day) => (
          <section key={day} className="rounded-[var(--radius-card)] border border-gray-4 bg-surface">
            <h2 className="border-b border-gray-4 px-4 py-3 font-display text-[15px] font-bold tracking-tight">
              {DAY_LABEL[day] ?? day}
            </h2>
            <div className="grid divide-y divide-gray-4">
              {slots.map((slot) => {
                const list = at(day, slot.id);
                return (
                  <div key={slot.id} className="grid grid-cols-[72px_1fr] gap-3 px-4 py-3">
                    <div>
                      <p className="text-[13px] font-semibold">{slot.id}</p>
                      <p className="tabular text-[11px] text-gray-9">
                        {slot.start}–{slot.end}
                      </p>
                    </div>
                    {list.length ? (
                      <ul className="grid gap-2">
                        {list.map((r) => (
                          <li key={r.exam_id}>
                            <ExamSeating
                              title={r.exam.course_ids.join(" + ")}
                              rooms={r.rooms.map((id) => ({ id, capacity: rooms.get(id)?.capacity ?? 0 }))}
                              groups={r.exam.groups.map((g) => ({ id: g, size: groupSize.get(g) ?? 0 }))}
                              total={r.exam.size}
                              focus={group}
                            >
                              <p className="text-[13px] font-medium">{r.exam.course_ids.join(" + ")}</p>
                              <p className="text-[12px] text-gray-9">
                                {r.exam.groups.join(", ")} · <span className="tabular">{r.exam.size}</span>{" "}
                                students
                              </p>
                              <p className="mt-0.5 text-[12px] text-gray-9">
                                <span className="tabular">{r.rooms.join(", ")}</span> ·{" "}
                                <span className="tabular">{r.seats}</span> exam seats
                              </p>
                            </ExamSeating>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="self-center text-[12px] text-gray-8">Free</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href as never}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[12px] transition-colors max-md:h-10",
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-gray-5 bg-surface text-gray-9 hover:border-gray-6 hover:text-gray-10",
      )}
    >
      {label}
    </Link>
  );
}
