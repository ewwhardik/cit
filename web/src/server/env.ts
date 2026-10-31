import "server-only";
import { z } from "zod";

/**
 * Typed, validated server configuration. Parsed once on first use (not at
 * import, so `next build` works without secrets). Every variable is listed in
 * .env.example; optional features switch themselves off when theirs are empty.
 */
const Schema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://cit:cit@localhost:5432/cit"),
  ENGINE_URL: z.string().url().default("http://localhost:8000"),
  ENGINE_SHARED_SECRET: z.string().default(""),
  GITHUB_RELAY_TOKEN: z.string().default(""),
  GITHUB_RELAY_REPO: z
    .string()
    .regex(/^$|^[\w.-]+\/[\w.-]+$/, "owner/repo")
    .default(""),
  GITHUB_RELAY_WORKFLOW: z.string().default("engine-relay.yml"),
  GITHUB_RELAY_REF: z.string().default("main"),
  AI_PROVIDER: z.enum(["groq", "anthropic", ""]).default(""),
  GROQ_API_KEY: z.string().default(""),
  NAVIGATOR_MODEL: z.string().default(""),
  NAVIGATOR_RATE_PER_MIN: z.coerce.number().int().positive().default(12),
  DEMO_TODAY: z.string().default(""),
});

export type ServerEnv = z.infer<typeof Schema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Feature switches derived from configuration. */
export const features = {
  relay: () => Boolean(env().GITHUB_RELAY_TOKEN && env().GITHUB_RELAY_REPO),
  engineAuth: () => Boolean(env().ENGINE_SHARED_SECRET),
};
