import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Dataset } from "@/lib/schemas/dataset";
import type { Schedule } from "@/lib/schemas/schedule";
import { engine } from "../engine";
import type { CurrentUser } from "../session";
import { AI, aiConfigured, aiFailureReason, anthropic } from "./client";
import { demoToday } from "./context";
import { type GroqMessage, groqChat } from "./groq";
import { ASSISTANT_TOOLS, assistantSystemPrompt } from "./prompts/assistant";

const Day = z.enum(["MON", "TUE", "WED", "THU", "FRI"]);
export const ChangeOp = z.object({
  op: z.enum(["mark_unavailable", "move_session", "add_session", "remove_session"]),
  faculty_id: z.string().optional(),
  session_id: z.string().optional(),
  like_session_id: z.string().optional(),
  days: z.array(Day).optional(),
  periods: z.array(z.number().int().min(1).max(9)).optional(),
  starts: z.array(z.number().int().min(1).max(9)).optional(),
  rooms: z.array(z.string()).optional(),
  reason: z.string().max(200).optional(),
});
export type ChangeOp = z.infer<typeof ChangeOp>;

export type AssistantResult = {
  reply: string;
  summary: string;
  ops: ChangeOp[];
  source: "llm" | "fallback";
  notice: string | null;
  steps: string[];
};

type Ctx = { user: CurrentUser; ds: Dataset; schedule: Schedule };

/** Which sessions/faculty the user may touch: faculty -> own; coordinator -> department; admin -> all. */
export function scopeCheck(ctx: Ctx, ops: ChangeOp[]): string | null {
  const { user, ds } = ctx;
  if (user.role === "admin") return null;
  const sessions = new Map(ds.sessions.map((s) => [s.id, s]));
  const facultyDept = new Map(ds.faculty.map((f) => [f.id, f.department]));
  const ownsFaculty = (fid?: string) =>
    !!fid &&
    (user.role === "faculty"
      ? fid === user.facultyId
      : user.role === "dept_coordinator" && facultyDept.get(fid) === user.department);
  for (const op of ops) {
    const sid = op.session_id ?? op.like_session_id;
    if (sid) {
      const s = sessions.get(sid);
      if (!s) return `Unknown session ${sid}.`;
      if (!ownsFaculty(s.faculty_id))
        return `${sid} is not one of your ${user.role === "faculty" ? "" : "department's "}sessions.`;
    }
    if (op.op === "mark_unavailable" && !ownsFaculty(op.faculty_id)) {
      return user.role === "faculty"
        ? "You can only mark your own unavailability."
        : `${op.faculty_id} is not in your department.`;
    }
  }
  return null;
}

function timetableFor(ctx: Ctx, facultyId: string) {
  const sessions = new Map(ctx.ds.sessions.map((s) => [s.id, s]));
  return ctx.schedule.sessions
    .filter((p) => sessions.get(p.session_id)?.faculty_id === facultyId)
    .map((p) => {
      const s = sessions.get(p.session_id)!;
      return {
        session_id: s.id,
        course: s.course_id,
        kind: s.kind,
        groups: s.groups,
        day: p.day,
        start_period: p.start_period,
        duration: s.duration,
        room: p.room_id,
      };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.start_period - b.start_period);
}

async function runTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<string> {
  if (name === "get_timetable") {
    const fid = (input.faculty_id as string | undefined) ?? ctx.user.facultyId;
    if (!fid) return JSON.stringify({ error: "No faculty id given and the user is not a faculty member." });
    return JSON.stringify({ faculty_id: fid, sessions: timetableFor(ctx, fid) });
  }
  if (name === "find_slots") {
    const sid = String(input.session_id ?? "");
    if (!ctx.ds.sessions.some((s) => s.id === sid))
      return JSON.stringify({ error: `Unknown session ${sid}` });
    const trace = (await engine.explain({
      dataset: ctx.ds,
      schedule: ctx.schedule,
      session_id: sid,
    })) as Record<string, any>;
    const days = (input.days as string[] | undefined) ?? null;
    const options = (trace.options as any[]).filter((o) => !days || days.includes(o.day)).slice(0, 6);
    return JSON.stringify({
      summary: trace.summary,
      blocked_by: trace.blocked_by,
      options,
      free_start_times: trace.free_start_times,
    });
  }
  return JSON.stringify({ error: `Unknown tool ${name}` });
}

/** LLM tool loop (Sonnet) with a deterministic fallback. Returns proposed ops only - never applies anything. */
export async function runAssistant(ctx: Ctx, text: string): Promise<AssistantResult> {
  if (!aiConfigured())
    return {
      ...fallbackAssistant(ctx, text),
      notice: "AI is not configured; used the basic request parser.",
    };
  if (AI.provider === "groq") return runGroqAssistant(ctx, text);
  const steps: string[] = [];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: text.slice(0, 2000) }];
  const system = assistantSystemPrompt({
    userName: ctx.user.name,
    role: ctx.user.role,
    facultyId: ctx.user.facultyId,
    department: ctx.user.department,
    today: demoToday().weekday,
  });
  try {
    for (let turn = 0; turn < 6; turn++) {
      const response = await anthropic().beta.messages.create(
        {
          model: AI.assistModel,
          max_tokens: 8000,
          system,
          tools: ASSISTANT_TOOLS,
          output_config: { effort: "medium" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          messages,
        },
        { timeout: Math.max(AI.timeoutMs * 4, 25_000), maxRetries: 1 },
      );
      if (response.stop_reason === "refusal") {
        return {
          ...fallbackAssistant(ctx, text),
          notice: "The AI declined this request; used the basic request parser.",
        };
      }
      const toolUses = response.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );
      const textOut = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      const propose = toolUses.find((t) => t.name === "propose_change");
      if (propose) {
        const input = propose.input as { summary?: string; ops?: unknown[] };
        const parsed = z.array(ChangeOp).safeParse(input.ops ?? []);
        if (!parsed.success)
          return {
            ...fallbackAssistant(ctx, text),
            notice: "The AI's proposal was malformed; used the basic request parser.",
          };
        steps.push("propose_change");
        return {
          reply: textOut || input.summary || "",
          summary: input.summary ?? "",
          ops: parsed.data,
          source: "llm",
          notice: null,
          steps,
        };
      }
      if (response.stop_reason !== "tool_use" || !toolUses.length) {
        // The model answered without proposing (e.g. explained why it is impossible).
        return { reply: textOut, summary: "", ops: [], source: "llm", notice: null, steps };
      }
      messages.push({ role: "assistant", content: response.content as Anthropic.MessageParam["content"] });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const t of toolUses) {
        steps.push(t.name);
        try {
          results.push({
            type: "tool_result",
            tool_use_id: t.id,
            content: await runTool(ctx, t.name, t.input as Record<string, unknown>),
          });
        } catch (err) {
          results.push({
            type: "tool_result",
            tool_use_id: t.id,
            content: `Tool failed: ${(err as Error).message}`,
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: results });
    }
    return {
      ...fallbackAssistant(ctx, text),
      notice: "The AI took too many steps; used the basic request parser.",
    };
  } catch (err) {
    return {
      ...fallbackAssistant(ctx, text),
      notice: `${aiFailureReason(err)}; used the basic request parser.`,
    };
  }
}

/** Same loop on Groq (OpenAI-compatible tool calling). */
async function runGroqAssistant(ctx: Ctx, text: string): Promise<AssistantResult> {
  const steps: string[] = [];
  const tools = ASSISTANT_TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
  const messages: GroqMessage[] = [
    {
      role: "system",
      content: assistantSystemPrompt({
        userName: ctx.user.name,
        role: ctx.user.role,
        facultyId: ctx.user.facultyId,
        department: ctx.user.department,
        today: demoToday().weekday,
      }),
    },
    { role: "user", content: text.slice(0, 2000) },
  ];
  try {
    for (let turn = 0; turn < 6; turn++) {
      const res = await groqChat(
        {
          model: AI.assistModel,
          messages,
          tools,
          tool_choice: "auto",
          reasoning_effort: "medium",
          max_completion_tokens: 6000,
        },
        Math.max(AI.timeoutMs * 4, 25_000),
      );
      const msg = res.choices[0]?.message;
      if (!msg) break;
      const calls = msg.tool_calls ?? [];
      const propose = calls.find((c) => c.function.name === "propose_change");
      if (propose) {
        let input: { summary?: string; ops?: unknown[] } = {};
        try {
          input = JSON.parse(propose.function.arguments || "{}");
        } catch {
          return {
            ...fallbackAssistant(ctx, text),
            notice: "The AI's proposal was malformed; used the basic request parser.",
          };
        }
        const parsed = z.array(ChangeOp).safeParse(input.ops ?? []);
        if (!parsed.success)
          return {
            ...fallbackAssistant(ctx, text),
            notice: "The AI's proposal was malformed; used the basic request parser.",
          };
        steps.push("propose_change");
        return {
          reply: msg.content?.trim() || input.summary || "",
          summary: input.summary ?? "",
          ops: parsed.data,
          source: "llm",
          notice: null,
          steps,
        };
      }
      if (!calls.length)
        return {
          reply: (msg.content ?? "").trim(),
          summary: "",
          ops: [],
          source: "llm",
          notice: null,
          steps,
        };
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
      for (const c of calls) {
        steps.push(c.function.name);
        let content: string;
        try {
          content = await runTool(ctx, c.function.name, JSON.parse(c.function.arguments || "{}"));
        } catch (err) {
          content = `Tool failed: ${(err as Error).message}`;
        }
        messages.push({ role: "tool", tool_call_id: c.id, content });
      }
    }
    return {
      ...fallbackAssistant(ctx, text),
      notice: "The AI took too many steps; used the basic request parser.",
    };
  } catch (err) {
    return {
      ...fallbackAssistant(ctx, text),
      notice: `${aiFailureReason(err)}; used the basic request parser.`,
    };
  }
}

// ---------------------------------------------------------------- deterministic fallback
const DAY_RE: [RegExp, z.infer<typeof Day>][] = [
  [/\bmon(day)?s?\b/i, "MON"],
  [/\btue(s|sday)?s?\b/i, "TUE"],
  [/\bwed(nesday)?s?\b/i, "WED"],
  [/\bthu(rs|rsday)?s?\b/i, "THU"],
  [/\bfri(day)?s?\b/i, "FRI"],
];

function daysIn(text: string) {
  return DAY_RE.filter(([re]) => re.test(text)).map(([, d]) => d);
}

function periodsIn(text: string): number[] {
  if (/\bmorning|subah\b/i.test(text)) return [1, 2, 3, 4, 5];
  if (/\bafternoon|evening|after lunch|dopahar\b/i.test(text)) return [6, 7, 8, 9];
  return [1, 2, 3, 4, 5, 6, 7, 8, 9];
}

/** Handles the two common shapes: "I can't take <day> <part>" and "move my <course/kind> to <day> [part]". */
export function fallbackAssistant(ctx: Ctx, text: string): AssistantResult {
  const fid = ctx.user.facultyId;
  const ops: ChangeOp[] = [];
  const lower = text.toLowerCase();
  const [unavailPart, movePart] = lower.split(/\b(?:move|shift|reschedule)\b/);
  if (fid && /\b(can'?t|cannot|unavailable|not available|leave|away|busy|nahi)\b/.test(unavailPart ?? "")) {
    const days = daysIn(unavailPart ?? "");
    if (days.length)
      ops.push({
        op: "mark_unavailable",
        faculty_id: fid,
        days,
        periods: periodsIn(unavailPart ?? ""),
        reason: text.slice(0, 120),
      });
  }
  if (movePart !== undefined && fid) {
    const mine = timetableFor(ctx, fid);
    const courses = ctx.ds.courses as { id: string; name?: string }[];
    const kind = /\blab\b/.test(movePart)
      ? "lab"
      : /\btutorial\b/.test(movePart)
        ? "tutorial"
        : /\blecture|class\b/.test(movePart)
          ? "lecture"
          : null;
    const hit =
      mine.find((m) => movePart.includes(m.course.toLowerCase()) && (!kind || m.kind === kind)) ??
      mine.find((m) => {
        const name = courses.find((c) => c.id === m.course)?.name?.toLowerCase() ?? "";
        const initials = name
          .split(/\s+/)
          .map((w) => w[0])
          .join("");
        return (
          name &&
          (movePart.includes(name) ||
            (initials.length > 1 && new RegExp(`\\b${initials}\\b`).test(movePart))) &&
          (!kind || m.kind === kind)
        );
      }) ??
      (kind ? mine.find((m) => m.kind === kind) : undefined);
    const days = daysIn(movePart);
    if (hit && days.length) {
      const part = periodsIn(movePart);
      const starts =
        part.length === 9 ? undefined : part.filter((p) => hit.kind !== "lab" || p === 2 || p === 6);
      ops.push({
        op: "move_session",
        session_id: hit.session_id,
        days,
        ...(starts?.length ? { starts } : {}),
      });
    }
  }
  const summary = ops
    .map((o) =>
      o.op === "mark_unavailable"
        ? `${o.faculty_id} unavailable ${o.days?.join("/")}`
        : `move ${o.session_id} to ${o.days?.join("/")}`,
    )
    .join("; ");
  return {
    reply: ops.length
      ? `Understood: ${summary}. The engine will check this and find the smallest set of changes; an Admin approves it.`
      : "I couldn't turn that into a change. Try e.g. \"I can't take Thursday mornings, move my CS203 lecture to Friday\", or use the form.",
    summary,
    ops,
    source: "fallback",
    notice: null,
    steps: [],
  };
}
