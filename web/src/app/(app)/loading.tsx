/** Shown while any panel page loads its data. Mirrors the page header + content layout. */
export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="animate-in fade-in duration-150 motion-reduce:animate-none"
    >
      <span className="sr-only">Loading…</span>
      <div className="mb-6 space-y-2">
        <div className="skeleton h-7 w-56" />
        <div className="skeleton h-4 w-80 max-w-full" />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="skeleton h-24" />
        <div className="skeleton h-24" />
        <div className="skeleton h-24" />
      </div>
      <div className="skeleton h-[420px]" />
    </div>
  );
}
