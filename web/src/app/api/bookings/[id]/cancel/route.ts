import { NextResponse } from "next/server";
import { engineFailure, guard } from "@/server/api";
import { cancelBooking } from "@/server/bookings";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await guard();
  if (user instanceof NextResponse) return user;
  try {
    await cancelBooking(user, (await ctx.params).id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return engineFailure(err);
  }
}
