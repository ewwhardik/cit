"use client";

import { Download, RotateCcw, Upload } from "lucide-react";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { resetDemo, uploadDataset } from "./actions";

export function DataActions({ hasVersion }: { hasVersion: boolean }) {
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const report = (r: Awaited<ReturnType<typeof resetDemo>>) => {
    if (r.ok) toast.success(r.message);
    else toast.error(r.error);
  };

  return (
    <Card>
      <CardHeader title="Actions" />
      <div className="grid gap-4 p-4">
        <Row
          title="Reset demo data"
          text="Clears timetables, bookings, proposals and the audit log, restores the four demo accounts and reloads the public dataset."
        >
          <Button
            variant="danger"
            loading={pending}
            onClick={() => {
              if (!confirm("Reset all demo data? Generated timetables and requests will be removed.")) return;
              start(async () => report(await resetDemo()));
            }}
          >
            <RotateCcw className="size-3.5" /> Reset
          </Button>
        </Row>
        <Row
          title="Load dataset"
          text="Upload a dataset JSON in the starter-pack format (cit_public.json shape)."
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              start(async () => {
                report(await uploadDataset(await f.text()));
                if (fileRef.current) fileRef.current.value = "";
              });
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={pending}>
            <Upload className="size-3.5" /> Upload
          </Button>
        </Row>
        <Row
          title="Export schedule.json"
          text="Timetable, exams and Spectra decisions. Refused if anything has a hard violation."
        >
          <a
            href="/api/export"
            aria-disabled={!hasVersion}
            className={hasVersion ? "" : "pointer-events-none opacity-50"}
          >
            <Button tabIndex={-1}>
              <Download className="size-3.5" /> Download
            </Button>
          </a>
        </Row>
      </div>
    </Card>
  );
}

function Row({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-[12px] text-gray-9">{text}</p>
      </div>
      {children}
    </div>
  );
}
