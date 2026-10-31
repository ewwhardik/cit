import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-[var(--radius-control)] border border-gray-5 bg-surface px-2.5 text-[13px] text-gray-10",
        "placeholder:text-gray-8 transition-colors duration-[120ms] hover:border-gray-6",
        "focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25",
        "max-md:h-11 max-md:text-base",
        className,
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor
  return <label className={cn("text-[12px] font-medium text-gray-9", className)} {...props} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="tabular inline-flex h-5 min-w-5 items-center justify-center rounded border border-gray-5 bg-gray-2 px-1 text-[11px] text-gray-9">
      {children}
    </kbd>
  );
}
