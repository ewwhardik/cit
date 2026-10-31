# Third-party software

All application code in this repository was written during the hackathon. The
projects below are open-source libraries we depend on (installed from PyPI / npm).
Organiser files in `starter/` (dataset, CSVs, `validator.py`, examples) are used
unmodified; `validator.py` is only imported by our tests as an oracle.

## Engine (Python)

| Library | License | Use |
| --- | --- | --- |
| [OR-Tools](https://github.com/google/or-tools) (CP-SAT) | Apache-2.0 | Timetable, exam and booking solvers |
| [FastAPI](https://github.com/fastapi/fastapi) | MIT | HTTP API |
| [Pydantic](https://github.com/pydantic/pydantic) | MIT | Request models |
| [Uvicorn](https://github.com/encode/uvicorn) | BSD-3-Clause | ASGI server |
| [pytest](https://github.com/pytest-dev/pytest) | MIT | Tests |
| [HTTPX](https://github.com/encode/httpx) | BSD-3-Clause | API test client |
| [uv](https://github.com/astral-sh/uv) | Apache-2.0 / MIT | Python packaging (tooling) |

## Web (TypeScript)

| Library | License | Use |
| --- | --- | --- |
| [Next.js](https://github.com/vercel/next.js) | MIT | Web framework |
| [React](https://github.com/facebook/react) | MIT | UI |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 | Language |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | MIT | Styling |
| [Base UI](https://github.com/mui/base-ui) | MIT | Accessible primitives (dialog / sheet) |
| [cmdk](https://github.com/pacocoursey/cmdk) | MIT | ⌘K command palette |
| [Better Auth](https://github.com/better-auth/better-auth) | MIT | Authentication |
| [Drizzle ORM / drizzle-kit](https://github.com/drizzle-team/drizzle-orm) | Apache-2.0 | Database access and migrations |
| [node-postgres (pg)](https://github.com/brianc/node-postgres) | MIT | Postgres driver |
| [Zod](https://github.com/colinhacks/zod) | MIT | Shared schemas / validation |
| [TanStack Query](https://github.com/TanStack/query) | MIT | Client data fetching (planned use) |
| [Sonner](https://github.com/emilkowalski/sonner) | MIT | Toasts |
| [Lucide](https://github.com/lucide-icons/lucide) | ISC | Icons |
| [Geist font](https://github.com/vercel/geist-font) | OFL-1.1 | Typeface |
| [clsx](https://github.com/lukeed/clsx), [tailwind-merge](https://github.com/dcastil/tailwind-merge) | MIT | Class name helpers |
| [server-only](https://www.npmjs.com/package/server-only) | MIT | Server/client boundary guard |
| [Biome](https://github.com/biomejs/biome) | MIT / Apache-2.0 | Lint + format |
| [Vitest](https://github.com/vitest-dev/vitest) | MIT | Unit tests |
| [tsx](https://github.com/privatenumber/tsx), [dotenv](https://github.com/motdotla/dotenv) | MIT / BSD-2-Clause | Seed script tooling |

## Services

| Service | Use |
| --- | --- |
| PostgreSQL 16 (Neon in production) | Database |
| Playwright + Chromium (dev only) | Screenshot / end-to-end checks |

Projects studied for ideas only (no code used): Timefold school-timetabling
quickstarts, UniTime, FET, Cal.com, the CP-SAT Primer.
