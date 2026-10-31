import { BookOpenCheck, Building2, Clock4, Layers3, Sunrise, Sunset, UserCheck, Waves } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { weekNumbers } from "@/lib/insights";

type Numbers = ReturnType<typeof weekNumbers>;

/** A compact bento of the week's numbers; every figure is derived from the checked schedule. */
export function WeekNumbers({ n, approvalRate }: { n: Numbers; approvalRate: number | null }) {
  const items = [
    {
      icon: Layers3,
      label: "Sessions placed",
      value: `${n.sessions.placed}/${n.sessions.total}`,
      hint: `${n.hours} teaching hours`,
    },
    {
      icon: Building2,
      label: "Room occupancy",
      value: `${Math.round(n.occupancy * 100)}%`,
      hint: "Teaching rooms, P1–P9",
    },
    {
      icon: UserCheck,
      label: "Within daily limit",
      value: `${n.facultyWithinLimit}/${n.facultyTotal}`,
      hint: "Faculty at ≤ 4 h a day",
    },
    { icon: Waves, label: "Idle gaps", value: String(n.idleGaps), hint: "Free periods between classes" },
    {
      icon: BookOpenCheck,
      label: "Midsem seat fill",
      value: `${Math.round(n.exams.fill * 100)}%`,
      hint: `${n.exams.count} exams in ${n.exams.slots} slots`,
    },
    {
      icon: Clock4,
      label: "Labs & baskets",
      value: `${n.labs} · ${n.baskets}`,
      hint: "3-h labs · aligned elective slots",
    },
    { icon: Sunrise, label: "8 AM starts", value: String(n.early), hint: "Sessions in P1" },
    {
      icon: Sunset,
      label: approvalRate === null ? "5 PM classes" : "Spectra approved",
      value: approvalRate === null ? String(n.late) : `${Math.round(approvalRate * 100)}%`,
      hint: approvalRate === null ? "Sessions ending at 18:00" : `${n.late} classes end at 18:00`,
    },
  ];
  return (
    <Card className="min-w-0 p-1.5">
      <ul className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
        {items.map(({ icon: Icon, label, value, hint }) => (
          <li key={label} className="stat-cell rounded-[12px] p-3">
            <span className="flex items-center gap-1.5 text-[11px] text-gray-8">
              <Icon className="size-3.5 text-accent" strokeWidth={2} />
              {label}
            </span>
            <span className="mt-1 block font-display text-[22px] leading-none font-bold tracking-[-0.03em]">
              {value}
            </span>
            <span className="mt-1 block truncate text-[11px] text-gray-8">{hint}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
