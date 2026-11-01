"use client";

import { FileUp, Play, TriangleAlert } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { JobStatusLine, useJob } from "@/components/workflow/job-progress";
import { ImpactPreview, type Placed } from "./impact";

export function DisruptionPanel({
  hasTimetable,
  sample,
  placed,
}: {
  hasTimetable: boolean;
  sample: string | null;
  placed: Placed[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const started = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const { job, running } = useJob(jobId, (j) => {
    if (j.proposalId) {
      toast.success("Fix proposed", { description: "Review the changes and approve." });
      router.push(`/approvals/p/${j.proposalId}` as Route);
    } else if (j.result?.status === "unchanged") {
      toast.info("The current timetable already satisfies these changes.");
    }
  });

  async function run() {
    let changes: unknown;
    try {
      changes = JSON.parse(text);
    } catch {
      toast.error("That is not valid JSON.");
      return;
    }
    setStarting(true);
    try {
      const res = await fetch("/api/disruptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      started.current = Date.now();
      setJobId(body.jobId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card className="h-fit">
      <CardHeader
        title="Apply a change file"
        description="Same format as the starter pack's sample_disruption.json."
      />
      <div className="grid gap-3 p-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          aria-label="Change file JSON"
          placeholder='{"changes": [{"type": "faculty_unavailable", "faculty_id": "F07", "days": ["MON"], "periods": [1,2,3,4,5,6,7,8,9]}]}'
          className="tabular w-full resize-y rounded-[var(--radius-control)] border border-gray-5 bg-surface p-3 text-[12px] outline-none focus-visible:border-accent"
        />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => fileRef.current?.click()} disabled={running}>
            <FileUp className="size-3.5" /> Upload file
          </Button>
          {sample ? (
            <Button variant="ghost" onClick={() => setText(sample)} disabled={running}>
              Use sample disruption
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={run}
            loading={starting}
            disabled={!text.trim() || running || !hasTimetable}
          >
            {!starting ? <Play className="size-3.5" /> : null} Propose a fix
          </Button>
        </div>
        {!hasTimetable ? <p className="text-[12px] text-gray-9">Generate a timetable first.</p> : null}
        <ImpactPreview text={text} placed={placed} />
      </div>
      {jobId ? (
        <div className="border-t border-gray-4 p-4">
          {running ? (
            <JobStatusLine job={job} startedAt={started.current} />
          ) : job?.result && !job.proposalId && job.result.status !== "unchanged" ? (
            <div className="flex items-start gap-3 text-[13px]">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-bad" />
              <div className="grid gap-1">
                <p className="font-medium">
                  {job.result.status === "infeasible"
                    ? "No valid fix exists. These constraints conflict:"
                    : "The solver ran out of time before finding a fix."}
                </p>
                <ul className="list-disc pl-4 text-gray-10">
                  {job.result.diagnostics.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : job?.status === "failed" ? (
            <p className="text-[13px] text-bad">{job.error}</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
