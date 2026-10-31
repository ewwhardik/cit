import "server-only";
import type { ExplainTrace } from "../engine";
import { AI, aiConfigured, anthropic } from "./client";

const SYSTEM = `You rewrite a scheduling explanation for a student or teacher in two or three plain sentences.
Use only the facts given. Do not add reasons, numbers, rooms, times or advice that are not in the facts. Keep session ids, course codes, room ids and period labels exactly as written. No preamble.`;

/** Optional Haiku rephrasing of the engine's deterministic summary. Falls back to the summary itself. */
export async function rephraseExplanation(trace: ExplainTrace): Promise<{ text: string; source: "llm" | "engine" }> {
  if (!aiConfigured() || !trace.summary) return { text: trace.summary, source: "engine" };
  try {
    const facts = JSON.stringify({
      summary: trace.summary,
      current: trace.current,
      blocked_by: trace.blocked_by,
      free_start_times: trace.free_start_times,
      best_options: trace.options.slice(0, 3),
    });
    const res = await anthropic().messages.create(
      {
        model: AI.parseModel,
        max_tokens: 1000,
        system: SYSTEM,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: `<facts>${facts}</facts>` }],
      },
      { timeout: AI.timeoutMs, maxRetries: 0 },
    );
    if (res.stop_reason === "refusal") return { text: trace.summary, source: "engine" };
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join(" ")
      .trim();
    return text ? { text, source: "llm" } : { text: trace.summary, source: "engine" };
  } catch {
    return { text: trace.summary, source: "engine" };
  }
}
