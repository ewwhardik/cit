"""FastAPI entry point for the scheduling engine.

The engine is stateless: every request carries the dataset (starter-pack
format) and, where relevant, a change file and the current schedule. The web
app owns persistence, users and workflow.

Auth: when ``ENGINE_SHARED_SECRET`` is set, every request except ``/health``
must send it in the ``X-Engine-Secret`` header.
"""

from __future__ import annotations

import os
import secrets
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import __version__
from .checker import PlacementChecker, assignment_from_schedule, full_report
from .dataset import ChangeFileError, Dataset, apply_changes, load_json
from .exams import solve_exams
from .export import ExportRefused, build_schedule, export_checked
from .jobs import JobRunner
from .timetable import SolveOptions, solve_timetable

DEFAULT_DATASET = Path(
    os.environ.get(
        "ENGINE_DEFAULT_DATASET",
        Path(__file__).resolve().parents[2] / "starter" / "data" / "cit_public.json",
    )
)
SOLVER_WORKERS = int(os.environ.get("ENGINE_SOLVER_WORKERS", "8"))

app = FastAPI(title="CIT scheduling engine", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ENGINE_CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
jobs = JobRunner(workers=int(os.environ.get("ENGINE_JOB_WORKERS", "2")))


def require_secret(x_engine_secret: str | None = Header(default=None)) -> None:
    expected = os.environ.get("ENGINE_SHARED_SECRET")
    if expected and not (x_engine_secret and secrets.compare_digest(x_engine_secret, expected)):
        raise HTTPException(status_code=401, detail="Missing or wrong X-Engine-Secret")


@lru_cache(maxsize=1)
def _default_dataset() -> dict[str, Any]:
    return load_json(DEFAULT_DATASET)


# ------------------------------------------------------------------ models
class DatasetInput(BaseModel):
    """Dataset (starter-pack format) plus an optional change file applied on top."""

    dataset: dict[str, Any] | None = Field(default=None, description="Omit to use the bundled public dataset")
    changes: dict[str, Any] | None = Field(default=None, description="Change file: {changes: [...]}")

    def build(self) -> Dataset:
        raw = self.dataset or _default_dataset()
        for key in ("calendar", "rooms", "faculty", "sessions"):
            if key not in raw:
                raise HTTPException(status_code=422, detail=f"Dataset is missing '{key}'")
        if self.changes:
            try:
                raw = apply_changes(raw, self.changes)
            except ChangeFileError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        return Dataset(raw)


class SolveRequest(DatasetInput):
    time_limit_s: float = Field(default=60.0, ge=2, le=600)
    optimize: bool = True
    seed: int = 7
    baseline: dict[str, Any] | None = Field(default=None, description="schedule.json to stay close to")


class CheckRequest(DatasetInput):
    schedule: dict[str, Any]
    baseline: dict[str, Any] | None = None


class CheckMoveRequest(DatasetInput):
    schedule: dict[str, Any] = Field(description="Current schedule; only `sessions` is used")
    session_id: str
    day: str
    start_period: int
    room_id: str


class ExamRequest(DatasetInput):
    time_limit_s: float = Field(default=20.0, ge=2, le=300)


class GenerateRequest(DatasetInput):
    time_limit_s: float = Field(default=90.0, ge=5, le=600)
    seed: int = 7
    team: str = "CIT Crunch"


# ------------------------------------------------------------------ routes
@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "version": __version__, "solver_workers": SOLVER_WORKERS}


@app.post("/timetable/solve", dependencies=[Depends(require_secret)])
def timetable_solve(req: SolveRequest) -> dict[str, Any]:
    ds = req.build()
    baseline = assignment_from_schedule(req.baseline)[0] if req.baseline else None
    opts = SolveOptions(
        time_limit_s=req.time_limit_s, optimize=req.optimize, seed=req.seed,
        workers=SOLVER_WORKERS, baseline=baseline,
    )

    def run(report):
        res = solve_timetable(ds, opts, on_progress=report)
        doc = build_schedule(ds, res.assignment) if res.ok else None
        return {
            "status": res.status,
            "schedule": doc,
            "objective": res.objective,
            "wall_time_s": round(res.wall_time_s, 2),
            "diagnostics": res.diagnostics,
            "stats": res.stats,
            "report": full_report(ds, doc) if doc else None,
        }

    job = jobs.submit("timetable", run)
    return {"job_id": job.id}


@app.post("/pipeline/generate", dependencies=[Depends(require_secret)])
def pipeline_generate(req: GenerateRequest) -> dict[str, Any]:
    """Timetable + exams in one background job; returns a full schedule.json and its report."""
    ds = req.build()
    opts = SolveOptions(time_limit_s=req.time_limit_s, seed=req.seed, workers=SOLVER_WORKERS)

    def run(report):
        tt = solve_timetable(ds, opts, on_progress=report)
        if not tt.ok:
            return {"status": tt.status, "diagnostics": tt.diagnostics, "schedule": None, "report": None}
        report({"phase": "exams", "elapsed_s": round(tt.wall_time_s, 2)})
        ex = solve_exams(ds, workers=SOLVER_WORKERS)
        doc = build_schedule(ds, tt.assignment, exams=ex.rows, team=req.team)
        return {
            "status": tt.status if ex.status in ("optimal", "feasible") else ex.status,
            "schedule": doc,
            "report": full_report(ds, doc),
            "diagnostics": tt.diagnostics + ex.diagnostics,
            "stats": {**tt.stats, "exam_status": ex.status, "exam_penalty": ex.penalty},
        }

    job = jobs.submit("generate", run)
    return {"job_id": job.id}


@app.get("/jobs/{job_id}", dependencies=[Depends(require_secret)])
def job_status(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job")
    return job.public()


@app.post("/timetable/check", dependencies=[Depends(require_secret)])
def timetable_check(req: CheckRequest) -> dict[str, Any]:
    return full_report(req.build(), req.schedule, req.baseline)


@app.post("/timetable/check-move", dependencies=[Depends(require_secret)])
def timetable_check_move(req: CheckMoveRequest) -> dict[str, Any]:
    ds = req.build()
    if req.session_id not in ds.sessions:
        raise HTTPException(status_code=404, detail=f"Unknown session {req.session_id}")
    assign, _ = assignment_from_schedule(req.schedule)
    blockers = PlacementChecker(ds, assign).check(req.session_id, req.day, req.start_period, req.room_id)
    return {"ok": not blockers, "blockers": [b.as_dict() for b in blockers]}


@app.post("/exams/solve", dependencies=[Depends(require_secret)])
def exams_solve(req: ExamRequest) -> dict[str, Any]:
    ds = req.build()
    res = solve_exams(ds, time_limit_s=req.time_limit_s, workers=SOLVER_WORKERS)
    return {"status": res.status, "exams": res.rows, "penalty": res.penalty,
            "wall_time_s": round(res.wall_time_s, 2), "diagnostics": res.diagnostics}


class ExportRequest(CheckRequest):
    kind: Literal["schedule", "schedule_after"] = "schedule"


@app.post("/export", dependencies=[Depends(require_secret)])
def export(req: ExportRequest) -> dict[str, Any]:
    ds = req.build()
    try:
        schedule, report = export_checked(ds, req.schedule, req.baseline)
    except ExportRefused as exc:
        raise HTTPException(
            status_code=422,
            detail={"message": str(exc), "report": exc.report},
        ) from exc
    return {"schedule": schedule, "report": report}
