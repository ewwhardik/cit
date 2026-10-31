import {
  BellRing,
  Bot,
  CalendarDays,
  CircleCheckBig,
  Cpu,
  Database,
  Inbox,
  LayoutGrid,
  type LucideIcon,
  Plus,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  layout: LayoutGrid,
  calendar: CalendarDays,
  sparkles: Sparkles,
  database: Database,
  search: Search,
  plus: Plus,
  inbox: Inbox,
  bot: Bot,
  check: CircleCheckBig,
  alert: TriangleAlert,
  cpu: Cpu,
  bell: BellRing,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? LayoutGrid;
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
