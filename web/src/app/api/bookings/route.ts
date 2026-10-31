import { NextResponse } from "next/server";
import { BookingSubmission } from "@/lib/booking/draft";
import { engineFailure, guard, jsonError, readJson } from "@/server/api";
import { submitBooking } from "@/server/bookings";

export async function POST(req: Request) {
  const user = await guard();
  if (user instanceof NextResponse) return user;
  const body = await readJson<Record<string, unknown>>(req);
  const parsed = BookingSubmission.safeParse(body.submission);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return jsonError(`Incomplete form: ${i?.path.join(".") || "field"} ${i?.message ?? ""}`.trim(), 422);
  }
  try {
    return NextResponse.json(await submitBooking(user, parsed.data, body.accept_alternative === true));
  } catch (err) {
    return engineFailure(err);
  }
}
