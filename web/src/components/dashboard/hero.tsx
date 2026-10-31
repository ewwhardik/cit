import { Iru } from "@/components/guide/iru";
import { friendlyName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tip } from "./tip";

/** Sun by day, moon by night: a tiny animated mark for the greeting. */
function SkyMark({ night }: { night: boolean }) {
  return night ? (
    <svg viewBox="0 0 24 24" className="sky-mark size-6" aria-hidden>
      <path d="M15.5 3.5a8.5 8.5 0 1 0 5 15.2A7 7 0 0 1 15.5 3.5z" fill="var(--kind-tutorial)" />
      <circle cx="19" cy="5" r="1" fill="var(--accent)" className="twinkle" />
      <circle cx="21.5" cy="9" r=".7" fill="var(--accent)" className="twinkle [animation-delay:.6s]" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="sky-mark sun size-6" aria-hidden>
      <circle cx="12" cy="12" r="4.5" fill="var(--accent)" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect
          key={`ray-${i * 45}`}
          x="11.3"
          y="1.5"
          width="1.4"
          height="3.2"
          rx=".7"
          fill="var(--accent)"
          transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}

/**
 * Dashboard header: greeting, where we are in the semester, a quality grade
 * and a mini ribbon of the week's teaching hours. Iru offers one tip at a time.
 */
export function DashboardHero({
  name,
  hour,
  demoDate,
  weekday,
  grade,
  perDay,
  actions,
}: {
  name: string;
  hour: number;
  demoDate: string;
  weekday: string;
  grade: { grade: string; label: string } | null;
  perDay: Record<string, number> | null;
  actions?: React.ReactNode;
}) {
  const night = hour < 6 || hour >= 19;
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const d = new Date(`${demoDate}T12:00:00Z`);
  const dateLabel = d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const daysToMidsem = (8 - (d.getUTCDay() || 7)) % 7 || 7;
  const max = perDay ? Math.max(1, ...Object.values(perDay)) : 1;

  return (
    <section className="dash-hero relative mb-5 overflow-hidden rounded-[var(--radius-sheet)] border border-gray-4 bg-surface">
      <div aria-hidden className="dash-hero-glow" />
      <div className="relative grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <SkyMark night={night} />
            <h1 className="font-display text-[26px] leading-tight font-bold tracking-[-0.035em] md:text-[30px]">
              {greet}, {friendlyName(name)}
            </h1>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
            <Chip>{dateLabel}</Chip>
            <Chip tone="accent">Week 7 · Spectra week</Chip>
            <Chip>
              Midsems in <span className="tabular font-semibold">{daysToMidsem}</span> day
              {daysToMidsem === 1 ? "" : "s"}
            </Chip>
            {grade ? (
              <Chip tone={grade.grade === "!" ? "bad" : "ok"}>
                Quality <span className="font-semibold">{grade.grade}</span> · {grade.label}
              </Chip>
            ) : null}
          </div>
          <div className="mt-4 flex items-start gap-2.5">
            <Iru size={34} />
            <Tip />
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          {actions}
          {perDay ? (
            <div className="flex items-end gap-1.5" role="img" aria-label="Teaching hours per day">
              {Object.entries(perDay).map(([day, h]) => (
                <div key={day} className="flex flex-col items-center gap-1">
                  <span className="tabular text-[10px] text-gray-8">{h}</span>
                  <span
                    className={cn("week-bar w-6 rounded-[6px]", day === weekday ? "bg-accent" : "bg-gray-4")}
                    style={{ height: `${8 + (h / max) * 40}px` }}
                    title={`${day}: ${h} teaching hours`}
                  />
                  <span
                    className={cn(
                      "text-[10px]",
                      day === weekday ? "font-semibold text-accent" : "text-gray-8",
                    )}
                  >
                    {day.slice(0, 2)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "accent" | "ok" | "bad" }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border px-2.5",
        tone === "accent" && "border-accent/30 bg-accent-soft text-accent",
        tone === "ok" && "border-ok/30 bg-ok-soft text-ok",
        tone === "bad" && "border-bad/30 bg-bad-soft text-bad",
        !tone && "border-gray-4 bg-gray-2 text-gray-9",
      )}
    >
      {children}
    </span>
  );
}
