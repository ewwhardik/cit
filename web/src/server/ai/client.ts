import "server-only";
import { GroqError } from "./groq";

/**
 * The AI layer runs on Groq only. Models and timeouts come from the environment
 * (see .env.example): a fast model for small tasks (parsing, explanation wording,
 * quick character replies) and a larger one for multi-step tool use.
 */
export const AI = {
  get smallModel() {
    return process.env.GROQ_PARSE_MODEL ?? "openai/gpt-oss-20b";
  },
  get largeModel() {
    return process.env.GROQ_ASSIST_MODEL ?? "openai/gpt-oss-120b";
  },
  timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 6000),
};

/** True when a Groq key is configured. Without one, every AI feature uses its deterministic fallback. */
export function aiConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

/** Short, user-facing reason for a failed AI call (never leaks request content). */
export function aiFailureReason(err: unknown): string {
  if (err instanceof GroqError) {
    if (err.status === 401) return "AI key rejected";
    if (err.status === 429) return "AI rate-limited";
    return err.status ? `AI error ${err.status}` : err.message;
  }
  return "AI unavailable";
}
