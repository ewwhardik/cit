import { NextResponse } from "next/server";
import { parseContext } from "@/server/ai/context";
import { parseBookingRequest } from "@/server/ai/parse";
import { guard, jsonError, readJson } from "@/server/api";
import { getActiveDataset } from "@/server/data";

/** Plain-language request -> editable draft (LLM with deterministic fallback). Never books anything. */
export async function POST(req: Request) {
  const user = await guard();
  if (user instanceof NextResponse) return user;
  const { text } = await readJson<{ text?: string }>(req);
  if (!text?.trim()) return jsonError("Type a request first.", 400);
  const ds = await getActiveDataset();
  if (!ds) return jsonError("No dataset is loaded yet.", 409);
  const result = await parseBookingRequest(text.trim(), parseContext(ds.json));
  return NextResponse.json(result);
}
