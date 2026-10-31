import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { Report } from "@/lib/schemas/schedule";

const SOFT_LABEL: Record<string, string> = {
  S1: "Faculty avoided slots",
  S2: "Idle gaps for groups",
  S3: "Groups over 6 h/day",
  S4: "Same course twice a day",
  S5: "Room under 40% full",
  S6: "Classes at 17:00",
};

/** Validator-equivalent report: hard violations by rule and the soft breakdown. */
export function ReportCard({ report, title = "Validation report" }: { report: Report; title?: string }) {
  const hard = report.hard_violation_count;
  return (
    <Card>
      <CardHeader
        title={title}
        description="Computed by the deterministic checker (mirrors the official validator)."
        action={
          <Badge tone={hard === 0 ? "ok" : "bad"}>
            {hard === 0 ? "0 hard violations" : `${hard} hard violations`}
          </Badge>
        }
      />
      <div className="grid gap-5 p-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-[12px] font-medium text-gray-9">
            Soft penalty <span className="tabular text-gray-10">{report.soft_total}</span>
          </p>
          <ul className="grid gap-1.5">
            {Object.entries(report.soft_penalties).map(([k, v]) => (
              <li key={k} className="flex items-center gap-2 text-[13px]">
                <span className="tabular w-6 text-[11px] text-gray-8">{k}</span>
                <span className="flex-1 text-gray-9">{SOFT_LABEL[k] ?? k}</span>
                <span className={`tabular ${v ? "text-gray-10" : "text-gray-7"}`}>{v}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid content-start gap-3 text-[13px]">
          {report.bookings ? (
            <div>
              <p className="mb-1 text-[12px] font-medium text-gray-9">Spectra bookings</p>
              <p>
                Score <span className="tabular font-medium">{report.bookings.booking_score}</span>
                <span className="text-gray-8"> / {report.bookings.booking_score_max_if_all_approved}</span> ·{" "}
                <span className="tabular">{report.bookings.approved}</span> approved ·{" "}
                <span className="tabular">{report.bookings.alternatives}</span> alternatives ·{" "}
                <span className="tabular">{report.bookings.rejected}</span> rejected
              </p>
              <p className="text-gray-9">
                Priority inversions:{" "}
                <span className="tabular">{report.bookings.priority_inversions.length}</span>
              </p>
            </div>
          ) : null}
          {report.exam_soft_penalty !== undefined ? (
            <div>
              <p className="mb-1 text-[12px] font-medium text-gray-9">Midsem exams</p>
              <p>
                Same-day penalty <span className="tabular font-medium">{report.exam_soft_penalty}</span>
              </p>
            </div>
          ) : null}
          {report.stability ? (
            <div>
              <p className="mb-1 text-[12px] font-medium text-gray-9">Stability</p>
              <p>
                <span className="tabular">{report.stability.sessions_moved}</span> moved (
                <span className="tabular">{report.stability.time_changed}</span> time,{" "}
                <span className="tabular">{report.stability.room_only_changed}</span> room only)
              </p>
            </div>
          ) : null}
        </div>
      </div>
      {hard > 0 ? (
        <ul className="max-h-64 overflow-y-auto border-t border-gray-4 px-4 py-3 text-[12px]">
          {report.hard_violations.slice(0, 50).map((v, i) => (
            <li key={i} className="flex gap-2 py-0.5">
              <Badge tone="bad">{v.rule}</Badge>
              <span className="text-gray-9">{v.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
