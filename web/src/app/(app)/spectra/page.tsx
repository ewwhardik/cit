import { inArray } from "drizzle-orm";
import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { STATUS_LABEL, slotText } from "@/lib/format";
import type { BookingRequest, Dataset } from "@/lib/schemas/dataset";
import type { BookingDecision } from "@/lib/schemas/schedule";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/session";
import { PriorityEditor } from "./priority-editor";
import { type TimelineItem, VenueTimeline } from "./venue-timeline";

export const metadata: Metadata = { title: "Spectra week" };

function effectiveCategory(ds: Dataset, r: BookingRequest) {
  const order = ds.priority_order;
  const cap = ds.role_category_cap[r.role] ?? "club_event";
  const asked = order.includes(r.requested_category) ? order.indexOf(r.requested_category) : order.length - 1;
  return order[Math.max(asked, order.indexOf(cap))] ?? "club_event";
}

export default async function SpectraPage() {
  const user = await requireUser();
  const ds = await getActiveDataset();
  const [version, app] = await Promise.all([
    ds ? getCurrentVersion(ds.id) : Promise.resolve(null),
    db.query.bookingRequests.findMany({
      where: inArray(schema.bookingRequests.status, ["approved", "alternative_offered"]),
    }),
  ]);
  if (!ds || !version?.schedule.fest_week) {
    return (
      <>
        <PageHeader title="Spectra week" />
        <Card>
          <EmptyState
            icon={<Sparkles className="size-7" strokeWidth={1.5} />}
            title="Booking decisions appear here after the timetable is generated."
            action={
              user.role === "admin" ? (
                <Link href="/generate">
                  <Button variant="primary">Generate</Button>
                </Link>
              ) : null
            }
          />
        </Card>
      </>
    );
  }
  const fest = version.schedule.fest_week;
  const decisions = new Map(fest.bookings.map((b) => [b.request_id, b]));
  const appDecisions = app.map((a) => ({
    d: a.decision as BookingDecision,
    title: (a.payload as { title?: string }).title ?? a.requestId,
    category: (a.payload as { category?: string }).category ?? "club_event",
  }));
  const b = version.report.bookings;
  const cancelled = new Set(ds.json.cancellations.map((c) => c.request_id));

  // Timeline: every placed booking (dataset + app), with its effective category.
  const placed = [
    ...fest.bookings
      .filter((d) => d.room_id)
      .map((d) => {
        const req = ds.json.booking_requests.find((r) => r.id === d.request_id);
        return {
          d,
          title: req?.title ?? d.request_id,
          category: req ? effectiveCategory(ds.json, req) : "club_event",
        };
      }),
    ...appDecisions,
  ];
  const items: TimelineItem[] = placed.flatMap((p) => {
    const { d } = p;
    if (!d.room_id || !d.day || d.start_period == null || d.end_period == null) return [];
    return [
      {
        id: d.request_id,
        title: p.title,
        room: d.room_id,
        day: d.day,
        start: d.start_period,
        end: d.end_period,
        status: d.status,
        category: p.category,
        reason: d.reason ?? "",
      },
    ];
  });
  const venues = [...new Set(items.map((i) => i.room))].sort();

  return (
    <>
      <PageHeader
        title="Spectra week"
        description="Every Spectra request gets a decision and a reason, decided by the priority order below; ties go to whoever asked first. Categories are capped by the requester's role."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            [
              "Booking score",
              `${b?.booking_score ?? "–"}`,
              `of ${b?.booking_score_max_if_all_approved ?? "–"} if all approved`,
            ],
            ["Approved", b?.approved, "inside the requested window"],
            ["Alternatives", b?.alternatives, "valid slot outside the window"],
            ["Rejected", b?.rejected, "each with a reason"],
            ["Classes moved", b?.session_overrides, "Week 7 only, never cancelled"],
          ].map(([k, v, h]) => (
            <Card key={String(k)} className="p-4">
              <p className="text-[12px] text-gray-9">{k}</p>
              <p className="tabular mt-1 text-[26px] leading-none font-semibold">{v ?? 0}</p>
              <p className="mt-1.5 text-[11px] text-gray-8">{h}</p>
            </Card>
          ))}
        </div>

        <PriorityEditor order={ds.json.priority_order} canEdit={user.role === "admin"} />

        <Card>
          <CardHeader
            title="Decisions"
            description={`${ds.json.booking_requests.length} requests · ${b?.priority_inversions.length ?? 0} priority inversions`}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead className="text-left text-[12px] text-gray-8">
                <tr className="border-b border-gray-4">
                  <th className="px-4 py-2 font-medium">Request</th>
                  <th className="px-2 py-2 font-medium">Priority</th>
                  <th className="px-2 py-2 font-medium">Decision</th>
                  <th className="px-2 py-2 font-medium">Slot</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-4">
                {ds.json.booking_requests.map((r) => {
                  const d = decisions.get(r.id);
                  const eff = effectiveCategory(ds.json, r);
                  const capped = eff !== r.requested_category;
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{r.title}</p>
                        <p className="tabular text-[11px] text-gray-8">
                          {r.id} · {r.requester} · {r.attendance} people
                        </p>
                      </td>
                      <td className="px-2 py-2.5 text-[12px]">
                        {eff.replaceAll("_", " ")}
                        {capped ? (
                          <p className="text-[11px] text-[color:var(--warn)]">
                            asked: {r.requested_category.replaceAll("_", " ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2.5">
                        <Badge tone={cancelled.has(r.id) ? "neutral" : statusTone(d?.status ?? "pending")}>
                          {cancelled.has(r.id)
                            ? "Cancelled"
                            : (STATUS_LABEL[d?.status ?? "pending"] ?? d?.status)}
                        </Badge>
                      </td>
                      <td className="tabular px-2 py-2.5 text-[12px] whitespace-nowrap">{slotText(d)}</td>
                      <td className="max-w-[460px] px-4 py-2.5 text-[12px] text-gray-9">{d?.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Venues during Spectra week"
            description="Approved events and alternatives on each day's timeline, coloured by priority. Classes run P1–P9."
          />
          <div className="p-4">
            <VenueTimeline items={items} venues={venues} />
          </div>
          {fest.session_overrides.length ? (
            <div className="border-t border-gray-4 px-4 py-3 text-[12px]">
              <p className="mb-1 font-medium">Classes moved for Week 7</p>
              {fest.session_overrides.map((o) => (
                <p key={o.session_id} className="tabular text-gray-9">
                  {o.session_id} → {o.day} P{o.start_period} · {o.room_id} (for {o.displaced_by})
                </p>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
