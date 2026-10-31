# Cloud session kickoff

Paste the prompt below into a new Claude Code cloud session (claude.ai/code) opened on your new GitHub repo.

---

This repo is our hackathon project for the CIT Crunch Week problem.

- `Problem statement.pdf` is the brief.
- `starter/` is the organiser starter pack. Never modify it.
- `PLAN.md` is the agreed, detailed build plan.

Read all three first. `starter/validator.py` is the scorer and the ground truth.

Then start building per `PLAN.md` section 8, block H0–2:

1. Scaffold the monorepo layout in `PLAN.md` section 7:
   - `web/`: Next.js 16, TypeScript 6, Tailwind 4, shadcn/ui on Base UI, Better Auth, Drizzle with Postgres.
   - `engine/`: Python 3.13, FastAPI, OR-Tools, managed with uv.
2. In `engine/`, implement dataset loading and `checker.py`, which mirrors the validator's rules H1–H14, B and E. Add a pytest that runs the official `starter/validator.py` as an oracle and asserts identical violation sets.
3. Implement the CP-SAT timetable solver phase 1 (feasibility) from `PLAN.md` §4.1. Export a `schedule.json` and confirm 0 hard violations with the official validator.
4. Commit after each working step with clear messages. Commit history is judged.

Rules:

- Write all code fresh. Don't copy other projects or templates. Only use open-source libraries, and list each one in `THIRD_PARTY.md`.
- The LLM never decides validity. That is always deterministic code.
- Keep a running log of AI tool use for `AI_USAGE.md`.
