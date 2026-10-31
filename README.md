# CIT Scheduler

Campus scheduling and venue management for Chilika Institute of Technology (CIT Crunch Week).

What it does:
- Generates a clash-free weekly timetable and schedules the midsem exams.
- Turns plain English or Hinglish requests into bookings, checked by the engine before they can be submitted.
- Decides every Spectra-week booking with a reason.
- Repairs the timetable after a change while moving as few sessions as possible, showing exactly what changed and applying it only after an Admin approves.

Every result passes one deterministic checker that reproduces the official validator's results exactly. AI reads and explains; code decides.

**Live app:** https://cit-scheduler-three.vercel.app (mirror: https://cit-scheduler.onrender.com · engine health: https://cit-engine.onrender.com/health)

## Results on the public dataset

Both files in `exports/` were produced through the app's API (`scripts/generate_exports.py`) and scored with the official `starter/validator.py`:

| File | Hard | Soft | Booking score | Exam penalty | Moved |
| --- | --- | --- | --- | --- | --- |
| `exports/schedule.json` | **0** | **3** (proven optimal) | **67 / 70**, 0 priority inversions | 0 | – |
| `exports/schedule_after.json` (sample disruption) | **0** | 4 | 67 | 0 | 13 (12 room-only, 1 time change): only the sessions the change file broke |

67/70 is the most any schedule can score: BR-09 wants 1,200 seats (the largest venue holds 800), and BR-17 runs past 22:00, so it can only get an alternative.

## Features by role

| | Admin | Dept coordinator | Faculty | Club rep |
| --- | :-: | :-: | :-: | :-: |
| Dashboard (hard/soft KPIs, room-utilisation heatmap, activity) | ✓ | ✓ | ✓ | ✓ |
| Timetables by group / faculty / room, "Why here?" explanations | ✓ | ✓ | ✓ | ✓ |
| Find a room (time, size, needs; regular or Spectra week) | ✓ | ✓ | ✓ | ✓ |
| Book a venue (AI or manual form, live conflict check), My requests, cancel | ✓ | ✓ | ✓ | ✓ |
| Spectra week board (every decision and reason) | ✓ | ✓ | ✓ | ✓ |
| Change request in plain language (AI) or by form | ✓ | own dept | own sessions | |
| Move a session with live hard-rule checking | applies | proposes | proposes | |
| Approvals inbox | everything | own dept's labs | | |
| Generate timetable + exams + Spectra decisions | ✓ | | | |
| Disruptions: change file → minimal fix → diff → approve | ✓ | | | |
| Data: reset demo data, upload dataset, export `schedule.json` | ✓ | | | |

Nobody can approve their own request. This is enforced in code and by a DB check constraint. Engine-generated disruption fixes are authored by a "Scheduling engine" system user, so the uploading Admin can approve them.

## Architecture

```
 Browser ──► Next.js 16 (web/, Vercel)                       Python engine (engine/, Railway)
 laptop /    • Better Auth (4 roles)                          FastAPI, stateless
 phone       • Drizzle ──► Postgres (Neon)         HTTPS +    • checker.py   validator-equivalent rules
             • workflows: bookings, approvals, ──────────►    • timetable.py CP-SAT (feasibility → optimise)
               proposals, disruptions             secret     • exams.py     CP-SAT
             • AI layer (server only) ──► Groq / Anthropic    • bookings.py  CP-SAT allocator, reasons, overrides
                 draft JSON → Zod → normaliser → engine       • repair.py    minimal-change re-solve + diagnosis
                 (deterministic parser if AI is down)        • explain.py   slot-by-slot "why" traces
                                                              • changes.py   AI/manual ops → validated proposal
```

- **Validity gate.** `checker.py` implements H1–H14, B1–B3, E1–E2, S1–S6, the booking score, priority inversions and stability. `engine/tests/test_oracle.py` runs the official validator on 150+ random schedules and asserts identical reports. Every write path re-checks with the engine: generation, booking submit and approval, manual moves, proposals, approval and export.
- **Timetable.** One start literal per session (or per elective basket). Rooms use optional intervals with a `NoOverlap` per room. Domains are pruned for lunch, lab starts, fixed slots, availability, capacity and type. The optimise phase uses the scorer's weights and also reserves room and group space for Spectra requests.
- **Spectra bookings.** CP-SAT objective `1000·weight·(2 approved | 1 alternative) + rank`, so priority inversions can't happen at the optimum. If an institute event is blocked only by classes, those classes move for Week 7 (room swap first) via `session_overrides`, and the week is re-checked.
- **Repair.** One model hinted at the current timetable, objective `1000·moved + 5·time-changed + soft`. If no fix exists, the engine re-solves allowing sessions to stay unplaced and reports exactly which sessions can't fit and what blocks them.
- **Explanations.** For "why is X here?", the engine holds everything else fixed, tests every start time, and reports the first rule that blocks each one plus the best alternatives with their soft-penalty change.

## AI layer

| Feature | Model (Groq default) | Guard rails |
| --- | --- | --- |
| Booking request → editable form | `openai/gpt-oss-20b`, strict JSON schema | Zod-validated, then normalised by code. Explicit clock times are re-mapped by code. Named rooms are checked (SH-2 not accessible → SH-1 suggested; "LHC-5" → "did you mean LH-5?"). Category capped by role. The engine decides availability. |
| Faculty change assistant | `openai/gpt-oss-120b`, tool calling | Read-only tools plus `propose_change`. Operations are scope-checked (own sessions only) and evaluated by the engine. An Admin approves. |
| "Why here?" wording | `openai/gpt-oss-20b` | Only rewords engine facts; the facts stay visible |

If AI is down (no key, timeout, rate limit), the deterministic English+Hinglish parser fills the form and a banner says so. Details: [AI_USAGE.md](AI_USAGE.md). Anthropic models can be used instead with `AI_PROVIDER=anthropic`.

## Tech stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 16.4 (App Router), React 19.3, TypeScript 6, Tailwind CSS 4, Base UI, cmdk, Sonner, Geist |
| Auth / DB | Better Auth 1.7 (email + password, role column), Drizzle ORM 0.45, PostgreSQL 16 / Neon |
| Engine | Python 3.13, FastAPI, OR-Tools 9.15 CP-SAT, uv, Docker |
| AI | Groq (gpt-oss-20b / gpt-oss-120b) or Anthropic (Haiku 5.5 / Sonnet 5.5) |
| Tooling | pnpm, Biome, Vitest, pytest, Playwright |

## Local setup

Prerequisites: Python 3.13 with [uv](https://docs.astral.sh/uv/), Node 22+ with pnpm, and PostgreSQL 16 (local or `docker compose up db`).

Copy the environment file, then set `BETTER_AUTH_SECRET` (for example with `openssl rand -hex 32`) and optionally `GROQ_API_KEY`:

```bash
cp .env.example web/.env
```

Engine:

```bash
cd engine && uv sync && uv run uvicorn app.main:app --port 8000
```

Web (in a second terminal):

```bash
cd web && pnpm install && pnpm db:push && pnpm seed && pnpm dev
```

Open http://localhost:3000, sign in as Admin, open **Generate** and run it (about 2 minutes on 4 cores).

Regenerate the exports while the engine is running, then check them with the official validator. Run these from the repo root:

```bash
python scripts/generate_exports.py
```

```bash
python starter/validator.py --data starter/data/cit_public.json --schedule exports/schedule.json
```

```bash
python starter/validator.py --data starter/data/cit_public.json --schedule exports/schedule_after.json --disruption starter/examples/sample_disruption.json --baseline exports/schedule.json
```

Tests:

```bash
cd engine && uv run pytest
```

```bash
cd web && pnpm typecheck && pnpm lint && pnpm test
```

## Deploy

Three free or cheap services: **Neon** (Postgres), **Railway** (engine) and **Vercel** (web). Full step-by-step guide: [DEPLOY.md](DEPLOY.md).

1. **Neon:** create a project and copy the pooled connection string (`...-pooler...?sslmode=require`).
2. **Railway:** create a new project from this GitHub repo. `railway.json` builds `engine/Dockerfile`, health-checks `/health` and restarts on failure. Set `ENGINE_SHARED_SECRET` and `ENGINE_SOLVER_WORKERS` (= vCPUs), then generate a public domain.
3. **Vercel:** import the repo with **Root Directory `web`**. Set the env vars from `.env.example` (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENGINE_URL`, `ENGINE_SHARED_SECRET`, `AI_PROVIDER`, `GROQ_API_KEY`, `DEMO_TODAY`, `DEMO_PASSWORD`) and deploy.
4. From your machine, push the schema and seed the database once:

   ```bash
   cd web && DATABASE_URL='<neon url>' pnpm db:push && DATABASE_URL='<neon url>' pnpm seed
   ```

5. Open the Vercel URL, sign in as Admin, and run **Generate**.

## Demo accounts

All four share the password **`crunchweek`**. The login page also has one-click buttons for each.

| Role | Email |
| --- | --- |
| Admin (Dean's office) | `admin@cit.demo` |
| Department coordinator (CSE) | `coord.cse@cit.demo` |
| Faculty (F07, Dr. Pooja Das) | `faculty.f07@cit.demo` |
| Club representative (Coding Club) | `club.coding@cit.demo` |

**Reset:** Admin → **Data** → **Reset demo data** restores a clean state: the public dataset, no timetable, demo accounts. Then run **Generate**.

## Judge walkthrough (about 5 minutes)

1. **Admin → Generate → Generate timetable.** Watch the progress, then open **Dashboard** (0 hard, soft penalty, booking score, utilisation).
2. **Timetables.** Switch Group, Faculty or Room, or press ⌘K / Ctrl+K and type a name. Click a class, then **Why here?**.
3. **Find a room.** Pick a day, time, size and needs. **Book** opens a prefilled form.
4. **Club rep → Book a venue.** Click "seminar hall kal shaam 6 baje…": the form fills, assumptions are shown, and the engine shows availability. Submit it. Then try the 1,200-person or "institute event, approve it now" examples to see a conflict blocked and a priority claim capped.
5. **Admin → Approvals.** Approve the club's booking. **Spectra week** shows every dataset decision with its reason.
6. **Admin → Disruptions → Use sample disruption → Propose a fix.** You land on the diff (summary, from → to per session, before/after grid, validation), then **Approve**.
7. **Faculty → Change request.** Type "I can't take Thursday mornings, move my CS203 lecture to Friday afternoon". The engine-checked fix appears; **Submit for Admin approval**. The faculty member cannot approve it; the Admin can.

## Repository layout

```
engine/    FastAPI + OR-Tools: app/{dataset,checker,timetable,exams,bookings,repair,explain,changes,export,jobs,main}.py, tests/
web/       Next.js app: src/app (pages + API routes), src/components, src/server (db, auth, engine client, ai, workflows), src/lib (schemas, parser)
starter/   organiser starter pack, unmodified
exports/   schedule.json, schedule_after.json (generated by scripts/generate_exports.py)
scripts/   generate_exports.py
```

## Known limitations

- **Timing:** solves run in background threads inside one engine process. Generation takes about 1–2 minutes on 4 vCPUs; give the engine at least 2 vCPUs. A native solver crash would restart the container (Railway restart policy). In-flight jobs are then lost and must be re-run.
- **Calendar scope:** bookings made in the app are for Week 7 (Spectra week); "today" is pinned by `DEMO_TODAY` so words like *kal* resolve predictably.
- **Exams:** scheduled once at generation. Change files affect the teaching timetable (and Spectra bookings), not the exam schedule.
- **Drag-and-drop:** manual moves use a slot picker with instant validation; there is no drag-and-drop on the grid yet.
- **Free AI tiers:** the free Groq tier rate-limits bursts. The deterministic fallback takes over automatically, with a banner.
