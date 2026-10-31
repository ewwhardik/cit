"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";

/** POSTs JSON to an API route, toasts the outcome and refreshes server data. */
export function ActionButton({
  url,
  body,
  confirmText,
  prompt,
  success,
  redirectTo,
  children,
  ...props
}: ButtonProps & {
  url: string;
  body?: Record<string, unknown>;
  confirmText?: string;
  /** Ask for a note (e.g. rejection reason) and send it as `note`/`reason`. */
  prompt?: string;
  success: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      {...props}
      loading={busy}
      onClick={async () => {
        if (confirmText && !confirm(confirmText)) return;
        let note: string | null = null;
        if (prompt) {
          note = window.prompt(prompt);
          if (note === null) return;
        }
        setBusy(true);
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, ...(note !== null ? { note, reason: note } : {}) }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Action failed");
          toast.success(success, { description: data.reason ?? undefined });
          if (redirectTo) router.push(redirectTo as Route);
          router.refresh();
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
