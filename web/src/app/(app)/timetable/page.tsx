import { CalendarX2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { KindLegend, TimetableGrid } from "@/components/timetable/grid";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { buildBlocks, type View } from "@/lib/timetable";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { requireUser } from "@/server/session";
import { TimetablePicker } from "./picker";

export const metadata: Metadata = { title: "Timetables" };

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; id?: string }>;
}) {
  const user = await requireUser();
  const ds = await getActiveDataset();
  const version = ds ? await getCurrentVersion(ds.id) : null;
  const sp = await searchParams;

  if (!ds || !version) {
    return (
      <>
        <PageHeader title="Timetables" />
        <EmptyState
          icon={<CalendarX2 className="size-8" strokeWidth={1.5} />}
          title={!ds ? "No dataset is loaded yet." : "No timetable has been generated yet."}
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

  // Sensible default per role: faculty see themselves, coordinators their first group.
  const view: View =
    sp.view === "faculty" || sp.view === "room"
      ? sp.view
      : sp.view === "group"
        ? "group"
        : user.facultyId
          ? "faculty"
          : "group";
  const options = {
    group: ds.json.student_groups.map((g) => ({ id: g.id, label: `${g.id} · ${g.name}` })),
    faculty: ds.json.faculty.map((f) => ({ id: f.id, label: `${f.id} · ${f.name}` })),
    room: ds.json.rooms.map((r) => ({ id: r.id, label: `${r.id} · ${r.name} (${r.capacity})` })),
  };
  const fallback =
    view === "faculty" && user.facultyId
      ? user.facultyId
      : view === "group" && user.department
        ? (ds.json.student_groups.find((g) => g.department === user.department)?.id ?? options.group[0]?.id)
        : options[view][0]?.id;
  const id = sp.id && options[view].some((o) => o.id === sp.id) ? sp.id : (fallback ?? "");
  const blocks = buildBlocks(ds.json, version.schedule, view, id);
  const hours = blocks.reduce((n, b) => n + b.duration, 0);

  return (
    <>
      <PageHeader
        title="Timetables"
        description={
          <>
            Weekly timetable · version #{version.id} · <span className="tabular">{blocks.length}</span>{" "}
            sessions, <span className="tabular">{hours}</span> hours
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <TimetablePicker view={view} id={id} options={options} />
        <div className="max-md:hidden">
          <KindLegend />
        </div>
      </div>
      <TimetableGrid blocks={blocks} emptyLabel="No sessions for this selection." />
    </>
  );
}
