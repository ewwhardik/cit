"""Explanations, structured change evaluation, infeasibility diagnosis, session overrides."""

from __future__ import annotations

import copy
import json

import pytest

from app.bookings import allocate_bookings
from app.changes import compile_ops, evaluate_ops, OpError
from app.checker import assignment_from_schedule, check_timetable, full_report
from app.dataset import Dataset, apply_changes
from app.explain import explain_session
from app.repair import repair

from .conftest import REPO


@pytest.fixture(scope="module")
def baseline():
    return json.loads((REPO / "exports" / "schedule.json").read_text())


def test_explain_counts_every_start_time(ds, baseline):
    a, _ = assignment_from_schedule(baseline)
    f = explain_session(ds, a, "CS203-L1")
    assert f["checked_start_times"] == sum(f["blocked_by"].values()) + f["free_start_times"]
    assert f["summary"].startswith("CS203-L1")
    # Every option offered really is valid when applied.
    for o in f["options"]:
        moved = dict(a)
        moved["CS203-L1"] = (o["day"], o["start_period"], o["room_id"])
        assert not check_timetable(ds, moved).violations


def test_explain_reports_unavailability(ds, baseline):
    a, _ = assignment_from_schedule(baseline)
    f = explain_session(ds, a, "ID101-ALL-L1")
    assert f["blocked_by"].get("H7", 0) > 0
    assert "F37" in f["summary"]


def test_compile_ops_rejects_bad_input(ds):
    with pytest.raises(OpError):
        compile_ops(ds, [{"op": "mark_unavailable", "faculty_id": "F999", "days": ["MON"], "periods": [1]}])
    with pytest.raises(OpError):
        compile_ops(ds, [{"op": "move_session", "session_id": "CS203-L1"}])
    with pytest.raises(OpError):
        compile_ops(ds, [{"op": "drop_table"}])


def test_move_request_produces_valid_minimal_proposal(official, raw_data, ds, baseline):
    ops = [{"op": "mark_unavailable", "faculty_id": "F07", "days": ["THU"], "periods": [1, 2, 3, 4, 5]},
           {"op": "move_session", "session_id": "CS203-L1", "days": ["FRI"]}]
    res = evaluate_ops(ds, baseline, ops, time_limit_s=40, workers=4)
    assert res["status"] in ("optimal", "feasible"), res.get("diagnostics")
    a, _ = assignment_from_schedule(res["schedule"])
    assert a["CS203-L1"][0] == "FRI"
    changed = apply_changes(raw_data, res["changes"])
    rep = official.run(changed, copy.deepcopy(res["schedule"]), copy.deepcopy(baseline))
    assert rep["hard_violation_count"] == 0
    assert rep["stability"]["sessions_moved"] <= 4


def test_impossible_move_is_explained(ds, baseline):
    # F37 (ID101) is only free MON/WED/FRI P3-5: Tuesday is impossible.
    res = evaluate_ops(ds, baseline, [{"op": "move_session", "session_id": "ID101-ALL-L1", "days": ["TUE"]}],
                       time_limit_s=20, workers=4)
    assert res["status"] == "infeasible"
    assert "F37" in " ".join(res["diagnostics"])


def test_infeasible_repair_names_the_conflict(raw_data, baseline):
    changes = {"changes": [{"type": "faculty_unavailable", "faculty_id": "F37", "days": ["MON", "WED", "FRI"],
                            "periods": [1, 2, 3, 4, 5, 6, 7, 8, 9]}]}
    res = repair(Dataset(apply_changes(raw_data, changes)), baseline, time_limit_s=20, workers=4)
    assert res["status"] == "infeasible"
    text = " ".join(res["diagnostics"])
    assert "ID101-ALL-L1" in text and "unavailab" in text


def test_institute_event_displaces_a_class_validly(official, raw_data, baseline):
    a, _ = assignment_from_schedule(baseline)
    busy = {(v[2], v[0], q) for k, v in a.items() for q in range(v[1], v[1] + 1)}
    day, p = next((d, q) for d in ("MON", "TUE", "WED", "THU", "FRI") for q in range(1, 10)
                  if ("LH-1", d, q) in busy and ("LH-2", d, q) in busy)
    raw2 = copy.deepcopy(raw_data)
    raw2["booking_requests"].append({
        "id": "BR-99", "submitted_at": "2027-01-19T09:00:00+05:30", "requester": "Dean", "role": "admin",
        "department": None, "requested_category": "institute_event", "title": "Convocation rehearsal",
        "attendance": 180, "duration_periods": 1, "windows": [{"day": day, "from_period": p, "to_period": p}],
        "room_types": ["lecture_hall"], "needs": ["pa_system"], "requested_room": "LH-1",
        "mandatory_for_groups": [], "series_id": None})
    ds2 = Dataset(raw2)
    res = allocate_bookings(ds2, a, workers=4)
    br99 = next(d for d in res["fest_week"]["bookings"] if d["request_id"] == "BR-99")
    assert br99["status"] == "approved"
    assert any(o["displaced_by"] == "BR-99" for o in res["fest_week"]["session_overrides"])
    doc = {**baseline, "fest_week": res["fest_week"]}
    rep = official.run(raw2, copy.deepcopy(doc))
    assert rep["hard_violation_count"] == 0, rep["hard_violations"][:3]
    assert full_report(ds2, doc)["hard_violation_count"] == 0
