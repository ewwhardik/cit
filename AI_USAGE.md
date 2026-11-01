# AI Usage Declaration

Declared in full compliance with Section 6 of the Chilika Institute of Technology Crunch Week Problem Statement.

---

## 1. Models & APIs the Product Calls

The runtime AI provider is configured via `AI_PROVIDER` (`groq` or `anthropic`). If no API key is provided, or if the model experiences rate limits or timeouts, every AI feature immediately falls back to deterministic code, ensuring 100% operational uptime.

| Provider · Model | Environment Variable | Role in Application | Implementation Path |
| --- | --- | --- | --- |
| **Groq** · `openai/gpt-oss-20b` | `GROQ_PARSE_MODEL` | Parses free-form English or Hinglish venue requests into structured booking drafts (strict JSON Schema); rewording engine constraint facts into natural language explanations. | `web/src/server/ai/parse.ts`, `explain.ts`, `groq.ts` |
| **Groq** · `openai/gpt-oss-120b` | `GROQ_ASSIST_MODEL` | Faculty Change Assistant: analyzes the user's timetable with read-only tools and proposes structured change operations for human review. | `web/src/server/ai/assistant.ts` |
| **Groq** · `openai/gpt-oss-20b` | `NAVIGATOR_MODEL` | **Iru (In-App Navigator)**: answers navigation questions ("where do I book the auditorium?") and triggers navigation or launches the guided tour. Strictly rate-limited per user. | `web/src/server/ai/navigator.ts`, `web/src/app/api/navigator/route.ts` |
| **Anthropic** · `claude-haiku-5-5` *(optional alternative)* | `AI_PARSE_MODEL` | High-speed structured JSON parsing fallback using `messages.parse`. | same files |
| **Anthropic** · `claude-sonnet-5-5` *(optional alternative)* | `AI_ASSIST_MODEL` | Alternative assistant provider for tool-use and complex proposal drafting. | same files |

**Prompt Architecture:**
All prompts reside in `web/src/server/ai/prompts/`:
- `parse.ts`: Venue booking system prompt with strict Zod output schemas.
- `assistant.ts`: Timetable change assistant prompt with scoped tool definitions.
- `navigator.ts`: Iru navigation agent prompt (site map dynamically injected from `web/src/lib/sitemap.ts`).
- Explanation wording is governed by the `SYSTEM` prompt in `web/src/server/ai/explain.ts`.

---

## 2. Strict Guardrails: What the AI is NOT Allowed to Decide

Under the core system design philosophy, **"AI reads and assists; code decides and verifies; humans approve."**

1. **Timetable & Constraint Validity:**
   - The LLM never validates schedules or bookings. All validity checks are executed by `engine/app/checker.py`, a deterministic constraint engine rigorously tested against the official `validator.py` across 150+ oracle schedules.
2. **Priority & Category Claims:**
   - Priority categories are strictly clamped by server code based on the authenticated user's session role (`capCategory`, `toRequest`). An LLM output claiming `category_claimed: "institute_event"` from a club account is demoted to club priority by code before engine evaluation.
3. **Approval Authority:**
   - The AI has zero approval authority. Approvals require human intervention (Admin or Department Coordinator). Self-approval is prevented by code and enforced via a database check constraint.
4. **Final Room and Period Assignment:**
   - The AI only prepares an editable *draft*. The CP-SAT solver engine (`/bookings/check-one`, `/timetable/generate`) makes all final conflict-free assignments.
5. **Clock-to-Period Translation:**
   - When user prompts include explicit times (e.g., "6 PM to 8 PM"), code overrides LLM assumptions to ensure exact period mapping (P10–P11).
6. **Database Access & Injection Prevention:**
   - The LLM has zero direct database access. Outputs pass through Zod schemas and normalization layers (`normalizeDraft`). All user text is treated strictly as data parameters.
7. **Deterministic Fallback:**
   - If the AI is unavailable, timed out, or unconfigured, an in-house deterministic regex and heuristic parser (`web/src/lib/booking/parser.ts`) processes English and Hinglish requests seamlessly, accompanied by an informative UI notice.

---

## 3. Project Authorship & Role of AI in Development

### 3a. Lead Architect & Creator: Sai Ram Dash

**Sai Ram Dash** is the author, system architect, and project lead of CIT Scheduler. Sai Ram Dash directed the entire conceptualization, algorithmic strategy, user experience, and technical verification:

- **Mathematical Formulation & Solver Strategy:** Designed the multi-phase OR-Tools CP-SAT formulation, including interval variables for rooms, domain pruning for faculty availability/lunch breaks, the hierarchical priority objective ($1000 \cdot \text{weight} \cdot \text{status} + \text{rank}$) guaranteeing 0 priority inversions, and the minimal-perturbation disruption repair algorithm ($1000 \cdot \text{moved} + 5 \cdot \text{time\_shifted} + \text{soft}$).
- **Resilience Modeling:** Conceived the scenario-based resilience scan that simulates single-day outages of the campus's busiest professors and classrooms to measure recovery headroom.
- **System Architecture & Infrastructure:** Designed the distributed architecture pairing Next.js App Router, Neon Postgres, Render FastAPI engine, and an automated GitHub Actions 4-vCPU solver relay.
- **Workflow & UI/UX Design:** Designed the four-role operational hierarchy, the visual diff engine for disruptions, the "Why Here?" constraint tracer, the guided tour system, and Iru the Chilika dolphin navigator.
- **Supervision, Prompt Direction & Code Review:** Directed Claude Code as an AI pair-programmer through precise architectural instructions, specifications, and constraint equations; systematically reviewed all generated code, tested edge cases, and verified 100% compliance with Section 1–6 of the Crunch Week brief.
- **Submissions & Media:** Authored the walkthrough demonstration video, recorded the narration, and conducted live end-to-end testing.

### 3b. AI Pair Programming: Claude Code (Anthropic)

**Claude Code** (Anthropic, Opus-class model) served as the primary implementation tool working under the direct guidance and technical instructions of Sai Ram Dash:

- Implemented the Python FastAPI engine, CP-SAT solver modules, and oracle test suites according to Sai Ram Dash's mathematical specifications.
- Implemented the Next.js frontend, Better Auth integration, Drizzle database schemas, UI components, and the GitHub Actions solver relay worker.
- Claude Haiku sub-agents assisted with rapid execution of unit tests (navigator fallback tests, ICS calendar export tests, tour logic tests) and verification runs against the official Python oracle.

All AI-assisted commits within the repository carry a `Co-Authored-By: Claude` git trailer.

---

## 4. Engineering & Development Chronology

| Date | Contributor | Milestone / Engineering Work |
| --- | --- | --- |
| **2026-10-31** | **Sai Ram Dash** (directed Claude Code) | Architectural design; CP-SAT formulation for timetable, exams, and Spectra allocator; deterministic checker engine; 150+ oracle verification tests against `starter/validator.py`. |
| **2026-10-31** | **Sai Ram Dash** (directed Claude Code) | Benchmark export script (`scripts/generate_exports.py`); produced and verified `exports/schedule.json` (0 hard, 3 soft, 67/70 booking score). |
| **2026-10-31** | **Sai Ram Dash** (directed Claude Code) | Full-stack web console: Better Auth with 4 roles, PostgreSQL schema via Drizzle ORM, timetable grid, and real-time dashboard analytics. |
| **2026-10-31** | **Sai Ram Dash** (directed Claude Code) | Root-cause constraint explanation engine (`explain.py`), disruption evaluator, and session override mechanics for Spectra week. |
| **2026-10-31** | **Sai Ram Dash** (directed Claude Code) | Natural language and Hinglish booking parser with deterministic fallback; faculty change assistant with scoped tools; approvals and role-based workflows. |
| **2026-10-31** | **Sai Ram Dash** (directed Claude Code) | Production deployments to Render and Vercel; 3D isometric timetable skyline on landing page. |
| **2026-10-31** | **Sai Ram Dash** (directed Claude Code) | Engineering the 4-vCPU GitHub Actions solver relay for heavy CP-SAT optimization; resilience scenario scan; timetable version history with soft-penalty trends. |
| **2026-10-31** | **Sai Ram Dash** (directed Claude Code) | In-app guided tour; Iru the Chilika dolphin navigator with rate limiting; `.ics` calendar sync; `docs/ARCHITECTURE.md`. |
| **2026-11-01** | **Sai Ram Dash** (directed Claude Code) | Admin priority-order editor (§4 problem statement); parallelized dashboard data layer; high-resolution documentation assets. |
