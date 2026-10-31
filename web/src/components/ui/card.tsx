import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[var(--radius-card)] border border-gray-4 bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-gray-4 px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-gray-10">{title}</h2>
        {description ? <div className="mt-0.5 text-[12px] text-gray-9">{description}</div> : null}
      </div>
      {action}
    </div>
  );
}
