"""Booking allocation and disruption repair, scored by the official validator."""

from __future__ import annotations

import copy

import pytest

from app.bookings import allocate_bookings, check_one, reservation_options
from app.dataset import Dataset, apply_changes
from app.exams import solve_exams
from app.export import build_schedule
from app.repair import repair
from app.timetable import SolveOptions, solve_timetable


@pytest.fixture(scope="module")
def pipeline(ds):
    tt = solve_timetable(ds, SolveOptions(time_limit_s=90, workers=4, event_options=reservation_options(ds)))
    assert tt.ok
    bk = allocate_bookings(ds, tt.assignment, workers=4)
    ex = solve_exams(ds, workers=4)
    doc = build_schedule(ds, tt.assignment, exams=ex.rows, fest_week=bk["fest_week"])
    return tt.assignment, bk, doc


def test_full_schedule_scores_clean_on_official_validator(official, raw_data, pipeline):
    _, _, doc = pipeline
    rep = official.run(copy.deepcopy(raw_data), copy.deepcopy(doc))
    assert rep["hard_violation_count"] == 0, rep["hard_violations"][:5]
    assert rep["bookings"]["priority_inversions"] == []
    assert rep["warnings"] == []  # every rejection / alternative has a reason
    assert rep["bookings"]["booking_score"] >= 65


def test_booking_traps_are_handled(pipeline):
    _, bk, _ = pipeline
    by_id = {d["request_id"]: d for d in bk["fest_week"]["bookings"]}
    assert by_id["BR-04"]["status"] == "rejected" and "Cancelled" in by_id["BR-04"]["reason"]
    assert by_id["BR-09"]["status"] == "rejected" and "1,200" in by_id["BR-09"]["reason"]
    assert by_id["BR-10"]["room_id"] != "SH-2"  # SH-2 is not accessible
    assert "capped" in by_id["BR-12"]["reason"] and "capped" in by_id["BR-15"]["reason"]
    assert "LHC-5" in by_id["BR-14"]["reason"]
    assert by_id["BR-16"]["room_id"] == "OAT"
    assert by_id["BR-17"]["status"] == "alternative_offered"


def test_check_one_rejects_oversized_and_flags_inaccessible(ds, pipeline):
    assign, bk, _ = pipeline
    existing = bk["fest_week"]["bookings"]
    big = {"id": "X", "role": "club", "requested_category": "club_event", "submitted_at": "z",
           "attendance": 5000, "duration_periods": 2, "windows": [{"day": "FRI", "from_period": 10, "to_period": 13}],
           "room_types": ["outdoor", "auditorium"], "needs": [], "mandatory_for_groups": []}
    assert check_one(ds, assign, existing, big)["status"] == "rejected"
    sh2 = {**big, "attendance": 60, "room_types": ["seminar_hall"], "needs": ["accessible"],
           "requested_room": "SH-2", "windows": [{"day": "MON", "from_period": 10, "to_period": 13}]}
    res = check_one(ds, assign, existing, sh2)
    assert res["status"] in ("approved", "alternative_offered") and res["room_id"] == "SH-1"
    assert "SH-2" in res["reason"]


def test_repair_moves_only_broken_sessions(official, raw_data, disruption, pipeline):
    _, _, doc = pipeline
    after_raw = apply_changes(raw_data, disruption)
    res = repair(Dataset(after_raw), doc, time_limit_s=60, workers=4)
    assert res["summary"]["hard_violations"] == 0
    rep = official.run(official.apply_disruption(copy.deepcopy(raw_data), disruption),
                       copy.deepcopy(res["schedule"]), copy.deepcopy(doc))
    assert rep["hard_violation_count"] == 0
    # Every broken session must move; nothing else should.
    broken_existing = [s for s in res["broken_before"] if s in {r["session_id"] for r in doc["sessions"]}]
    assert rep["stability"]["sessions_moved"] == len(broken_existing)
