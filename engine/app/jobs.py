"""Tiny in-process background job runner for long solves.

Solves take tens of seconds, so the API returns a job id immediately and the
client polls ``GET /jobs/{id}``. Progress events from the solver callback are
kept on the job (latest first-class, history capped).
"""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

MAX_EVENTS = 200
MAX_JOBS = 100


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"  # queued | running | done | failed
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    progress: list[dict[str, Any]] = field(default_factory=list)
    result: Any = None
    error: str | None = None

    def public(self, include_result: bool = True) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "latest": self.progress[-1] if self.progress else None,
            "progress": self.progress[-50:],
            "result": self.result if include_result else None,
            "error": self.error,
        }


class JobRunner:
    def __init__(self, workers: int = 2):
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="solve")
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def submit(self, kind: str, fn: Callable[[Callable[[dict], None]], Any]) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], kind=kind)
        with self._lock:
            self._jobs[job.id] = job
            if len(self._jobs) > MAX_JOBS:
                for old in sorted(self._jobs.values(), key=lambda j: j.created_at)[: len(self._jobs) - MAX_JOBS]:
                    if old.status in ("done", "failed"):
                        self._jobs.pop(old.id, None)

        def report(event: dict) -> None:
            job.progress.append(event)
            if len(job.progress) > MAX_EVENTS:
                del job.progress[: len(job.progress) - MAX_EVENTS]

        def run() -> None:
            job.status = "running"
            job.started_at = time.time()
            try:
                job.result = fn(report)
                job.status = "done"
            except Exception as exc:  # surfaced to the client, never swallowed
                job.error = f"{type(exc).__name__}: {exc}"
                job.status = "failed"
                traceback.print_exc()
            finally:
                job.finished_at = time.time()

        self._pool.submit(run)
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)
