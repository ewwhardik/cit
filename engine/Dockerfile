# Scheduling engine: FastAPI + OR-Tools. Build from the repo root:
#   docker build -f engine/Dockerfile -t cit-engine .
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
WORKDIR /app/engine
COPY engine/pyproject.toml engine/uv.lock engine/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY engine/app ./app
COPY starter/data/cit_public.json /app/starter/data/cit_public.json
ENV ENGINE_DEFAULT_DATASET=/app/starter/data/cit_public.json \
    ENGINE_SOLVER_WORKERS=8 \
    PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uv run --no-dev uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
