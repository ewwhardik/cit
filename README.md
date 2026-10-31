# CIT Scheduler

Campus scheduling and venue management for Chilika Institute of Technology (CIT Crunch Week).
It generates a clash-free weekly timetable, schedules midsem exams, decides Spectra-week venue
bookings with a reason for each one, and repairs the timetable after a change while moving as few
sessions as possible. Every result passes one deterministic checker, which reproduces the official
validator's results exactly.

> Status: work in progress. See [Known limitations](#known-limitations) for what is not built yet.
> The full plan is in [`PLAN.md`](PLAN.md).

## Results on the public dataset

Both files in `exports/` were produced by the app's API (`scripts/generate_exports.py`) and scored with the official `starter/validator.py`:

| File | Hard | Soft | Booking score | Exam penalty | Moved |
| --- | --- | --- | --- | --- | --- |
| `exports/schedule.json` | **0** | **3** (proven optimal) | **67 / 70**, 0 inversions | 0 | – |
| `exports/schedule_after.json` (sample disruption) | **0** | 3 | 67 | 0 | 12 (11 room-only, 1 time change) |

The 67/70 booking score is the most any schedule can get. BR-09 asks for 1,200 people, more than any venue holds, and BR-17 asks to run past 22:00, so it can only be offered an alternative.

## Architecture

```
 Browser ──► Next.js 16 (web/)                         Python engine (engine/)
 laptop /    • Better Auth (4 roles)                   FastAPI, stateless
 phone       • Drizzle ──► Postgres (Neon)   HTTPS +   • checker.py   validator-equivalent rules
             • pages: dashboard, timetables, ──────►   • timetable.py CP-SAT, 2 phases
               generate, data                secret    • exams.py     CP-SAT
             • (planned) AI booking assistant          • bookings.py  CP-SAT allocator + reasons
               ──► Anthropic, draft only               • repair.py    minimal-change re-solve
                                                       • jobs.py      background solves + progress
```

- **Web** owns users, persistence, workflow and the UI. **Engine** owns every scheduling rule. Each call sends the dataset and the current schedule.
- **Validity gate.** `engine/app/checker.py` implements H1–H14, B1–B3, E1–E2, S1–S6, the booking score, priority inversions and stability. `engine/tests/test_oracle.py` runs the official `validator.py` on 150+ random schedules (valid and deliberately broken) and asserts identical reports. A generated timetable is stored only if it has 0 hard violations, and export refuses anything with a hard violation.
- **Timetable model.** One start literal per session, or per elective basket so baskets stay in sync. Rooms use optional intervals with a `NoOverlap` per room. Domains are pruned for lunch, lab starts, fixed slots, availability, capacity and room type. Phase 1 finds a feasible timetable in about 12 s. Phase 2 minimises S1–S6 with the scorer's weights, while also reserving rooms and mandatory groups for Spectra events.
- **Repair.** Re-solves with every session hinted at its old place and the objective `1000·moved + 5·time-changed + soft`, so a session never moves to save a few soft points. The result is a diff plus a full report.

## Tech stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 16.4 (App Router), React 19.3, TypeScript 6, Tailwind CSS 4, Base UI, cmdk, Sonner, Geist |
| Auth / DB | Better Auth 1.7 (email + password, role column), Drizzle ORM 0.45, PostgreSQL 16 / Neon |
| Engine | Python 3.13, FastAPI, OR-Tools 9.15 CP-SAT, managed with uv |
| Tooling | pnpm, Biome, Vitest, pytest, Playwright (screenshots) |
| Deploy (planned) | Vercel (web), Railway (engine, always-on Docker), Neon |

## Setup

Prerequisites: Python 3.13 with [uv](https://docs.astral.sh/uv/), Node 22+ with pnpm, and PostgreSQL 16 (local or `docker compose up db`).

```bash
cp .env.example web/.env        # then set BETTER_AUTH_SECRET
```

Engine:

```bash
cd engine && uv sync && uv run uvicorn app.main:app --port 8000
```

Web (in a second terminal):

```bash
cd web && pnpm install && pnpm db:push && pnpm seed && pnpm dev
```

Open http://localhost:3000, sign in as Admin, go to **Generate** and run the solver. Expect about 2 minutes on 4 cores.

Regenerate the exports and check them with the official validator. Run these from the repo root while the engine is running:

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

## Demo accounts

All four share the password **`crunchweek`**. The login page also has one-click buttons for each.

| Role | Email |
| --- | --- |
| Admin (Dean's office) | `admin@cit.demo` |
| Department coordinator (CSE) | `coord.cse@cit.demo` |
| Faculty (F07) | `faculty.f07@cit.demo` |
| Club representative (Coding Club) | `club.coding@cit.demo` |

Admin → **Data** → **Reset demo data** restores a clean state: the public dataset, no timetable, and the demo accounts.

## Judge walkthrough (current build)

1. Sign in as **Admin**, open **Generate**, click **Generate timetable** and watch the progress.
2. **Timetables**: switch between Group, Faculty and Room, or press ⌘K / Ctrl+K and type a group, teacher or room. Click any block for details. On a phone, use the day chips.
3. **Dashboard** shows hard violations, the soft penalty, the booking score, the exam penalty and room utilisation.
4. **Data** has Reset demo data, Upload dataset and Download `schedule.json`.

## Repository layout

```
engine/    FastAPI + OR-Tools: app/{dataset,checker,timetable,exams,bookings,repair,export,jobs,main}.py, tests/
web/       Next.js app: src/app (pages + API routes), src/components, src/server (db, auth, engine client), src/lib (schemas)
starter/   organiser starter pack, unmodified
exports/   schedule.json, schedule_after.json (generated by scripts/generate_exports.py)
scripts/   generate_exports.py
```

## Known limitations

Built so far: the whole engine, the exports, auth and roles, the timetable views, the dashboard, generation and data management. Not built yet:

- The AI booking assistant (plain English / Hinglish parsing with a deterministic fallback), the manual booking form and "Ask why" explanations. The engine already provides `/bookings/check-one` and structured reasons for these.
- Web screens for Spectra decisions, disruption upload with diff and approval, and the approvals inbox. The engine endpoints exist (`/bookings/allocate`, `/disruptions/repair`); the UI is next.
- Drag-to-move manual scheduling. Live validation already exists in the engine (`/timetable/check-move`).
- Session overrides: Spectra events are fitted by reserving space in the timetable, so the public data needs no overrides, but displacing a class for an institute event isn't implemented.
- If repair finds no valid fix, it currently reports only basic diagnostics (no minimal conflicting constraint set yet).
- Not deployed yet. The live link will be added here.
