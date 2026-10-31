"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function RestoreButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      loading={busy}
      onClick={async () => {
        if (!confirm(`Make version #${id} the current timetable?`)) return;
        setBusy(true);
        const res = await fetch(`/api/versions/${id}/restore`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
          toast.error(body.error ?? "Restore failed");
          return;
        }
        toast.success(`Version #${id} is now current`);
        router.refresh();
      }}
    >
      Restore
    </Button>
  );
}
