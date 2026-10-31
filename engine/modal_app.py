"""Hosted engine on Modal (https://modal.com): the same FastAPI app, with real CPUs.

Deploy from the repo root:
    modal secret create cit-engine ENGINE_SHARED_SECRET=<same value as the web app>
    modal deploy engine/modal_app.py

Solver jobs run in background threads inside the process and are polled by id,
so the app is pinned to a single container (max_containers=1) that accepts
many concurrent requests; it scales to zero after 15 idle minutes.
"""

from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
CPUS = 4

image = (
    modal.Image.debian_slim(python_version="3.13")
    # Same versions as engine/uv.lock.
    .pip_install(
        "fastapi==0.162.0",
        "starlette==1.10.0",
        "ortools==9.15.6755",
        "pydantic==2.14.2",
        "uvicorn==0.54.0",
        "numpy==2.5.4",
        "protobuf==6.33.6",
        "pandas==3.1.0",
        "absl-py==2.5.1",
        "immutabledict==4.3.1",
    )
    .env(
        {
            "ENGINE_DEFAULT_DATASET": "/root/starter/data/cit_public.json",
            "ENGINE_SOLVER_WORKERS": str(CPUS),
            "ENGINE_JOB_WORKERS": "2",
        }
    )
    .add_local_file(ROOT / "starter/data/cit_public.json", "/root/starter/data/cit_public.json")
    .add_local_dir(ROOT / "engine/app", "/root/app")
)

app = modal.App("cit-engine", image=image)


@app.function(
    cpu=CPUS,
    memory=4096,
    secrets=[modal.Secret.from_name("cit-engine")],
    max_containers=1,
    scaledown_window=900,
    timeout=900,
)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def api():
    from app.main import app as fastapi_app

    return fastapi_app
