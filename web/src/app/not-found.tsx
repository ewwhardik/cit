import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <p className="font-display text-[96px] leading-none font-extrabold tracking-[-0.06em] text-accent">
          404
        </p>
        <h1 className="mt-4 font-display text-[22px] font-bold tracking-tight">This slot is empty.</h1>
        <p className="mt-2 text-[14px] text-gray-9">The page you asked for isn&apos;t on the timetable.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-full bg-accent px-5 text-[14px] font-semibold text-accent-fg"
          >
            Home
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded-full border border-gray-5 px-5 text-[14px] font-medium"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
