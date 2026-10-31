import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "ok" | "warn" | "bad";
const tones: Record<Tone, string> = {
  neutral: "bg-gray-3 text-gray-9",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-[color:var(--warn)]",
  bad: "bg-bad-soft text-bad",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function statusTone(status: string): Tone {
  if (status === "approved" || status === "applied") return "ok";
  if (status === "pending" || status === "alternative_offered" || status === "proposed") return "warn";
  if (status === "rejected" || status === "cancelled" || status === "conflict") return "bad";
  return "neutral";
}
