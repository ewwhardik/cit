import { cn } from "@/lib/utils";

type Win = { day: string; from_period: number; to_period: number };

/**
 * One day from P1 (08:00) to P13 (21:00): the window that was asked for,
 * outlined, and the slot that was given, filled in the decision's colour.
 */
export function DayStrip({
  windows,
  given,
  tone = "var(--ok)",
}: {
  windows: Win[];
  given: { day?: string | null; start_period?: number | null; end_period?: number | null } | null;
  tone?: string;
}) {
  const day = given?.day ?? windows[0]?.day ?? null;
  if (!day) return null;
  const asked = windows.filter((w) => w.day === day);
  const outside = given?.day && !windows.some((w) => w.day === given.day);
  return (
    <div className="grid gap-1">
      <div className="bj-day" role="img" aria-label={`${day}: asked versus given`}>
        {Array.from({ length: 13 }, (_, i) => i + 1).map((p) => {
          const ask = asked.some((w) => p >= w.from_period && p <= w.to_period);
          const got = given?.day === day && p >= (given.start_period ?? 99) && p <= (given.end_period ?? 0);
          return (
            <span
              key={p}
              className={cn(
                "bj-cell",
                ask && "bj-ask",
                got && "bj-got",
                p === 10 && "bj-eve",
                p === 6 && "bj-lunch",
              )}
              style={got ? ({ "--bj": tone } as React.CSSProperties) : undefined}
              title={`P${p}${ask ? " · asked" : ""}${got ? " · given" : ""}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-8">
        <span className="tabular">{day} · 08:00 → 22:00</span>
        <span className="inline-flex items-center gap-1">
          <i className="bj-key bj-ask" /> asked
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="bj-key bj-got" style={{ "--bj": tone } as React.CSSProperties} /> given
        </span>
        {outside ? <span>(given on another day)</span> : null}
      </div>
    </div>
  );
}
