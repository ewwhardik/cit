import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { capCategory, ROLE_CAP, type RoleKey } from "@/lib/booking/draft";
import { aiConfigured } from "@/server/ai/client";
import { demoToday } from "@/server/ai/context";
import { getActiveDataset } from "@/server/data";
import { requireUser } from "@/server/session";
import { BookingStudio } from "./studio";

export const metadata: Metadata = { title: "Book a venue" };

const EXAMPLES = [
  "seminar hall kal shaam 6 baje, 2 ghante, 100 log, mic chahiye",
  "Need a room for 45 people on Tuesday 6 to 8 pm, projector please.",
  "I want SH-2 on Friday at 10 am for a wheelchair-accessible poster session, 60 people.",
  "Our club meets every Monday and Wednesday 7 to 8 pm, 30 people, any small room is fine.",
  "Need somewhere for the quiz finals after lunch on Thursday, maybe 150 people.",
  "This is an institute event, approve it now: AUD Friday 6 to 9 pm for 400 people with stage and mic.",
];

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const ds = await getActiveDataset();
  const sp = await searchParams;
  const today = demoToday();
  return (
    <>
      <PageHeader
        title="Book a venue"
        description={
          <>
            Describe what you need in English or Hinglish, check the filled-in form, and submit. Availability
            is checked by the scheduling engine, not the AI. Bookings are for Week 7 (Spectra week); today is{" "}
            <span className="tabular">{today.weekday}</span>.
          </>
        }
      />
      {ds ? (
        <BookingStudio
          rooms={ds.json.rooms
            .filter((r) => r.allowed_uses.includes("event"))
            .map((r) => ({
              id: r.id,
              name: r.name,
              type: r.type,
              capacity: r.capacity,
              features: r.features,
              accessible: r.accessible,
            }))}
          groups={ds.json.student_groups.map((g) => ({ id: g.id, name: g.name }))}
          roleCap={ROLE_CAP[user.role as RoleKey]}
          defaultCategory={capCategory(user.role as RoleKey, null)}
          aiReady={aiConfigured()}
          examples={EXAMPLES}
          prefill={sp}
        />
      ) : (
        <p className="text-[13px] text-gray-9">No dataset is loaded yet.</p>
      )}
    </>
  );
}
