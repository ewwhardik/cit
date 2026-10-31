import { NextResponse } from "next/server";
import { engineFailure, guard, readJson } from "@/server/api";
import { decideBooking } from "@/server/bookings";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await guard("admin", "dept_coordinator");
  if (user instanceof NextResponse) return user;
  const { action, note } = await readJson<{ action?: string; note?: string }>(req);
  try {
    return NextResponse.json(await decideBooking(user, (await ctx.params).id, action === "reject" ? "reject" : "approve", note ?? ""));
  } catch (err) {
    return engineFailure(err);
  }
}
