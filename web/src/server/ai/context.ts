import "server-only";
import type { ParseContext } from "@/lib/booking/parser";
import type { Dataset } from "@/lib/schemas/dataset";

const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

/** "Today" for resolving kal / tomorrow. Pinned by DEMO_TODAY so the demo always lands in Spectra week. */
export function demoToday(): { date: string; weekday: string } {
  const date = process.env.DEMO_TODAY ?? new Date().toISOString().slice(0, 10);
  const d = new Date(`${date}T12:00:00Z`);
  return { date, weekday: WEEKDAY[d.getUTCDay()] ?? "MON" };
}

export function parseContext(ds: Dataset): ParseContext {
  return {
    rooms: ds.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      capacity: r.capacity,
      features: r.features,
      accessible: r.accessible,
      allowed_uses: r.allowed_uses,
    })),
    groups: ds.student_groups.map((g) => ({ id: g.id, name: g.name, year: g.year, department: g.department, size: g.size })),
    today: demoToday().weekday,
  };
}
