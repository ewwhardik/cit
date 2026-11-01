import { CalendarX2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { requireUser } from "@/server/session";
import { type Entity, FreeTimeFinder } from "./finder";

export const metadata: Metadata = { title: "Common free time" };

export default async function FreeTimePage() {
  const user = await requireUser();
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  if (!ds || !version) {
    return (
      <>
        <PageHeader title="Common free time" />
        <Card>
          <EmptyState
            icon={<CalendarX2 className="size-7" strokeWidth={1.5} />}
            title="Free time appears once a timetable has been generated."
            action={
              user.role === "admin" ? (
                <Link href="/generate">
                  <Button variant="primary">Generate</Button>
                </Link>
              ) : null
            }
          />
        </Card>
      </>
    );
  }

  // What each group and teacher is doing in every regular-week period (first reason wins).
  const busy: Record<string, Record<string, string>> = {};
  const mark = (id: string, day: string, p: number, why: string) => {
    busy[id] ??= {};
    busy[id][`${day}|${p}`] ??= why;
  };
  const sessions = new Map(ds.json.sessions.map((s) => [s.id, s]));
  for (const pl of version.schedule.sessions) {
    const s = sessions.get(pl.session_id);
    if (!s) continue;
    const why = `${s.course_id} ${s.kind} · ${pl.room_id}`;
    for (let p = pl.start_period; p < pl.start_period + s.duration; p++) {
      mark(s.faculty_id, pl.day, p, why);
      for (const g of s.groups) mark(g, pl.day, p, why);
    }
  }
  for (const f of ds.json.faculty)
    for (const u of f.unavailable) for (const p of u.periods) mark(f.id, u.day, p, u.reason ?? "unavailable");

  const entities: Entity[] = [
    ...ds.json.student_groups.map((g) => ({
      id: g.id,
      name: g.name,
      kind: "group" as const,
      size: g.size,
    })),
    ...ds.json.faculty.map((f) => ({
      id: f.id,
      name: f.name,
      kind: "faculty" as const,
      size: 0,
    })),
  ];
  const start = user.facultyId ? [user.facultyId] : ds.json.student_groups.slice(0, 2).map((g) => g.id);

  return (
    <>
      <PageHeader
        title="Common free time"
        description="Pick student groups and teachers to see when all of them are free: for an extra class, a make-up lab or a meeting. Then find a room for that slot."
      />
      <FreeTimeFinder entities={entities} busy={busy} initial={start} />
    </>
  );
}
