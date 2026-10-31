"""Run one relayed engine job on a GitHub Actions runner (see .github/workflows/engine-relay.yml).

Fetches the request from the web app, runs it on the engine started locally
on this runner, and streams the job state back until it finishes. Standard
library only, so it needs nothing beyond the engine's own environment.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

ENGINE = os.environ.get("ENGINE_LOCAL_URL", "http://127.0.0.1:8000")
SECRET = os.environ["ENGINE_SHARED_SECRET"]
BASE = os.environ["RELAY_BASE_URL"].rstrip("/")
JOB = os.environ["RELAY_JOB_ID"]
CALLBACK = f"{BASE}/api/relay/{JOB}"


def http(url: str, body: object | None = None, timeout: float = 60) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method="GET" if body is None else "POST",
        headers={"Content-Type": "application/json", "X-Engine-Secret": SECRET},
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read() or b"{}")


def report(state: dict) -> None:
    for attempt in range(3):
        try:
            http(CALLBACK, state)
            return
        except (urllib.error.URLError, TimeoutError) as exc:
            print(f"callback failed ({exc}); retry {attempt + 1}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def main() -> int:
    for _ in range(90):
        try:
            http(f"{ENGINE}/health", timeout=3)
            break
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(1)
    else:
        report({"status": "failed", "error": "Engine did not start on the runner", "latest": None,
                "progress": [], "result": None, "id": JOB, "kind": "relay"})
        return 1

    job = http(CALLBACK)
    print(f"running {job['path']}")
    started = http(f"{ENGINE}{job['path']}", job["body"], timeout=120)
    engine_job = started["job_id"]

    last = None
    while True:
        state = http(f"{ENGINE}/jobs/{engine_job}", timeout=30)
        state["id"] = f"relay:{JOB}"
        marker = (state.get("status"), json.dumps(state.get("latest"), sort_keys=True))
        if marker != last or state["status"] in ("done", "failed"):
            report(state)
            last = marker
        if state["status"] in ("done", "failed"):
            print(f"finished: {state['status']}")
            return 0 if state["status"] == "done" else 1
        time.sleep(2)


if __name__ == "__main__":
    sys.exit(main())
