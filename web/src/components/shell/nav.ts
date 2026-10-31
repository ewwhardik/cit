import type { Role } from "@/server/db/schema";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles?: Role[];
  shortcut?: string;
  /** Shown in the phone bottom bar (max 5 per role). */
  mobile?: boolean;
  section?: "main" | "manage";
};

/** Sidebar / command-palette destinations. `roles` omitted = everyone. */
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "layout", shortcut: "g d", mobile: true },
  { href: "/timetable", label: "Timetables", icon: "calendar", shortcut: "g t", mobile: true },
  { href: "/rooms", label: "Find a room", icon: "search", shortcut: "g r", mobile: true },
  { href: "/book", label: "Book a venue", icon: "plus", shortcut: "g b", mobile: true },
  { href: "/requests", label: "My requests", icon: "inbox", shortcut: "g m" },
  {
    href: "/assistant",
    label: "Change request",
    icon: "bot",
    roles: ["faculty", "dept_coordinator", "admin"],
    shortcut: "g c",
  },
  {
    href: "/approvals",
    label: "Approvals",
    icon: "check",
    roles: ["admin", "dept_coordinator"],
    shortcut: "g a",
    mobile: true,
    section: "manage",
  },
  { href: "/spectra", label: "Spectra week", icon: "sparkles", shortcut: "g s", section: "manage" },
  {
    href: "/disruptions",
    label: "Disruptions",
    icon: "alert",
    roles: ["admin"],
    shortcut: "g x",
    section: "manage",
  },
  { href: "/generate", label: "Generate", icon: "cpu", roles: ["admin"], shortcut: "g g", section: "manage" },
  { href: "/data", label: "Data", icon: "database", roles: ["admin"], section: "manage" },
];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  dept_coordinator: "Dept coordinator",
  faculty: "Faculty",
  club: "Club rep",
};

export function navFor(role: Role) {
  return NAV.filter((n) => !n.roles || n.roles.includes(role));
}

export function mobileNavFor(role: Role) {
  const items = navFor(role).filter((n) => n.mobile);
  if (!items.some((i) => i.href === "/approvals")) {
    const req = NAV.find((n) => n.href === "/requests");
    if (req) items.push(req);
  }
  return items.slice(0, 5);
}
