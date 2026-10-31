import type { BookingDecision } from "@/lib/schemas/schedule";
import { periodRange } from "@/lib/time";

export function slotText(d: Partial<BookingDecision> | null | undefined): string {
  if (!d?.room_id || !d.day || !d.start_period || !d.end_period) return "—";
  return `${d.room_id} · ${d.day} P${d.start_period}${d.end_period !== d.start_period ? `–P${d.end_period}` : ""} · ${periodRange(d.start_period, d.end_period)}`;
}

export function timeAgo(date: Date): string {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return date.toISOString().slice(0, 10);
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  alternative_offered: "Alternative",
  cancelled: "Cancelled",
};

/** Name for a greeting: skips titles, keeps office names whole ("Dean's Office", "Dr. Pooja Das" → "Pooja"). */
export function friendlyName(name: string): string {
  if (/office|department|club|society|cell/i.test(name)) return name;
  const words = name.split(/\s+/).filter((w) => !/^(dr|prof|mr|mrs|ms|shri|smt)\.?$/i.test(w));
  return words[0] ?? name;
}
