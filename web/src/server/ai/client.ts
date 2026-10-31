import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** Models and timeouts come from the environment (see .env.example). */
export const AI = {
  parseModel: process.env.AI_PARSE_MODEL ?? "claude-haiku-5-5",
  assistModel: process.env.AI_ASSIST_MODEL ?? "claude-sonnet-5-5",
  timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 6000),
};

let client: Anthropic | null = null;

/** True when an API credential is configured. Without one, every AI feature uses its deterministic fallback. */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function anthropic(): Anthropic {
  client ??= new Anthropic({ maxRetries: 1 });
  return client;
}

/** Short, user-facing reason for a failed AI call (never leaks request content). */
export function aiFailureReason(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "AI key rejected";
  if (err instanceof Anthropic.RateLimitError) return "AI rate-limited";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "AI timed out";
  if (err instanceof Anthropic.APIConnectionError) return "AI unreachable";
  if (err instanceof Anthropic.APIError) return `AI error ${err.status ?? ""}`.trim();
  return "AI unavailable";
}
