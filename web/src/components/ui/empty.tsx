import { cn } from "@/lib/utils";

/** One line plus one action (PLAN.md §6.1 states). */
export function EmptyState({
  icon,
  title,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      {icon ? <div className="text-gray-7">{icon}</div> : null}
      <p className="text-[13px] text-gray-9">{title}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-bad/30 bg-bad-soft px-6 py-8 text-center">
      <p className="text-[13px] font-medium text-bad">{title}</p>
      {detail ? <p className="max-w-prose text-[12px] text-gray-9">{detail}</p> : null}
      {action}
    </div>
  );
}
