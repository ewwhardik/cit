import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { GroqError } from "./groq";

export type AiProvider = "anthropic" | "groq";

/** Provider: AI_PROVIDER, else whichever key is set (Anthropic first). */
function provider(): AiProvider {
  const p = process.env.AI_PROVIDER;
  if (p === "groq" || p === "anthropic") return p;
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "anthropic" : "groq";
}

/** Models and timeouts come from the environment (see .env.example). */
export const AI = {
  get provider(): AiProvider {
    return provider();
  },
  get parseModel() {
    return provider() === "groq"
      ? (process.env.GROQ_PARSE_MODEL ?? "openai/gpt-oss-20b")
      : (process.env.AI_PARSE_MODEL ?? "claude-haiku-5-5");
  },
  get assistModel() {
    return provider() === "groq"
      ? (process.env.GROQ_ASSIST_MODEL ?? "openai/gpt-oss-120b")
      : (process.env.AI_ASSIST_MODEL ?? "claude-sonnet-5-5");
  },
  timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 6000),
};

let client: Anthropic | null = null;

/** True when an API credential is configured. Without one, every AI feature uses its deterministic fallback. */
export function aiConfigured(): boolean {
  if (provider() === "groq") return Boolean(process.env.GROQ_API_KEY);
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function anthropic(): Anthropic {
  client ??= new Anthropic({ maxRetries: 1 });
  return client;
}

/** Short, user-facing reason for a failed AI call (never leaks request content). */
export function aiFailureReason(err: unknown): string {
  if (err instanceof GroqError) {
    if (err.status === 401) return "AI key rejected";
    if (err.status === 429) return "AI rate-limited";
    return err.status ? `AI error ${err.status}` : err.message;
  }
  if (err instanceof Anthropic.AuthenticationError) return "AI key rejected";
  if (err instanceof Anthropic.RateLimitError) return "AI rate-limited";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "AI timed out";
  if (err instanceof Anthropic.APIConnectionError) return "AI unreachable";
  if (err instanceof Anthropic.APIError) return `AI error ${err.status ?? ""}`.trim();
  return "AI unavailable";
}
