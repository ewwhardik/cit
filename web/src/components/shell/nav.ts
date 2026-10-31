import type { Role } from "@/server/db/schema";

export type NavItem = { href: string; label: string; icon: string; roles?: Role[]; shortcut?: string };

/** Sidebar / command-palette destinations. `roles` omitted = everyone. */
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "layout", shortcut: "g d" },
  { href: "/timetable", label: "Timetables", icon: "calendar", shortcut: "g t" },
  { href: "/generate", label: "Generate", icon: "sparkles", roles: ["admin"], shortcut: "g g" },
  { href: "/data", label: "Data", icon: "database", roles: ["admin"] },
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
