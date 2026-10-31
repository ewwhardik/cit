/**
 * The app's site map: one source of truth for the sidebar, the command
 * palette, the guided tour and the AI navigator. Each page says what it is
 * and what a user (or a judge) is expected to do there, so the navigator can
 * only ever send people to real pages they are allowed to open.
 */
import type { Role } from "@/server/db/schema";

export type Page = {
  href: string;
  label: string;
  icon: string;
  /** Omitted = every role. */
  roles?: Role[];
  shortcut?: string;
  /** Shown in the phone bottom bar (max 5 per role). */
  mobile?: boolean;
  section?: "main" | "manage";
  /** One sentence: what this page is. */
  what: string;
  /** One sentence: what to do here. */
  task: string;
  /** Extra words people use for it (English + Hinglish), for the offline navigator. */
  keywords: string[];
};

export const PAGES: Page[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: "layout",
    shortcut: "g d",
    mobile: true,
    what: "Live operations console: rule health, what's running now, loads, Spectra decisions and room use.",
    task: "Check that hard violations are 0, then scrub the 'Right now' panel to any day and period.",
    keywords: ["home", "overview", "stats", "kpi", "health", "status", "summary", "console"],
  },
  {
    href: "/timetable",
    label: "Timetables",
    icon: "calendar",
    shortcut: "g t",
    mobile: true,
    what: "The weekly timetable for any student group, teacher or room.",
    task: "Pick Group, Faculty or Room, click a class and press 'Why here?' to see the engine's reasoning.",
    keywords: [
      "schedule",
      "class",
      "classes",
      "lecture",
      "routine",
      "time table",
      "my week",
      "kab hai",
      "faculty",
      "group",
      "room",
    ],
  },
  {
    href: "/exams",
    label: "Midsem exams",
    icon: "exams",
    shortcut: "g e",
    what: "The midsem exam week (Mon–Sat, AM/PM) with rooms at half capacity.",
    task: "Filter by your group to see your exam days, rooms and seat counts.",
    keywords: ["exam", "exams", "midsem", "test", "paper", "pariksha"],
  },
  {
    href: "/rooms",
    label: "Find a room",
    icon: "search",
    shortcut: "g r",
    mobile: true,
    what: "Search free rooms by time, size and needs (projector, accessibility, stage…).",
    task: "Choose a day, time and headcount, then press Book on a free room.",
    keywords: ["free room", "empty room", "available", "khali", "space", "venue search", "room finder"],
  },
  {
    href: "/book",
    label: "Book a venue",
    icon: "plus",
    shortcut: "g b",
    mobile: true,
    what: "Turn a plain English or Hinglish request into an editable booking; the engine checks availability.",
    task: "Type or pick a request, review the filled form and submit it for approval.",
    keywords: ["book", "booking", "reserve", "event", "hall", "auditorium", "seminar", "chahiye", "venue"],
  },
  {
    href: "/requests",
    label: "My requests",
    icon: "inbox",
    shortcut: "g m",
    what: "Every booking and change you asked for, with its status and the reason.",
    task: "Open a request to see why it was approved, rejected or given an alternative; cancel if needed.",
    keywords: ["my bookings", "status", "requests", "cancel", "mera"],
  },
  {
    href: "/assistant",
    label: "Change request",
    icon: "bot",
    roles: ["faculty", "dept_coordinator", "admin"],
    shortcut: "g c",
    what: "Ask for timetable changes in plain words; the engine turns them into a checked proposal.",
    task: "Describe the change (e.g. 'I can't take Thursday mornings'), review the fix and submit it.",
    keywords: ["change", "move class", "reschedule", "leave", "unavailable", "shift", "swap"],
  },
  {
    href: "/approvals",
    label: "Approvals",
    icon: "check",
    roles: ["admin", "dept_coordinator"],
    shortcut: "g a",
    mobile: true,
    section: "manage",
    what: "Inbox of bookings and timetable changes waiting for a decision.",
    task: "Open an item, read the engine's validation and approve or reject it. Nobody approves their own.",
    keywords: ["approve", "reject", "inbox", "pending", "review", "decide"],
  },
  {
    href: "/resilience",
    label: "Resilience",
    icon: "shield",
    roles: ["admin", "dept_coordinator"],
    shortcut: "g h",
    section: "manage",
    what: "Simulates losing the busiest teachers and rooms for a day and repairs each case.",
    task: "Run a quick scan and look for scenarios with no valid fix or many moves.",
    keywords: ["what if", "stress test", "robust", "risk", "scenario", "simulate"],
  },
  {
    href: "/versions",
    label: "Versions",
    icon: "history",
    roles: ["admin", "dept_coordinator"],
    shortcut: "g v",
    section: "manage",
    what: "History of every timetable version with scores and differences.",
    task: "Compare versions; an Admin can restore an earlier clash-free one.",
    keywords: ["history", "undo", "restore", "previous", "rollback", "compare"],
  },
  {
    href: "/spectra",
    label: "Spectra week",
    icon: "sparkles",
    shortcut: "g s",
    section: "manage",
    what: "All 25 Spectra-week booking decisions with the reason for each.",
    task: "Read why each request was approved, moved or rejected under the priority rules.",
    keywords: ["fest", "spectra", "tech fest", "decisions", "priority", "week 7"],
  },
  {
    href: "/disruptions",
    label: "Disruptions",
    icon: "alert",
    roles: ["admin"],
    shortcut: "g x",
    section: "manage",
    what: "Load a change file (leave, closure, new session) and get a minimal-change fix.",
    task: "Use the sample disruption, press Propose a fix, review the diff and approve.",
    keywords: ["disruption", "change file", "repair", "fix", "closure", "emergency"],
  },
  {
    href: "/generate",
    label: "Generate",
    icon: "cpu",
    roles: ["admin"],
    shortcut: "g g",
    section: "manage",
    what: "Builds the timetable, exams and Spectra decisions in one solver run.",
    task: "Pick a time budget and press Generate timetable; it runs on a 4-CPU runner.",
    keywords: ["generate", "solve", "solver", "create timetable", "build", "run"],
  },
  {
    href: "/data",
    label: "Data",
    icon: "database",
    roles: ["admin"],
    section: "manage",
    what: "Dataset upload, demo reset and schedule.json export.",
    task: "Reset demo data for a clean start, or export the current schedule.json.",
    keywords: ["data", "dataset", "reset", "export", "download", "upload", "json"],
  },
];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  dept_coordinator: "Dept coordinator",
  faculty: "Faculty",
  club: "Club rep",
};

export function pagesFor(role: Role): Page[] {
  return PAGES.filter((p) => !p.roles || p.roles.includes(role));
}
