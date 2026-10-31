import { desc, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import type { BookingDecision } from "@/lib/schemas/schedule";
import { canDecideBooking } from "@/server/bookings";
import { getActiveDataset } from "@/server/data";
import { db, schema } from "@/server/db";
import { requireRole } from "@/server/session";
import { Inbox, type InboxItem } from "./inbox";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const user = await requireRole("admin", "dept_coordinator");
  const ds = await getActiveDataset();
  const users = new Map((await db.query.user.findMany()).map((u) => [u.id, u]));
  const bookings = await db.query.bookingRequests.findMany({
    where: inArray(schema.bookingRequests.status, [
      "pending",
      "approved",
      "alternative_offered",
      "rejected",
      "cancelled",
    ]),
    orderBy: desc(schema.bookingRequests.createdAt),
    limit: 100,
  });
  const proposals =
    user.role === "admin"
      ? await db.query.proposals.findMany({ orderBy: desc(schema.proposals.createdAt), limit: 50 })
      : [];
  const items: InboxItem[] = [];
  for (const b of bookings) {
    const perm = ds ? await canDecideBooking(user, b, ds.json) : { ok: false, why: "No dataset" };
    const p = b.payload as Record<string, unknown>;
    items.push({
      key: `b-${b.id}`,
      kind: "booking",
      id: b.requestId,
      title: String(p.title ?? b.requestId),
      status: b.status,
      requester: users.get(b.requesterUserId ?? "")?.name ?? "Unknown",
      createdAt: b.createdAt.toISOString(),
      canDecide: perm.ok && b.status === "pending",
      whyNot: perm.ok ? null : perm.why,
      booking: {
        payload: p,
        decision: b.decision as BookingDecision | null,
        reason: b.reason,
        rawText: b.rawText,
        parsedBy: b.parsedBy,
      },
    });
  }
  for (const pr of proposals) {
    items.push({
      key: `p-${pr.id}`,
      kind: "proposal",
      id: String(pr.id),
      title: pr.title,
      status: pr.status,
      requester: users.get(pr.requestedBy)?.name ?? "Unknown",
      createdAt: pr.createdAt.toISOString(),
      canDecide: pr.status === "pending" && pr.requestedBy !== user.id,
      whyNot: pr.requestedBy === user.id ? "You cannot approve your own request." : null,
      proposal: {
        type: pr.type,
        summary: (pr.summary ?? {}) as Record<string, number>,
        changes: (pr.diff as unknown[]).length,
        explanation: pr.explanation,
      },
    });
  }
  items.sort(
    (a, b) =>
      Number(b.status === "pending") - Number(a.status === "pending") ||
      b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          user.role === "admin"
            ? "Venue bookings and timetable changes waiting for a decision. Nobody can approve their own request."
            : "Bookings of your department's labs. Nobody can approve their own request."
        }
      />
      <Inbox items={items} />
    </>
  );
}
