import { NextResponse } from "next/server";
import { type AgentId, agentChat } from "@/server/ai/agents";
import { guard, jsonError, readJson } from "@/server/api";
import { getActiveDataset, getCurrentVersion } from "@/server/data";

const AGENTS: AgentId[] = ["lumi", "vela", "orbit"];

/** Chat with a portal character. Read-only: answers and links, never changes data. */
export async function POST(req: Request) {
  const user = await guard();
  if (user instanceof NextResponse) return user;
  const body = await readJson<{ agent?: string; messages?: { role: string; content: string }[] }>(req);
  const agent = AGENTS.find((a) => a === body.agent);
  if (!agent) return jsonError("Unknown character", 400);
  const history = (body.messages ?? [])
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim(),
    )
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  if (!history.length || history.at(-1)?.role !== "user") return jsonError("Say something first.", 400);
  const ds = await getActiveDataset();
  if (!ds) return jsonError("No dataset is loaded yet.", 409);
  const version = await getCurrentVersion(ds.id);
  return NextResponse.json(
    await agentChat(agent, history, { user, ds: ds.json, schedule: version?.schedule ?? null }),
  );
}
