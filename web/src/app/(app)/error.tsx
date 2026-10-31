"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Panel-wide error boundary: explains, offers a retry, never shows a blank page. */
export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const engine = /engine|fetch failed|ECONNREFUSED|timeout/i.test(error.message);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-bad-soft text-bad">
        <TriangleAlert className="size-5" />
      </span>
      <h1 className="font-display text-[20px] font-bold tracking-tight">Something went wrong</h1>
      <p className="text-[13px] text-gray-9">
        {engine
          ? "The scheduling engine didn't answer. On the free hosting tier it can take up to a minute to wake up, so try again shortly."
          : "This page failed to load. Your data is safe; nothing was changed."}
      </p>
      {error.digest ? <p className="tabular text-[11px] text-gray-8">Reference {error.digest}</p> : null}
      <div className="mt-2 flex gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Link href="/dashboard">
          <Button>Dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
