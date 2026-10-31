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
from .bookings import allocate_bookings, check_one, reservation_options
from .checker import PlacementChecker, assignment_from_schedule, full_report
from .dataset import ChangeFileError, Dataset, apply_changes, load_json
from .exams import solve_exams
from .export import ExportRefused, build_schedule, export_checked
from .jobs import JobRunner
from .changes import evaluate_ops
from .explain import explain_session
from .repair import repair
from .resilience import resilience_scan
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
    reserve_for_bookings: bool = True


class BookingsRequest(DatasetInput):
    schedule: dict[str, Any] = Field(description="Timetable to allocate around (sessions, optional fest_week overrides)")


class CheckOneRequest(BookingsRequest):
    request: dict[str, Any] = Field(description="A booking request in the dataset's booking_requests format")


class RepairRequest(DatasetInput):
    baseline: dict[str, Any] = Field(description="The approved schedule.json before the change")
    time_limit_s: float = Field(default=60.0, ge=5, le=600)


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
    opts = SolveOptions(
        time_limit_s=req.time_limit_s, seed=req.seed, workers=SOLVER_WORKERS,
        event_options=reservation_options(ds) if req.reserve_for_bookings else [],
    )

    def run(report):
        tt = solve_timetable(ds, opts, on_progress=report)
        if not tt.ok:
            return {"status": tt.status, "diagnostics": tt.diagnostics, "schedule": None, "report": None}
        report({"phase": "exams", "elapsed_s": round(tt.wall_time_s, 2)})
        ex = solve_exams(ds, workers=SOLVER_WORKERS)
        report({"phase": "bookings", "elapsed_s": round(tt.wall_time_s, 2)})
        bk = allocate_bookings(ds, tt.assignment, workers=SOLVER_WORKERS)
        doc = build_schedule(ds, tt.assignment, exams=ex.rows, fest_week=bk["fest_week"], team=req.team)
        return {
            "status": tt.status if ex.status in ("optimal", "feasible") else ex.status,
            "schedule": doc,
            "report": full_report(ds, doc),
            "decisions": bk["decisions"],
            "diagnostics": tt.diagnostics + ex.diagnostics,
            "stats": {**tt.stats, "exam_status": ex.status, "exam_penalty": ex.penalty,
                      "booking_solver": bk["solver_status"]},
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


def _week_assignment(schedule: dict[str, Any]):
    assign, _ = assignment_from_schedule(schedule)
    for ov in (schedule.get("fest_week") or {}).get("session_overrides", []):
        assign[ov["session_id"]] = (ov["day"], ov["start_period"], ov["room_id"])
    return assign


@app.post("/bookings/allocate", dependencies=[Depends(require_secret)])
def bookings_allocate(req: BookingsRequest) -> dict[str, Any]:
    ds = req.build()
    return allocate_bookings(ds, _week_assignment(req.schedule), workers=SOLVER_WORKERS)


REQUIRED_REQUEST_FIELDS = ("attendance", "duration_periods", "windows", "room_types")


@app.post("/bookings/check-one", dependencies=[Depends(require_secret)])
def bookings_check_one(req: CheckOneRequest) -> dict[str, Any]:
    ds = req.build()
    missing = [k for k in REQUIRED_REQUEST_FIELDS if not req.request.get(k)]
    if missing:
        raise HTTPException(status_code=422, detail=f"Request is missing {', '.join(missing)}")
    booking = {"id": "NEW", "needs": [], "mandatory_for_groups": [], "role": "club",
               "requested_category": "club_event", "submitted_at": "9999", **req.request}
    existing = (req.schedule.get("fest_week") or {}).get("bookings", [])
    return check_one(ds, _week_assignment(req.schedule), existing, booking)


@app.post("/disruptions/repair", dependencies=[Depends(require_secret)])
def disruptions_repair(req: RepairRequest) -> dict[str, Any]:
    if not req.changes:
        raise HTTPException(status_code=422, detail="A change file is required")
    ds = req.build()

    def run(report):
        return repair(ds, req.baseline, time_limit_s=req.time_limit_s, workers=SOLVER_WORKERS, on_progress=report)

    job = jobs.submit("repair", run)
    return {"job_id": job.id}


class ResilienceRequest(DatasetInput):
    baseline: dict[str, Any] = Field(description="Current approved schedule.json")
    per_scenario_s: float = Field(default=40.0, ge=5, le=120)
    limit: int = Field(default=16, ge=1, le=60)


@app.post("/analysis/resilience", dependencies=[Depends(require_secret)])
def analysis_resilience(req: ResilienceRequest) -> dict[str, Any]:
    """Simulate losing each busy teacher/room for a day and repair each case (analysis only, nothing applied)."""
    raw = req.dataset or _default_dataset()
    if req.changes:
        raw = apply_changes(raw, req.changes)

    def run(report):
        return resilience_scan(raw, req.baseline, per_scenario_s=req.per_scenario_s, limit=req.limit,
                               workers=SOLVER_WORKERS, on_progress=report)

    job = jobs.submit("resilience", run)
    return {"job_id": job.id}


class ExplainRequest(DatasetInput):
    schedule: dict[str, Any]
    session_id: str
    week7: bool = Field(default=False, description="Explain against the Week-7 view (with session overrides)")


@app.post("/timetable/explain", dependencies=[Depends(require_secret)])
def timetable_explain(req: ExplainRequest) -> dict[str, Any]:
    """Slot-by-slot trace for one session: what blocks each start time, the best alternatives."""
    ds = req.build()
    if req.session_id not in ds.sessions:
        raise HTTPException(status_code=404, detail=f"Unknown session {req.session_id}")
    assign = _week_assignment(req.schedule) if req.week7 else assignment_from_schedule(req.schedule)[0]
    return explain_session(ds, assign, req.session_id)


class EvaluateRequest(DatasetInput):
    baseline: dict[str, Any] = Field(description="Current approved schedule.json")
    ops: list[dict[str, Any]] = Field(description="Structured change operations (see app/changes.py)")
    time_limit_s: float = Field(default=45.0, ge=5, le=300)


@app.post("/changes/evaluate", dependencies=[Depends(require_secret)])
def changes_evaluate(req: EvaluateRequest) -> dict[str, Any]:
    """Validate structured ops (from the AI assistant or a manual request) into a proposal job."""
    ds = req.build()

    def run(report):
        return evaluate_ops(ds, req.baseline, req.ops, time_limit_s=req.time_limit_s,
                            workers=SOLVER_WORKERS, on_progress=report)

    job = jobs.submit("evaluate", run)
    return {"job_id": job.id}
