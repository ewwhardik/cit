"""Midsem exam scheduler (OR-Tools CP-SAT).

Each exam gets one (day, AM/PM) slot and one or more rooms whose *halved*
capacities add up to the exam size. Rooms must allow ``exam``; a room hosts
at most one exam per slot; a group sits at most one exam per slot.

Objective: 5 points per extra exam a group has on the same day (the scorer's
exam penalty), then a small cost per room used, so exams are packed into as
few rooms as possible.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from ortools.sat.python import cp_model

from .dataset import Dataset


@dataclass
class ExamResult:
    status: str
    rows: list[dict[str, Any]]
    penalty: int | None
    wall_time_s: float
    diagnostics: list[str]


def solve_exams(ds: Dataset, time_limit_s: float = 20.0, workers: int = 8, seed: int = 7) -> ExamResult:
    t0 = time.monotonic()
    exams = list(ds.exams.values())
    if not exams:
        return ExamResult("optimal", [], 0, 0.0, [])
    slots = [(d, s) for d in ds.exam_days for s in ds.exam_sessions]
    rooms = [r for r in ds.rooms.values() if "exam" in r.get("allowed_uses", [])]
    seats = {r["id"]: r["capacity"] // 2 for r in rooms}
    total_seats = sum(seats.values())
    diagnostics = [
        f"{e['id']}: {e['size']} students but all exam rooms together seat {total_seats} at half capacity"
        for e in exams
        if e["size"] > total_seats
    ]
    if diagnostics:
        return ExamResult("infeasible", [], None, time.monotonic() - t0, diagnostics)

    m = cp_model.CpModel()
    xs: dict[tuple[str, tuple], cp_model.IntVar] = {}
    use: dict[tuple[str, tuple, str], cp_model.IntVar] = {}
    for e in exams:
        eid = e["id"]
        for sl in slots:
            xs[(eid, sl)] = m.NewBoolVar(f"x[{eid},{sl}]")
            for r in rooms:
                v = m.NewBoolVar(f"u[{eid},{sl},{r['id']}]")
                use[(eid, sl, r["id"])] = v
                m.AddImplication(v, xs[(eid, sl)])
            m.Add(sum(seats[r["id"]] * use[(eid, sl, r["id"])] for r in rooms) >= e["size"] * xs[(eid, sl)])
        m.AddExactlyOne(xs[(eid, sl)] for sl in slots)

    for sl in slots:
        for r in rooms:
            m.AddAtMostOne(use[(e["id"], sl, r["id"])] for e in exams)

    by_group: dict[str, list[str]] = defaultdict(list)
    for e in exams:
        for g in e["groups"]:
            by_group[g].append(e["id"])
    penalty_terms = []
    for g, eids in by_group.items():
        for sl in slots:
            if len(eids) > 1:
                m.AddAtMostOne(xs[(eid, sl)] for eid in eids)
        for day in ds.exam_days:
            n = sum(xs[(eid, sl)] for eid in eids for sl in slots if sl[0] == day)
            extra = m.NewIntVar(0, len(eids), f"extra[{g},{day}]")
            m.Add(extra >= n - 1)
            penalty_terms.append(extra)

    m.Minimize(1000 * 5 * sum(penalty_terms) + sum(use.values()))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_workers = workers
    solver.parameters.random_seed = seed
    status = solver.Solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        msg = "Exam constraints conflict (groups x slots x room seats)." if status == cp_model.INFEASIBLE else "No exam timetable found in time."
        return ExamResult(solver.StatusName(status).lower(), [], None, time.monotonic() - t0, [msg])

    rows = []
    for e in exams:
        sl = next(sl for sl in slots if solver.Value(xs[(e["id"], sl)]))
        used = sorted(
            (r["id"] for r in rooms if solver.Value(use[(e["id"], sl, r["id"])])),
            key=lambda rid: -seats[rid],
        )
        rows.append({"exam_id": e["id"], "day": sl[0], "session": sl[1], "rooms": used})
    penalty = int(sum(solver.Value(t) for t in penalty_terms)) * 5
    return ExamResult(
        "optimal" if status == cp_model.OPTIMAL else "feasible", rows, penalty, time.monotonic() - t0, []
    )
