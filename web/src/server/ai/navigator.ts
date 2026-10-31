import "server-only";
import { fallbackNavigator, type NavAction, type NavReply } from "@/lib/navigator-fallback";
import { type Page, pagesFor, ROLE_LABEL } from "@/lib/sitemap";
import type { Role } from "@/server/db/schema";
import { env } from "@/server/env";
import { AI, aiConfigured, anthropic } from "./client";
import { groqChat } from "./groq";
import { navigatorSystem } from "./prompts/navigator";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const TOOLS = (hrefs: string[]) => [
  {
    name: "go_to_page",
    description: "Open one page of the app for the user.",
    parameters: {
      type: "object",
      properties: { href: { type: "string", enum: hrefs, description: "Page path from the allowed list" } },
      required: ["href"],
      additionalProperties: false,
    },
  },
  {
    name: "start_tour",
    description: "Start the step-by-step guided tour of the app.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

/** Turn a tool call into an action, accepting only pages this role may open. */
function toAction(name: string, args: unknown, pages: Page[]): NavAction {
  if (name === "start_tour") return { type: "tour" };
  if (name === "go_to_page") {
    const href = (args as { href?: unknown } | null)?.href;
    const page = pages.find((p) => p.href === href);
    if (page) return { type: "navigate", href: page.href, label: page.label };
  }
  return null;
}

function reply(text: string | null | undefined, action: NavAction, pages: Page[]): NavReply {
  let msg = (text ?? "").trim();
  if (!msg && action?.type === "navigate") {
    const p = pages.find((x) => x.href === action.href);
    msg = p ? `Opening ${p.label}. ${p.task}` : "Opening it now.";
  }
  if (!msg && action?.type === "tour") msg = "Starting the guided tour.";
  return { reply: msg.slice(0, 600) || "How can I help?", action, source: "ai" };
}

/**
 * Iru, the navigator: an LLM with exactly two tools (open a page, start the
 * tour). It never touches data; the client only ever navigates to a page from
 * the role's site map. Falls back to keyword matching when AI is unavailable.
 */
export async function runNavigator(
  role: Role,
  text: string,
  history: ChatTurn[],
  path: string,
): Promise<NavReply> {
  const pages = pagesFor(role);
  if (!aiConfigured()) return fallbackNavigator(text, pages);
  const system = navigatorSystem(pages, ROLE_LABEL[role], path);
  const turns = [...history.slice(-6), { role: "user" as const, content: `<message>${text}</message>` }];
  const hrefs = pages.map((p) => p.href);
  const model = env().NAVIGATOR_MODEL || AI.parseModel;

  if (AI.provider === "groq") {
    const res = await groqChat(
      {
        model,
        temperature: 0.2,
        max_completion_tokens: 300,
        messages: [{ role: "system", content: system }, ...turns],
        tools: TOOLS(hrefs).map((t) => ({ type: "function", function: t })),
        tool_choice: "auto",
      },
      AI.timeoutMs,
    );
    const msg = res.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    let action: NavAction = null;
    if (call) {
      try {
        action = toAction(call.function.name, JSON.parse(call.function.arguments || "{}"), pages);
      } catch {
        action = null;
      }
    }
    return reply(msg?.content, action, pages);
  }

  const res = await anthropic().messages.create(
    {
      model,
      max_tokens: 300,
      system,
      messages: turns,
      tools: TOOLS(hrefs).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as never,
      })),
    },
    { timeout: AI.timeoutMs },
  );
  let text_ = "";
  let action: NavAction = null;
  for (const block of res.content) {
    if (block.type === "text") text_ += block.text;
    if (block.type === "tool_use" && !action) action = toAction(block.name, block.input, pages);
  }
  return reply(text_, action, pages);
}
