import { DayStrip } from "@/components/booking/day-strip";
import { cn } from "@/lib/utils";

type Win = { day: string; from_period: number; to_period: number };

const STEPS = ["Written", "Read", "Checked by engine", "Decision"] as const;
const PARSED: Record<string, string> = {
  llm: "Read by AI",
  fallback: "Read offline",
  manual: "Form",
  dataset: "Dataset",
};

/** A booking's path from text to decision, then its day: asked window versus given slot. */
export function BookingJourney({
  status,
  parsedBy,
  windows,
  given,
}: {
  status: string;
  parsedBy: string;
  windows: Win[];
  given: { day?: string | null; start_period?: number | null; end_period?: number | null } | null;
}) {
  const decided = status !== "pending";
  const reached = decided ? 4 : 3;
  const tone =
    status === "approved"
      ? "var(--ok)"
      : status === "alternative_offered"
        ? "var(--warn)"
        : status === "rejected" || status === "cancelled"
          ? "var(--bad)"
          : "var(--gray-7)";

  return (
    <div className="grid gap-2">
      <ol className="bj-steps" aria-label="Request progress">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={cn(i < reached && "bj-done")}
            style={i === 3 && decided ? ({ "--bj": tone } as React.CSSProperties) : undefined}
          >
            <span>
              {i === 1 ? (PARSED[parsedBy] ?? s) : i === 3 && decided ? status.replaceAll("_", " ") : s}
            </span>
          </li>
        ))}
      </ol>
      <DayStrip windows={windows} given={given} tone={tone} />
    </div>
  );
}
