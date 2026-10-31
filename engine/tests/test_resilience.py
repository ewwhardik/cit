"""Resilience scan: scenarios come from real load, and each one is repaired by the engine."""

from __future__ import annotations

import json

from app.dataset import Dataset, load_json
from app.resilience import _scenarios, resilience_scan

from .conftest import DATA_PATH, REPO

BASELINE = REPO / "exports" / "schedule.json"


def test_scenarios_target_the_busiest_day():
    raw = load_json(DATA_PATH)
    base = json.loads(BASELINE.read_text())
    scs = _scenarios(Dataset(raw), base, limit=10)
    assert len(scs) == 10
    assert scs == sorted(scs, key=lambda s: -s["load"])
    for s in scs:
        assert s["change"]["days"] == [s["day"]]
        assert s["kind"] in ("faculty_leave", "room_closed")


def test_one_scenario_is_repaired_without_hard_violations():
    raw = load_json(DATA_PATH)
    base = json.loads(BASELINE.read_text())
    out = resilience_scan(raw, base, per_scenario_s=30, limit=1, workers=4)
    assert out["summary"]["total"] == 1
    row = out["scenarios"][0]
    assert row["ok"], row
    assert row["moved"] > 0
