import { NextResponse } from "next/server";
import { engineFailure, guard, readJson } from "@/server/api";
import { approveProposal, rejectProposal } from "@/server/proposals";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await guard("admin");
  if (user instanceof NextResponse) return user;
  const id = Number((await ctx.params).id);
  const { action, reason } = await readJson<{ action?: string; reason?: string }>(req);
  try {
    if (action === "reject") {
      await rejectProposal(id, user, reason ?? "");
      return NextResponse.json({ status: "rejected" });
    }
    const versionId = await approveProposal(id, user);
    return NextResponse.json({ status: "approved", versionId });
  } catch (err) {
    return engineFailure(err);
  }
}
