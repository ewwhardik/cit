# AI usage

Declared per Section 6 of the problem statement.

## 1. Models / APIs the product calls

The product calls **Groq only**. With no `GROQ_API_KEY`, every AI feature falls back to deterministic code and the app keeps working.

| Provider · model | Env var | Used for | Code |
| --- | --- | --- | --- |
| Groq · `openai/gpt-oss-20b` (small tasks) | `GROQ_PARSE_MODEL` | Plain English/Hinglish venue request → booking draft (strict JSON-schema output); rewording engine explanations; the portal characters Lumi / Vela / Orbit (read-only tool calls) | `web/src/server/ai/parse.ts`, `explain.ts`, `agents.ts`, `groq.ts` |
| Groq · `openai/gpt-oss-120b` | `GROQ_ASSIST_MODEL` | Faculty change assistant: reads the user's timetable with tools and proposes structured change operations | `web/src/server/ai/assistant.ts` |

**Prompts** are kept in `web/src/server/ai/prompts/` (plus the character system prompt in `web/src/server/ai/agents.ts`):
- `parse.ts`: booking-draft system prompt and output schema.
- `assistant.ts`: change-assistant system prompt and tool definitions.

The explanation-wording prompt is the `SYSTEM` constant in `web/src/server/ai/explain.ts`.

## 2. What the LLM is NOT allowed to decide

- **Validity.** Whether a timetable, exam schedule, booking or change is valid is always decided by `engine/app/checker.py`. That is deterministic code, tested against the official `validator.py` on 150+ random schedules.
- **Priority / category.** The category is capped in code by the signed-in user's role (`capCategory`, `toRequest`). An LLM output such as `category_claimed: "institute_event"` is only displayed as a claim.
- **Approval.** Only a human approver applies anything, never the requester (also a DB check constraint). The engine re-validates on approval.
- **Final room and time.** The LLM writes a *draft* that the user edits. The engine (`/bookings/check-one`) decides availability. The engine's CP-SAT solvers place sessions.
- **Clock-to-period mapping.** When a request contains explicit times, the deterministic parser's mapping overrides the model's if they disagree.
- **Database access.** The LLM never touches the database. Every output is parsed with a Zod schema and then normalised by `normalizeDraft`, which clamps periods, resolves rooms and flags conflicts. Change operations are scope-checked (`scopeCheck`: faculty → own sessions only) and validated by the engine (`/changes/evaluate`) before a proposal exists.
- **Explanations.** Explanation facts come from `engine/app/explain.py`. The model may only reword the summary, and the raw facts stay visible.
- **Portal characters** (Lumi, Vela, Orbit) only read data through tools (free rooms, timetables, free periods, explanations, booking status) and return links; they cannot book, approve or change anything.
- **Prompt injection.** Request text is wrapped as data. The parse call has no tools. The assistant's tools are read-only, except `propose_change`, which only proposes.

**Fallback.** If the LLM fails (no key, timeout, rate limit, refusal, malformed output), the deterministic parser (`web/src/lib/booking/parser.ts`) fills the form and a banner says so. The manual form also works with every parser off.

## 3. AI tools used to build the project

| Tool | Used for |
| --- | --- |
| Claude Code (Anthropic, Opus-class model) with research sub-agents | Pre-hackathon research and the build plan (`PLAN.md`): open-source survey, stack study, solver design |
| Claude Code (Anthropic, Opus-class model), cloud session | All code in this repository: the engine (checker, oracle tests, CP-SAT timetable/exam/booking solvers, repair, explanations, change evaluation, overrides, API), the export script, the web app (auth, schema, UI, AI layer, workflows, tests), Docker/Railway config and these docs. Commits carry a `Co-Authored-By: Claude` trailer. |

No UI generators (v0 etc.) were used.

## 4. Running log

| Date | Tool | Work |
| --- | --- | --- |
| 2026-10-31 | Claude Code | Engine checker + oracle tests; CP-SAT timetable, exams, Spectra allocator, minimal-change repair, FastAPI |
| 2026-10-31 | Claude Code | `scripts/generate_exports.py`; generated `exports/` through the API |
| 2026-10-31 | Claude Code | Web scaffold: auth, schema, shell, timetable grid, dashboard, generate/data |
| 2026-10-31 | Claude Code | Engine: explanations, change evaluation, infeasibility diagnosis, session overrides |
| 2026-10-31 | Claude Code | Web: AI booking parser + fallback, change assistant, bookings/approvals/proposals/disruptions/Spectra/rooms UI |
| 2026-10-31 | Claude Code | Groq provider (team's key, stored only in `.env`), Docker/Railway config |
| 2026-10-31 | Claude Code | Groq-only AI layer, portal characters (CSS-3D) with read-only tools, lagoon theme, Neon wiring |
