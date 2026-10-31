import { count, eq } from "drizzle-orm";
import { CommandMenu, type Jump } from "@/components/shell/command-menu";
import { mobileNavFor, navFor, ROLE_LABEL } from "@/components/shell/nav";
import { MobileTabs, SidebarNav } from "@/components/shell/sidebar";
import { SignOutButton, ThemeToggle } from "@/components/shell/user-menu";
import { getActiveDataset } from "@/server/data";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = navFor(user.role);
  const ds = await getActiveDataset();
  const badges: Record<string, number> = {};
  if (user.role === "admin" || user.role === "dept_coordinator") {
    const [b] = await db
      .select({ n: count() })
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.status, "pending"));
    const [p] =
      user.role === "admin"
        ? await db.select({ n: count() }).from(schema.proposals).where(eq(schema.proposals.status, "pending"))
        : [{ n: 0 }];
    const total = (b?.n ?? 0) + (p?.n ?? 0);
    if (total) badges["/approvals"] = total;
  }
  const jumps: Jump[] = ds
    ? [
        ...ds.json.student_groups.map((g) => ({
          label: `${g.id} · ${g.name}`,
          href: `/timetable?view=group&id=${g.id}`,
          group: "Groups",
        })),
        ...ds.json.faculty.map((f) => ({
          label: `${f.id} · ${f.name}`,
          href: `/timetable?view=faculty&id=${f.id}`,
          group: "Faculty",
        })),
        ...ds.json.rooms.map((r) => ({
          label: `${r.id} · ${r.name}`,
          href: `/timetable?view=room&id=${r.id}`,
          group: "Rooms",
        })),
      ]
    : [];

  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-r border-gray-4 bg-gray-1 p-3 md:flex">
        <div className="flex items-center gap-2 px-1.5 pt-1">
          <div className="grid size-7 place-items-center rounded-md bg-accent text-[12px] font-semibold text-accent-fg">
            C
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight">CIT Scheduler</p>
            <p className="truncate text-[11px] text-gray-9">{ds?.datasetId ?? "No dataset loaded"}</p>
          </div>
        </div>
        <CommandMenu items={items} jumps={jumps} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav items={items} badges={badges} />
        </div>
        <div className="flex items-center gap-2 border-t border-gray-4 px-1 pt-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{user.name}</p>
            <p className="truncate text-[11px] text-gray-9">{ROLE_LABEL[user.role]}</p>
          </div>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-gray-4 bg-surface/95 px-4 backdrop-blur md:hidden">
        <div className="grid size-7 place-items-center rounded-md bg-accent text-[12px] font-semibold text-accent-fg">
          C
        </div>
        <p className="flex-1 truncate text-[14px] font-semibold">CIT Scheduler</p>
        <CommandMenu items={items} jumps={jumps} hotkeys={false} />
        <ThemeToggle />
        <SignOutButton />
      </header>

      <main className="min-w-0 px-4 pt-5 pb-24 md:px-8 md:pt-7 md:pb-10">{children}</main>
      <MobileTabs items={mobileNavFor(user.role)} />
    </div>
  );
}
