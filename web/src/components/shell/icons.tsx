import { CalendarDays, Database, LayoutGrid, type LucideIcon, Sparkles } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  layout: LayoutGrid,
  calendar: CalendarDays,
  sparkles: Sparkles,
  database: Database,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? LayoutGrid;
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
