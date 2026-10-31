# Deploying CIT Scheduler

The full, current deployment guide (free tiers only, no credit card) is in the README:
[Hosting: what runs where, and why](README.md#hosting-what-runs-where-and-why) and [Deploy](README.md#deploy-free-no-card).

Summary:

| Part | Service |
| --- | --- |
| Web app (`web/`) | Vercel (Root Directory `web`) |
| Database | Neon (pooled connection string) |
| Engine, quick calls (`engine/`, Docker) | Render free web service (`engine/Dockerfile`, context `.`) |
| Engine, long solves | GitHub Actions: `.github/workflows/engine-relay.yml` |

Never commit keys. Set them only in each service's environment settings and in the
repository's Actions secrets (`ENGINE_SHARED_SECRET`) and variables (`RELAY_BASE_URL`).
