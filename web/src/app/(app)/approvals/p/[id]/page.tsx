import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { type DiffRow, DiffView } from "@/components/diff/diff-view";
import { PageHeader } from "@/components/page-header";
import { ReportCard } from "@/components/report/report-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionButton } from "@/components/workflow/action-button";
import { describeChange } from "@/lib/changes";
import { diffGroupBlocks } from "@/lib/diff-blocks";
import { STATUS_LABEL, timeAgo } from "@/lib/format";
import type { ChangeFile } from "@/lib/schemas/dataset";
import type { Report, Schedule } from "@/lib/schemas/schedule";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Review change" };

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  const p = Number.isFinite(id)
    ? await db.query.proposals.findFirst({ where: eq(schema.proposals.id, id) })
    : null;
  if (!p) notFound();
  if (user.role !== "admin" && p.requestedBy !== user.id) redirect("/dashboard?denied=1");
  const ds = await getActiveDataset();
  if (!ds) notFound();
  const current = await getCurrentVersion(ds.id);
  const requester = await db.query.user.findFirst({ where: eq(schema.user.id, p.requestedBy) });
  const rows = p.diff as DiffRow[];
  const changes = ((p.changes ?? { changes: [] }) as ChangeFile).changes;
  const summary = (p.summary ?? {}) as Record<string, number> & { fest_note?: string | null };
  const stale = p.status === "pending" && current?.id !== p.baseVersionId;
  const own = p.requestedBy === user.id;
  const canDecide = user.role === "admin" && !own && p.status === "pending" && !stale;

  return (
    <div className="pb-20">
      <PageHeader
        title={p.title}
        description={
          <>
            {p.type.replace("_", " ")} · requested by {requester?.name ?? "unknown"} · {timeAgo(p.createdAt)}{" "}
            · <Badge tone={statusTone(p.status)}>{STATUS_LABEL[p.status]}</Badge>
          </>
        }
        actions={
          <Link href="/approvals" className="text-[13px] text-gray-9 hover:text-gray-10">
            ← Approvals
          </Link>
        }
      />
      <div className="grid gap-5">
        {changes.length || p.explanation ? (
          <Card>
            <CardHeader
              title="Requested change"
              description="Applied permanently to the dataset when approved."
            />
            <div className="grid gap-2 p-4 text-[13px]">
              {changes.map((c, i) => (
                <p key={i} className="tabular">
                  • {describeChange(c)}
                </p>
              ))}
              {p.explanation ? <p className="whitespace-pre-line text-gray-9">{p.explanation}</p> : null}
            </div>
          </Card>
        ) : null}
        <DiffView
          rows={rows}
          summary={summary}
          groupBlocks={diffGroupBlocks(ds.json, p.schedule as Schedule, rows)}
          rooms={ds.json.rooms.map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            capacity: r.capacity,
            building: r.building ?? "",
            features: r.features,
          }))}
        />
        <ReportCard report={p.validation as Report} title="Validation of the proposed timetable" />
      </div>

      {p.status === "pending" ? (
        <div className="fixed inset-x-0 bottom-14 z-20 border-t border-gray-4 bg-surface/95 px-4 py-3 backdrop-blur md:bottom-0 md:left-[232px] md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-gray-9">
              {stale
                ? "The timetable changed after this was proposed; it can no longer be applied. Re-run it."
                : own
                  ? "You requested this change, so someone else must approve it."
                  : user.role !== "admin"
                    ? "Waiting for an Admin."
                    : "Approving re-validates the whole timetable, then applies it."}
            </p>
            <div className="flex gap-2">
              <ActionButton
                url={`/api/proposals/${p.id}/decide`}
                body={{ action: "reject" }}
                prompt="Reason for rejecting:"
                success="Proposal rejected"
                disabled={!canDecide && !(user.role === "admin" && !own && stale)}
              >
                Reject
              </ActionButton>
              <ActionButton
                url={`/api/proposals/${p.id}/decide`}
                body={{ action: "approve" }}
                success="Change applied: new timetable version is live"
                variant="primary"
                disabled={!canDecide}
                redirectTo="/timetable"
              >
                Approve {rows.length} change{rows.length === 1 ? "" : "s"}
              </ActionButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
