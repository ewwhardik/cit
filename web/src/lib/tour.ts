/**
 * Guided tour steps, built from the site map so they always match the pages a
 * role can open. Each step highlights one element (a `data-tour` attribute)
 * and says what it is and what to do there.
 */
import { pagesFor } from "@/lib/sitemap";
import type { Role } from "@/server/db/schema";

export type TourStep = {
  id: string;
  route: string;
  /** Value of the element's data-tour attribute; null = centred card. */
  target: string | null;
  title: string;
  what: string;
  task: string;
};

const DASHBOARD_STEPS: TourStep[] = [
  {
    id: "welcome",
    route: "/dashboard",
    target: null,
    title: "Welcome to CIT Scheduler",
    what: "One place for the timetable, midsem exams, venue bookings and last-minute changes at Chilika Institute of Technology.",
    task: "Press Next. The tour moves between pages for you; Esc ends it any time.",
  },
  {
    id: "nav",
    route: "/dashboard",
    target: "nav",
    title: "Everything you can open",
    what: "The menu shows only the pages your role is allowed to use.",
    task: "Remember: 'Manage' holds the approval and admin tools.",
  },
  {
    id: "search",
    route: "/dashboard",
    target: "search",
    title: "Jump anywhere",
    what: "Search any group, teacher, room or page.",
    task: "Later, press ⌘K (Ctrl+K) and type a room like LH-1.",
  },
  {
    id: "engine",
    route: "/dashboard",
    target: "engine",
    title: "Engine status",
    what: "Shows whether the scheduling engine is awake and how fast it answers.",
    task: "If it says 'asleep', press Wake and give it up to a minute.",
  },
  {
    id: "kpis",
    route: "/dashboard",
    target: "kpis",
    title: "The scorecard",
    what: "Hard violations must be 0. Soft penalty and booking score show quality.",
    task: "Check the first tile reads 0; that means no clashes anywhere.",
  },
  {
    id: "now",
    route: "/dashboard",
    target: "now",
    title: "Right now",
    what: "What's running in the current period and which rooms are free.",
    task: "Click another day and period to scrub through the week.",
  },
  {
    id: "rules",
    route: "/dashboard",
    target: "rules",
    title: "Constraint monitor",
    what: "All 14 hard rules from the problem statement, checked by deterministic code.",
    task: "Every chip should be green. Hover one to see what it means.",
  },
];

export function tourFor(role: Role): TourStep[] {
  const pages = pagesFor(role)
    .filter((p) => p.href !== "/dashboard")
    .map<TourStep>((p) => ({
      id: p.href,
      route: p.href,
      target: "page-title",
      title: p.label,
      what: p.what,
      task: p.task,
    }));
  return [
    ...DASHBOARD_STEPS,
    ...pages,
    {
      id: "navigator",
      route: "/dashboard",
      target: "navigator",
      title: "Ask Iru, the guide",
      what: "A chat guide that answers questions about the app and takes you to the right page.",
      task: "Try: 'where can I book the auditorium?'",
    },
  ];
}
