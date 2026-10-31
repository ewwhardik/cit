"""API smoke tests (no long solves)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["ok"]


def test_check_reports_unscheduled_sessions():
    r = client.post("/timetable/check", json={"schedule": {"dataset_id": "cit-public-v1", "sessions": []}})
    assert r.status_code == 200
    body = r.json()
    assert body["hard_by_rule"]["H1"] == 189


def test_export_refuses_hard_violations():
    r = client.post("/export", json={"schedule": {"sessions": []}})
    assert r.status_code == 422
    assert r.json()["detail"]["report"]["hard_violation_count"] > 0


def test_check_move_flags_lunch_and_capacity():
    r = client.post("/timetable/check-move", json={
        "schedule": {"sessions": []}, "session_id": "ID101-ALL-L1",
        "day": "MON", "start_period": 5, "room_id": "CR-101"})
    rules = {b["rule"] for b in r.json()["blockers"]}
    assert "H5" in rules


def test_bad_change_file_is_422():
    r = client.post("/timetable/check", json={
        "schedule": {"sessions": []}, "changes": {"changes": [{"type": "explode"}]}})
    assert r.status_code == 422


def test_secret_enforced(monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", "s3cret")
    assert client.post("/timetable/check", json={"schedule": {}}).status_code == 401
    ok = client.post("/timetable/check", json={"schedule": {}}, headers={"X-Engine-Secret": "s3cret"})
    assert ok.status_code == 200
