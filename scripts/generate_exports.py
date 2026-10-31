#!/usr/bin/env python3
"""Produce exports/schedule.json and exports/schedule_after.json through the app's API.

Nothing here edits a schedule: the script only calls the running engine
service (the same endpoints the web app uses) and writes what it returns.
The export endpoint refuses any schedule with a hard violation.

    ENGINE_URL=http://localhost:8000 python scripts/generate_exports.py

Standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def call(base: str, method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base.rstrip("/") + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if os.environ.get("ENGINE_SHARED_SECRET"):
        req.add_header("X-Engine-Secret", os.environ["ENGINE_SHARED_SECRET"])
    try:
        with urllib.request.urlopen(req, timeout=900) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        sys.exit(f"{method} {path} failed ({exc.code}): {exc.read().decode()[:2000]}")


def wait(base: str, job_id: str) -> dict:
    last = None
    while True:
        job = call(base, "GET", f"/jobs/{job_id}")
        latest = job.get("latest")
        if latest and latest != last:
            print("   ", latest)
            last = latest
        if job["status"] == "done":
            return job["result"]
        if job["status"] == "failed":
            sys.exit(f"Job {job_id} failed: {job['error']}")
        time.sleep(2)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--engine", default=os.environ.get("ENGINE_URL", "http://localhost:8000"))
    ap.add_argument("--data", default=str(ROOT / "starter" / "data" / "cit_public.json"))
    ap.add_argument("--changes", default=str(ROOT / "starter" / "examples" / "sample_disruption.json"))
    ap.add_argument("--out", default=str(ROOT / "exports"))
    ap.add_argument("--time-limit", type=float, default=120)
    a = ap.parse_args()

    dataset = json.loads(Path(a.data).read_text(encoding="utf-8"))
    changes = json.loads(Path(a.changes).read_text(encoding="utf-8"))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    print("engine:", call(a.engine, "GET", "/health"))

    print("1/2 generating timetable, exams and Spectra bookings ...")
    gen = wait(a.engine, call(a.engine, "POST", "/pipeline/generate",
                              {"dataset": dataset, "time_limit_s": a.time_limit})["job_id"])
    if not gen.get("schedule"):
        sys.exit(f"Generation failed: {gen.get('status')} {gen.get('diagnostics')}")
    exported = call(a.engine, "POST", "/export", {"dataset": dataset, "schedule": gen["schedule"]})
    schedule = exported["schedule"]
    (out / "schedule.json").write_text(json.dumps(schedule, indent=2) + "\n", encoding="utf-8")
    r = exported["report"]
    print(f"   schedule.json: hard {r['hard_violation_count']}, soft {r['soft_total']}, "
          f"booking score {r['bookings']['booking_score']}, exam penalty {r.get('exam_soft_penalty')}")

    print("2/2 applying the change file and repairing with minimal moves ...")
    rep = wait(a.engine, call(a.engine, "POST", "/disruptions/repair",
                              {"dataset": dataset, "changes": changes, "baseline": schedule,
                               "time_limit_s": a.time_limit})["job_id"])
    if not rep.get("schedule"):
        sys.exit(f"Repair failed: {rep.get('status')} {rep.get('diagnostics')}")
    exported = call(a.engine, "POST", "/export",
                    {"dataset": dataset, "changes": changes, "schedule": rep["schedule"], "baseline": schedule})
    (out / "schedule_after.json").write_text(json.dumps(exported["schedule"], indent=2) + "\n", encoding="utf-8")
    r = exported["report"]
    print(f"   schedule_after.json: hard {r['hard_violation_count']}, soft {r['soft_total']}, "
          f"moved {r['stability']['sessions_moved']} ({r['stability']['time_changed']} time, "
          f"{r['stability']['room_only_changed']} room only)")


if __name__ == "__main__":
    main()
