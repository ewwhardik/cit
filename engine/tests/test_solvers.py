"""Solver tests: every generated schedule must score 0 hard on the official validator."""

from __future__ import annotations

import copy
import random

import pytest

from app.checker import PlacementChecker, check_timetable, full_report
from app.dataset import Dataset
from app.exams import solve_exams
from app.export import build_schedule
from app.timetable import SolveOptions, solve_timetable


@pytest.fixture(scope="module")
def feasible(ds):
    res = solve_timetable(ds, SolveOptions(optimize=False, time_limit_s=60, workers=4))
    assert res.ok, res.diagnostics
    return res.assignment


@pytest.fixture(scope="module")
def exams(ds):
    res = solve_exams(ds, workers=4)
    assert res.status in ("optimal", "feasible"), res.diagnostics
    return res


def test_phase1_timetable_has_zero_hard_violations(official, raw_data, ds, feasible, exams):
    doc = build_schedule(ds, feasible, exams=exams.rows)
    report = official.run(copy.deepcopy(raw_data), copy.deepcopy(doc))
    assert report["hard_violation_count"] == 0, report["hard_violations"][:10]
    assert full_report(ds, doc)["hard_violation_count"] == 0


def test_exam_schedule_is_penalty_free(exams):
    assert exams.penalty == 0


def test_placement_checker_agrees_with_full_check(ds, feasible):
    """Random single moves: PlacementChecker says ok  <=>  the whole timetable stays clean."""
    rng = random.Random(3)
    sids = [s for s in ds.sessions if not ds.sessions[s].get("basket_slot")]
    rooms = list(ds.rooms)
    pc = PlacementChecker(ds, feasible)
    agree_ok = agree_bad = 0
    for _ in range(600):
        sid = rng.choice(sids)
        cand = (rng.choice(ds.days), rng.randint(1, 9 - ds.sessions[sid]["duration"] + 1),
                rng.choice(rooms) if rng.random() < 0.3 else feasible[sid][2])
        moved = dict(feasible)
        moved[sid] = cand
        clean = not check_timetable(ds, moved).violations
        blockers = pc.check(sid, *cand)
        assert clean == (not blockers), (sid, cand, [b.as_dict() for b in blockers])
        agree_ok += clean
        agree_bad += not clean
    assert agree_ok > 5 and agree_bad > 5


def test_infeasible_dataset_is_reported(raw_data):
    broken = copy.deepcopy(raw_data)
    broken["sessions"][0]["size"] = 10_000
    res = solve_timetable(Dataset(broken), SolveOptions(optimize=False, time_limit_s=5, workers=2))
    assert not res.ok
    assert any(broken["sessions"][0]["id"] in d for d in res.diagnostics)
