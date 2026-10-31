"""Oracle tests: our checker must agree exactly with the official validator.

Random schedules (valid-ish and deliberately broken) are scored by both
``starter/validator.py`` and ``app.checker.full_report``; the hard
violations, soft penalties, booking stats, exam penalty and stability
numbers must be identical.
"""

from __future__ import annotations

import copy
import random

import pytest

from app.checker import full_report
from app.dataset import Dataset, apply_changes

SEEDS = list(range(150))


def _violation_set(report: dict) -> set[tuple[str, str]]:
    return {(v["rule"], v["detail"]) for v in report["hard_violations"]}


def assert_same(official_report: dict, ours: dict) -> None:
    assert _violation_set(ours) == _violation_set(official_report)
    assert ours["hard_violation_count"] == official_report["hard_violation_count"]
    assert ours["hard_by_rule"] == official_report["hard_by_rule"]
    assert ours["soft_penalties"] == official_report["soft_penalties"]
    assert ours["soft_total"] == official_report["soft_total"]
    assert sorted(ours["warnings"]) == sorted(official_report["warnings"])
    for key in ("bookings", "exam_soft_penalty", "stability"):
        assert ours.get(key) == official_report.get(key), key


def random_schedule(raw: dict, rng: random.Random, *, noise: float) -> dict:
    """A random schedule. ``noise`` controls how often fields are deliberately broken."""
    rooms = [r["id"] for r in raw["rooms"]]
    days = raw["calendar"]["days"]
    rows = []
    for s in raw["sessions"]:
        if rng.random() < noise * 0.05:
            continue  # unscheduled
        ok_rooms = [r["id"] for r in raw["rooms"] if r["type"] in s["room_types"]] or rooms
        room = rng.choice(ok_rooms) if rng.random() > noise else rng.choice(rooms)
        if s["kind"] == "lab":
            start = rng.choice([2, 6]) if rng.random() > noise else rng.randint(1, 9)
        else:
            start = rng.randint(1, 9)
        day = rng.choice(days)
        if rng.random() < noise * 0.02:
            day = "SUN"
        if rng.random() < noise * 0.02:
            room = "NOPE-1"
        if rng.random() < noise * 0.02:
            start = 12
        rows.append({"session_id": s["id"], "day": day, "start_period": start, "room_id": room})
    if rows and rng.random() < noise:
        rows.append(copy.deepcopy(rng.choice(rows)))  # duplicate entry
    if rng.random() < noise * 0.3:
        rows.append({"session_id": "GHOST-1", "day": "MON", "start_period": 1, "room_id": rooms[0]})

    bookings = []
    cancelled = {c["request_id"] for c in raw.get("cancellations", [])}
    for req in raw["booking_requests"]:
        roll = rng.random()
        if roll < 0.1:
            continue  # no decision
        if roll < 0.35 or (req["id"] in cancelled and rng.random() < 0.5):
            bookings.append({"request_id": req["id"], "status": "rejected",
                             "reason": "" if rng.random() < 0.2 else "No room"})
            continue
        status = "approved" if rng.random() < 0.7 else "alternative_offered"
        if rng.random() < noise * 0.1:
            status = "maybe"
        w = rng.choice(req["windows"])
        dur = req["duration_periods"]
        a = rng.randint(w["from_period"], max(w["from_period"], w["to_period"] - dur + 1))
        if rng.random() < 0.3:
            a = rng.randint(1, 12)
        cands = [r["id"] for r in raw["rooms"] if r["type"] in req["room_types"]] or rooms
        room = rng.choice(cands) if rng.random() > 0.2 else rng.choice(rooms)
        day = w["day"] if rng.random() > 0.2 else rng.choice(days)
        b = a + dur - 1 if rng.random() > 0.1 else a + dur
        bookings.append({"request_id": req["id"], "status": status, "day": day,
                         "start_period": a, "end_period": b, "room_id": room,
                         "reason": "" if rng.random() < 0.3 else "auto"})
    if bookings and rng.random() < noise:
        bookings.append(copy.deepcopy(rng.choice(bookings)))

    overrides = []
    approved = [b for b in bookings if b.get("status") == "approved"]
    for _ in range(rng.randint(0, 3)):
        s = rng.choice(raw["sessions"])
        by = rng.choice(approved)["request_id"] if approved and rng.random() < 0.8 else "BR-404"
        overrides.append({"session_id": s["id"] if rng.random() > 0.1 else "GHOST-2",
                          "day": rng.choice(days), "start_period": rng.randint(1, 7),
                          "room_id": rng.choice(rooms), "displaced_by": by})

    exams = []
    exam_rooms = [r["id"] for r in raw["rooms"]]
    cal = raw["calendar"]["exam_week"]
    for e in raw["exams"]:
        if rng.random() < noise * 0.1:
            continue
        exams.append({"exam_id": e["id"], "day": rng.choice(cal["days"]),
                      "session": rng.choice([s["id"] for s in cal["sessions"]]),
                      "rooms": rng.sample(exam_rooms, rng.randint(1, 3))})
    if rng.random() < noise * 0.3:
        exams.append({"exam_id": "EX-NOPE", "day": "MON", "session": "AM", "rooms": []})
    if exams and rng.random() < noise * 0.3:
        exams.append(copy.deepcopy(exams[0]))
    if exams and rng.random() < noise * 0.3:
        exams[-1] = {**exams[-1], "day": "SUN"}

    sched = {"team": "oracle", "dataset_id": raw["dataset_id"], "sessions": rows, "exams": exams}
    if rng.random() > 0.1:
        sched["fest_week"] = {"bookings": bookings, "session_overrides": overrides}
    return sched


@pytest.mark.parametrize("seed", SEEDS)
def test_random_schedules_match_official(official, raw_data, seed):
    rng = random.Random(seed)
    sched = random_schedule(raw_data, rng, noise=rng.choice([0.0, 0.1, 0.5]))
    expected = official.run(copy.deepcopy(raw_data), copy.deepcopy(sched))
    ours = full_report(Dataset(raw_data), sched)
    assert_same(expected, ours)


@pytest.mark.parametrize("seed", SEEDS[:15])
def test_disruption_with_baseline_matches_official(official, raw_data, disruption, seed):
    rng = random.Random(1000 + seed)
    baseline = random_schedule(raw_data, rng, noise=0.0)
    after = copy.deepcopy(baseline)
    for row in after["sessions"]:
        if rng.random() < 0.15:
            row["day"] = rng.choice(raw_data["calendar"]["days"])
        elif rng.random() < 0.1:
            row["room_id"] = rng.choice(raw_data["rooms"])["id"]
    after["sessions"].append({"session_id": "CS202-T2", "day": "TUE", "start_period": 3, "room_id": "CR-101"})
    if rng.random() < 0.5:
        after.pop("exams")

    official_data = official.apply_disruption(copy.deepcopy(raw_data), disruption)
    ours_data = apply_changes(raw_data, disruption)
    assert ours_data == official_data

    expected = official.run(official_data, copy.deepcopy(after), copy.deepcopy(baseline))
    ours = full_report(Dataset(ours_data), after, baseline)
    assert_same(expected, ours)


def test_effective_category_matches_official(official, raw_data, ds):
    for req in raw_data["booking_requests"]:
        assert ds.effective_category(req) == official.effective_category(raw_data, req)
        for other in raw_data["booking_requests"]:
            assert ds.outranks(req, other) == official.outranks(raw_data, req, other)
