import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type BookingDraft, emptyDraft } from "@/lib/booking/draft";
import { normalizeDraft, type ParseContext, parseBookingText } from "@/lib/booking/parser";
import { AI, aiConfigured, aiFailureReason, anthropic } from "./client";
import { demoToday } from "./context";
import { LlmDraft, parseSystemPrompt } from "./prompts/parse";

export type ParseResult = {
  draft: BookingDraft;
  source: "llm" | "fallback";
  /** Why the fallback was used (shown as a banner). */
  notice: string | null;
  model: string | null;
};

/**
 * Plain-language request -> editable draft.
 * LLM first (structured output, short timeout, one retry); on any failure the
 * deterministic parser. Either way the draft goes through `normalizeDraft`.
 */
export async function parseBookingRequest(text: string, ctx: ParseContext): Promise<ParseResult> {
  const fallback = () => normalizeDraft(parseBookingText(text, ctx), ctx);
  if (!aiConfigured()) {
    return {
      draft: fallback(),
      source: "fallback",
      notice: "AI is not configured; filled with the basic parser. Please check the fields.",
      model: null,
    };
  }
  try {
    const response = await anthropic().messages.parse(
      {
        model: AI.parseModel,
        max_tokens: 4000,
        system: parseSystemPrompt(ctx, demoToday()),
        output_config: { format: zodOutputFormat(LlmDraft), effort: "low" },
        messages: [{ role: "user", content: `<request>\n${text.slice(0, 2000)}\n</request>` }],
      },
      { timeout: AI.timeoutMs, maxRetries: 1 },
    );
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return {
        draft: fallback(),
        source: "fallback",
        notice: "AI could not read this request; filled with the basic parser. Please check the fields.",
        model: null,
      };
    }
    const llm: BookingDraft = { ...emptyDraft(), ...response.parsed_output };
    // Fill anything the model left empty from the deterministic parser.
    const basic = parseBookingText(text, ctx);
    if (llm.attendance === null && basic.attendance !== null) llm.attendance = basic.attendance;
    if (!llm.windows.length && basic.windows.length) llm.windows = basic.windows;
    if (llm.duration_periods === null && basic.duration_periods !== null)
      llm.duration_periods = basic.duration_periods;
    return { draft: normalizeDraft(llm, ctx), source: "llm", notice: null, model: AI.parseModel };
  } catch (err) {
    return {
      draft: fallback(),
      source: "fallback",
      notice: `${aiFailureReason(err)}; filled with the basic parser. Please check the fields.`,
      model: null,
    };
  }
}
