# Deploying CIT Scheduler

The app has three parts, each on a service suited to it:

| Part | Service | Why |
| --- | --- | --- |
| Postgres | [Neon](https://neon.tech) (free tier) | Serverless Postgres, works with Vercel |
| Scheduling engine (`engine/`, Docker) | [Railway](https://railway.com) (Hobby, about $5/month) | Always on: the solver needs 1–2 minutes of CPU and must not cold-start while judges use it |
| Web app (`web/`) | [Vercel](https://vercel.com) (Hobby, free) | Native Next.js hosting |

Alternatives: the engine also runs on Render (a paid instance; the free tier sleeps), Fly.io or any VM with Docker. The web app runs anywhere Next.js runs.

Never commit keys. Set them only in each service's environment-variable settings.

---

## 1. Database: Neon

1. Sign up at neon.tech and choose **Create project** (region close to your users, for example Singapore or Mumbai).
2. **Connect**: copy the **pooled** connection string. It looks like:
   `postgresql://USER:PASSWORD@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
3. From your computer, create the tables and seed the demo accounts and dataset:

   ```bash
   cd web && pnpm install
   ```

   ```bash
   DATABASE_URL='postgresql://...pooler...?sslmode=require' pnpm db:push
   ```

   ```bash
   DATABASE_URL='postgresql://...pooler...?sslmode=require' pnpm seed
   ```

## 2. Engine: Railway

1. Push the repository to GitHub (it must be public for judging anyway).
2. At railway.com: **New Project → Deploy from GitHub repo** and pick the repo.
3. Railway reads `railway.json` at the repo root. It builds `engine/Dockerfile` (build context = repo root), health-checks `/health` and restarts the container on failure.
4. In the service's **Variables** tab, add:

   | Variable | Value |
   | --- | --- |
   | `ENGINE_SHARED_SECRET` | a long random string, e.g. from `openssl rand -hex 24` (keep a copy for Vercel) |
   | `ENGINE_SOLVER_WORKERS` | the number of vCPUs of the instance (e.g. `4`; at least `2`) |
   | `ENGINE_CORS_ORIGINS` | `*` is fine because the browser never calls the engine directly |

   Railway sets `PORT` itself, and the Dockerfile listens on it.
5. **Settings → Networking → Generate Domain**. You get something like `https://cit-engine-production.up.railway.app`.
6. Check it: open `https://<engine-domain>/health`. It should return `{"ok": true, ...}`.

## 3. Web: Vercel

1. At vercel.com: **Add New → Project → Import** the GitHub repo.
2. **Root Directory: `web`**. Keep "Include files outside the root directory" enabled (the default), because the app reads the bundled dataset from `../starter`. Framework preset: Next.js. Install command: `pnpm install`.
3. **Environment Variables**:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the Neon **pooled** string (host contains `-pooler`) |
   | `DATABASE_URL_UNPOOLED` | the Neon **direct** string (used only for migrations) |
   | `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
   | `BETTER_AUTH_URL` | your Vercel URL, e.g. `https://cit-scheduler.vercel.app` (add it after the first deploy, then redeploy) |
   | `ENGINE_URL` | the Railway domain, e.g. `https://cit-engine-production.up.railway.app` |
   | `ENGINE_SHARED_SECRET` | the same value as on Railway |
   | `GROQ_API_KEY` | your Groq key |
   | `GROQ_PARSE_MODEL` | `openai/gpt-oss-20b` (optional; this is the default) |
   | `GROQ_ASSIST_MODEL` | `openai/gpt-oss-120b` (optional; this is the default) |
   | `AI_TIMEOUT_MS` | `6000` |
   | `DEMO_TODAY` | `2027-02-08` (Monday of Spectra week, so "kal" means Tuesday) |
   | `DEMO_PASSWORD` | `crunchweek` |

4. **Deploy**. Set `BETTER_AUTH_URL` to the final URL and redeploy once.

## 4. First run

1. Open the Vercel URL and sign in as **Admin** (one-click button, password `crunchweek`).
2. **Generate → Generate timetable** (2 minutes recommended). The dashboard shows 0 hard violations.
3. Optional: run the sample disruption under **Disruptions** to check the full flow.
4. Before judging, use **Data → Reset demo data** and generate once more, so judges start from a clean, generated state.

## 5. Checks before submitting

- [ ] `https://<engine>/health` returns ok, and the web app's Generate finishes.
- [ ] All four demo logins work on the live URL.
- [ ] Booking works with AI. Then temporarily remove `GROQ_API_KEY` in Vercel and redeploy: the form still fills (basic parser banner) and submits. Put the key back.
- [ ] Phone check: open the live URL on a phone and try Timetables, Book and Approvals.
- [ ] `exports/` regenerated against the live engine if you changed the solver:

  ```bash
  ENGINE_URL=https://<engine-domain> ENGINE_SHARED_SECRET=<secret> python scripts/generate_exports.py
  ```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Scheduling engine unreachable" | `ENGINE_URL` is wrong, or the Railway service is sleeping or crashed; check `/health` and the Railway logs |
| 401 from the engine | `ENGINE_SHARED_SECRET` differs between Vercel and Railway |
| Login loops back to the login page | `BETTER_AUTH_URL` doesn't match the URL you opened; set it and redeploy |
| "AI rate-limited" banner | Groq free-tier burst limit; the basic parser covered it. Upgrade the Groq plan or wait a minute |
| Generation slow | Raise the Railway instance size and set `ENGINE_SOLVER_WORKERS` to its vCPU count |
