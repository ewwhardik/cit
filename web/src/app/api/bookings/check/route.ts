import { NextResponse } from "next/server";
import { BookingSubmission } from "@/lib/booking/draft";
import { engineFailure, guard, jsonError, readJson } from "@/server/api";
import { checkRequest, expandSeries, toRequest } from "@/server/bookings";

/** Live availability check for the form (no data is written). */
export async function POST(req: Request) {
  const user = await guard();
  if (user instanceof NextResponse) return user;
  const parsed = BookingSubmission.safeParse(await readJson(req));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return jsonError(`Incomplete form: ${i?.path.join(".") || "field"} ${i?.message ?? ""}`.trim(), 422);
  }
  try {
    const parts = expandSeries(parsed.data);
    const outcomes = [];
    for (const [i, part] of parts.entries()) {
      outcomes.push({ part: i, windows: part.windows, ...(await checkRequest(toRequest(user, part, `PREVIEW-${i}`, new Date().toISOString()))) });
    }
    return NextResponse.json({ outcomes, category: toRequest(user, parsed.data, "X", "").requested_category });
  } catch (err) {
    return engineFailure(err);
  }
}
