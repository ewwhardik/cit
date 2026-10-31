import "server-only";

/**
 * Minimal Groq client (OpenAI-compatible Chat Completions over fetch).
 * Used when AI_PROVIDER=groq. One retry on rate limits / 5xx / network errors.
 */
export class GroqError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export type GroqMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: GroqToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type GroqToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type GroqResponse = {
  choices: { message: { content: string | null; tool_calls?: GroqToolCall[] }; finish_reason: string }[];
};

const URL = "https://api.groq.com/openai/v1/chat/completions";

export async function groqChat(body: Record<string, unknown>, timeoutMs: number): Promise<GroqResponse> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new GroqError("GROQ_API_KEY is not set", null);
  let last: GroqError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as GroqResponse;
      const text = await res.text().catch(() => "");
      last = new GroqError(`Groq ${res.status}: ${text.slice(0, 200)}`, res.status);
      if (res.status !== 429 && res.status < 500) throw last;
      // Honour a short retry-after (free tiers rate-limit bursts); otherwise fail fast to the fallback.
      const wait = Number(res.headers.get("retry-after") ?? "1");
      if (attempt === 0 && wait <= 3) await new Promise((r) => setTimeout(r, Math.max(300, wait * 1000)));
      else throw last;
    } catch (err) {
      if (err instanceof GroqError && err.status && err.status !== 429 && err.status < 500) throw err;
      last =
        err instanceof GroqError
          ? err
          : new GroqError(
              (err as Error).name === "TimeoutError" ? "Groq timed out" : "Groq unreachable",
              null,
            );
    }
  }
  throw last ?? new GroqError("Groq unavailable", null);
}

/** Make a JSON Schema acceptable to strict structured outputs (closed objects, every property required). */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "$schema") continue;
    out[k] = strictSchema(v);
  }
  if (out.type === "object" && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}
