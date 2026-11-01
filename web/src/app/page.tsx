import type { Metadata } from "next";
import { landingFonts } from "@/components/landing/fonts";
import { Landing, type LandingData } from "@/components/landing/landing";
import { DEMO_ACCOUNTS, DEMO_PASSWORD_DEFAULT } from "@/lib/demo";
import { parseContext } from "@/server/ai/context";
import { getActiveDataset, getCurrentVersion } from "@/server/data";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: { absolute: "CIT Scheduler · Week 7, solved" } };
export const dynamic = "force-dynamic";

/**
 * Public landing page. Everything it shows comes from the live database: the
 * 3D skyline is the current timetable (or the unplaced sessions before the
 * first Generate), and the numbers are the engine's own report.
 */
export default async function Home() {
  // Session and dataset are independent round trips, so start both at once.
  const datasetRead = getActiveDataset().catch(() => null);
  const user = await getCurrentUser().catch(() => null);
  let data: LandingData = {
    signedIn: Boolean(user),
    userName: user?.name ?? null,
    accounts: DEMO_ACCOUNTS.map((a) => ({ ...a })),
    demoPassword: process.env.DEMO_PASSWORD ?? DEMO_PASSWORD_DEFAULT,
    counts: null,
    report: null,
    blocks: [],
    solved: false,
    parseCtx: null,
  };

  try {
    const ds = await datasetRead;
    if (ds) {
      const json = ds.json;
      const version = await getCurrentVersion(ds.id);
      const byId = new Map(json.sessions.map((s) => [s.id, s]));
      const placed = version?.schedule.sessions ?? [];
      data = {
        ...data,
        counts: {
          sessions: json.sessions.length,
          rooms: json.rooms.length,
          faculty: json.faculty.length,
          groups: json.student_groups.length,
          requests: json.booking_requests.length,
          exams: json.exams.length,
        },
        report: version
          ? {
              hard: version.report.hard_violation_count,
              soft: version.report.soft_total,
              bookingScore: version.report.bookings?.booking_score ?? null,
              bookingMax: version.report.bookings?.booking_score_max_if_all_approved ?? null,
            }
          : null,
        solved: placed.length > 0,
        blocks:
          placed.length > 0
            ? placed.flatMap((p) => {
                const s = byId.get(p.session_id);
                const day = DAY_INDEX[p.day];
                if (!s || day === undefined) return [];
                return [
                  {
                    id: s.id,
                    course: s.course_id,
                    kind: s.kind,
                    day,
                    start: p.start_period,
                    dur: s.duration,
                    room: p.room_id,
                  },
                ];
              })
            : json.sessions.map((s) => ({
                id: s.id,
                course: s.course_id,
                kind: s.kind,
                day: -1,
                start: -1,
                dur: s.duration,
                room: "",
              })),
        parseCtx: parseContext(json),
      };
    }
  } catch {
    // No database yet (fresh deploy): the page still renders, with the 3D scene in its idle state.
  }

  return <Landing data={data} fontClass={landingFonts} />;
}

const DAY_INDEX: Record<string, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4 };
