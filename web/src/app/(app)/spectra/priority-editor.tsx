"use client";

import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const LABEL: Record<string, string> = {
  exam: "Exams",
  regular_session: "Regular classes",
  institute_event: "Institute events",
  guest_lecture: "Guest lectures",
  department_event: "Department events",
  club_event: "Club events",
};
const LOCKED = new Set(["exam", "regular_session"]);

/** Who wins a contested room. Admins reorder the event categories; exams and classes stay on top. */
export function PriorityEditor({ order, canEdit }: { order: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [list, setList] = useState(order);
  const [busy, setBusy] = useState(false);
  const dirty = list.join() !== order.join();

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (LOCKED.has(list[j] ?? "") || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    setList(next);
  }

  async function save() {
    setBusy(true);
    const res = await fetch("/api/settings/priority", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: list.filter((c) => !LOCKED.has(c)) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast.error(body.error ?? "Could not save");
    toast.success("Priority order saved. Run Generate to re-decide Spectra bookings.");
    router.refresh();
  }

  return (
    <Card data-tour="priority">
      <CardHeader
        title="Priority order"
        description="When two requests want the same room at the same time, the higher one wins. Ties go to the earlier request."
        action={
          canEdit && dirty ? (
            <Button variant="primary" size="sm" loading={busy} onClick={save}>
              Save order
            </Button>
          ) : null
        }
      />
      <ol className="grid gap-1.5 p-4">
        {list.map((c, i) => (
          <li
            key={c}
            className={cn(
              "flex items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-[13px] transition-colors",
              LOCKED.has(c) ? "border-gray-4 bg-gray-2 text-gray-9" : "border-gray-4",
            )}
          >
            <span className="tabular grid size-6 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
              {i + 1}
            </span>
            <span className="flex-1 font-medium">{LABEL[c] ?? c}</span>
            {LOCKED.has(c) ? (
              <span
                className="flex items-center gap-1 text-[11px] text-gray-8"
                title="The timetable always comes first"
              >
                <Lock className="size-3" /> fixed
              </span>
            ) : canEdit ? (
              <span className="flex gap-1">
                <button
                  type="button"
                  aria-label={`Move ${LABEL[c]} up`}
                  disabled={LOCKED.has(list[i - 1] ?? "")}
                  onClick={() => move(i, -1)}
                  className="grid size-7 place-items-center rounded-md text-gray-9 hover:bg-gray-3 disabled:opacity-30 max-md:size-10"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${LABEL[c]} down`}
                  disabled={i === list.length - 1}
                  onClick={() => move(i, 1)}
                  className="grid size-7 place-items-center rounded-md text-gray-9 hover:bg-gray-3 disabled:opacity-30 max-md:size-10"
                >
                  <ArrowDown className="size-3.5" />
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {canEdit ? (
        <p className="border-t border-gray-4 px-4 py-2.5 text-[12px] text-gray-8">
          Saved orders apply at the next{" "}
          <Link href="/generate" className="text-accent hover:underline">
            Generate
          </Link>
          , which re-decides all Spectra bookings. Every change is audited.
        </p>
      ) : null}
    </Card>
  );
}
