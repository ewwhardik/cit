import { desc, eq } from "drizzle-orm";
import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { ActionButton } from "@/components/workflow/action-button";
import { STATUS_LABEL, slotText, timeAgo } from "@/lib/format";
import type { BookingDecision } from "@/lib/schemas/schedule";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "My requests" };

export default async function RequestsPage() {
  const user = await requireUser();
  const bookings = await db.query.bookingRequests.findMany({
    where: eq(schema.bookingRequests.requesterUserId, user.id),
    orderBy: desc(schema.bookingRequests.createdAt),
  });
  const proposals = await db.query.proposals.findMany({
    where: eq(schema.proposals.requestedBy, user.id),
    orderBy: desc(schema.proposals.createdAt),
  });
  return (
    <>
      <PageHeader
        title="My requests"
        description="Every request shows its status and the reason for the decision."
        actions={
          <Link href="/book">
            <Button variant="primary">Book a venue</Button>
          </Link>
        }
      />
      <div className="grid gap-5">
        <Card>
          <CardHeader
            title="Venue bookings"
            description={`${bookings.length} request${bookings.length === 1 ? "" : "s"}`}
          />
          {bookings.length ? (
            <ul className="divide-y divide-gray-4">
              {bookings.map((b) => {
                const p = b.payload as { title?: string; attendance?: number; requested_category?: string };
                const d = b.decision as BookingDecision | null;
                return (
                  <li key={b.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13px] font-medium">{p.title}</p>
                        <Badge tone={statusTone(b.status)}>{STATUS_LABEL[b.status]}</Badge>
                        <span className="tabular text-[11px] text-gray-8">
                          {b.requestId} · {timeAgo(b.createdAt)}
                        </span>
                      </div>
                      <p className="tabular mt-0.5 text-[12px] text-gray-9">
                        {slotText(d)} · {p.attendance} people · {p.requested_category?.replaceAll("_", " ")}
                      </p>
                      {b.reason ? <p className="mt-1 text-[12px] text-gray-10">{b.reason}</p> : null}
                    </div>
                    {b.status === "pending" ||
                    b.status === "approved" ||
                    b.status === "alternative_offered" ? (
                      <ActionButton
                        url={`/api/bookings/${b.requestId}/cancel`}
                        confirmText="Cancel this request? A cancelled request is never approved."
                        success="Request cancelled"
                        size="sm"
                        variant="ghost"
                      >
                        Cancel
                      </ActionButton>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={<Inbox className="size-7" strokeWidth={1.5} />}
              title="No venue requests yet."
              action={
                <Link href="/book" className="text-[13px] text-accent hover:underline">
                  Book a venue →
                </Link>
              }
            />
          )}
        </Card>
        {proposals.length ? (
          <Card>
            <CardHeader title="Timetable change requests" />
            <ul className="divide-y divide-gray-4">
              {proposals.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/approvals/p/${p.id}`} className="text-[13px] font-medium hover:text-accent">
                      {p.title}
                    </Link>
                    <p className="text-[12px] text-gray-9">
                      {(p.diff as unknown[]).length} session change(s) · {timeAgo(p.createdAt)}
                    </p>
                  </div>
                  <Badge tone={statusTone(p.status)}>{STATUS_LABEL[p.status]}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
