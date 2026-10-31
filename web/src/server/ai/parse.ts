import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type BookingDraft, emptyDraft } from "@/lib/booking/draft";
import {
  normalizeDraft,
  type ParseContext,
  parseBookingText,
  parseBookingTextDetailed,
} from "@/lib/booking/parser";
import { AI, aiConfigured, aiFailureReason, anthropic } from "./client";
import { demoToday } from "./context";
import { groqChat, strictSchema } from "./groq";
import { LlmDraft, parseSystemPrompt } from "./prompts/parse";

async function llmDraft(text: string, ctx: ParseContext): Promise<z.infer<typeof LlmDraft> | null> {
  const system = parseSystemPrompt(ctx, demoToday());
  const user = `<request>\n${text.slice(0, 2000)}\n</request>`;
  if (AI.provider === "groq") {
    const res = await groqChat(
      {
        model: AI.parseModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "booking_draft",
            strict: true,
            schema: strictSchema(z.toJSONSchema(LlmDraft)),
          },
        },
        reasoning_effort: "low",
        max_completion_tokens: 4000,
      },
      Math.max(AI.timeoutMs, 8000),
    );
    const content = res.choices[0]?.message.content;
    if (!content) return null;
    const parsed = LlmDraft.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  }
  const response = await anthropic().messages.parse(
    {
      model: AI.parseModel,
      max_tokens: 4000,
      system,
      output_config: { format: zodOutputFormat(LlmDraft), effort: "low" },
      messages: [{ role: "user", content: user }],
    },
    { timeout: AI.timeoutMs, maxRetries: 1 },
  );
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}

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
    const output = await llmDraft(text, ctx);
    if (!output) {
      return {
        draft: fallback(),
        source: "fallback",
        notice: "AI could not read this request; filled with the basic parser. Please check the fields.",
        model: null,
      };
    }
    const llm: BookingDraft = { ...emptyDraft(), ...output };
    // Fill anything the model left empty from the deterministic parser.
    // Code, not the model, maps explicit clock times to periods.
    const { draft: basic, explicitTime } = parseBookingTextDetailed(text, ctx);
    const key = (ws: BookingDraft["windows"]) =>
      ws
        .map((w) => `${w.day}${w.from_period}-${w.to_period}`)
        .sort()
        .join(",");
    if (explicitTime && basic.windows.length && key(basic.windows) !== key(llm.windows)) {
      llm.windows = basic.windows;
      if (basic.duration_periods) llm.duration_periods = basic.duration_periods;
      llm.assumptions.push("Times were mapped to periods by the deterministic parser.");
    }
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
