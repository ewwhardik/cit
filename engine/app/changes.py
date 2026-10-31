"""Evaluate structured change operations into a validated proposal.

The faculty AI assistant (and manual change requests) produce *operations*,
never schedules. This module checks each operation against the dataset,
turns it into change-file entries and/or move restrictions, and runs the
minimal-change repair. The result is the same proposal shape as a
disruption: a diff, a full checker report, or an explanation of why the
change is impossible. Nothing is applied here.

Supported operations::

    {"op": "mark_unavailable", "faculty_id": "F07", "days": ["THU"], "periods": [1,2,3,4,5], "reason": "..."}
    {"op": "room_unavailable", "room_id": "CR-102", "days": [...], "periods": [...], "reason": "..."}
    {"op": "move_session", "session_id": "CS291-P1", "days": ["FRI"], "starts": [6], "rooms": ["CS-LAB-2"]}
    {"op": "add_session", "session": {...full session...}}
    {"op": "add_session", "like_session_id": "CS202-T1", "id": "CS202-T3"}   # extra copy of an existing one
    {"op": "remove_session", "session_id": "HS201-H2-L2"}
"""

from __future__ import annotations

import copy
from typing import Any

from .checker import assignment_from_schedule
from .dataset import LAST_TEACHING_PERIOD, Dataset, apply_changes
from .explain import explain_session
from .repair import repair
from .timetable import ProgressFn

SESSION_FIELDS = ("id", "course_id", "kind", "groups", "faculty_id", "size", "duration", "room_types")


class OpError(ValueError):
    pass


def _check_days(ds: Dataset, days: Any, where: str) -> list[str]:
    if not isinstance(days, list) or not days:
        raise OpError(f"{where}: 'days' must be a non-empty list")
    bad = [d for d in days if d not in ds.day_index]
    if bad:
        raise OpError(f"{where}: unknown day(s) {bad}; use {ds.days}")
    return days


def _check_periods(periods: Any, where: str, last: int = LAST_TEACHING_PERIOD) -> list[int]:
    if not isinstance(periods, list) or not periods or not all(isinstance(p, int) and 1 <= p <= last for p in periods):
        raise OpError(f"{where}: 'periods' must be a list of integers 1..{last}")
    return periods


def compile_ops(ds: Dataset, ops: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, dict[str, Any]], list[str]]:
    """Validate ops -> (change file, restrictions, human-readable summary lines)."""
    changes: list[dict[str, Any]] = []
    restrict: dict[str, dict[str, Any]] = {}
    lines: list[str] = []
    known_sessions = set(ds.sessions)
    for i, op in enumerate(ops):
        kind = op.get("op")
        where = f"operation {i + 1} ({kind})"
        if kind == "mark_unavailable":
            fid = op.get("faculty_id")
            if fid not in ds.faculty:
                raise OpError(f"{where}: unknown faculty {fid!r}")
            days = _check_days(ds, op.get("days"), where)
            periods = _check_periods(op.get("periods"), where)
            changes.append({"type": "faculty_unavailable", "faculty_id": fid, "days": days, "periods": periods,
                            "reason": str(op.get("reason", ""))[:200]})
            lines.append(f"{fid} unavailable {', '.join(days)} P{min(periods)}–P{max(periods)}")
        elif kind == "room_unavailable":
            rid = op.get("room_id")
            if rid not in ds.rooms:
                raise OpError(f"{where}: unknown room {rid!r}")
            days = _check_days(ds, op.get("days"), where)
            periods = _check_periods(op.get("periods"), where)
            changes.append({"type": "room_unavailable", "room_id": rid, "days": days, "periods": periods,
                            "reason": str(op.get("reason", ""))[:200]})
            lines.append(f"{rid} closed {', '.join(days)} P{min(periods)}–P{max(periods)}")
        elif kind == "move_session":
            sid = op.get("session_id")
            if sid not in known_sessions:
                raise OpError(f"{where}: unknown session {sid!r}")
            r: dict[str, Any] = {}
            if op.get("days"):
                r["days"] = _check_days(ds, op["days"], where)
            if op.get("starts"):
                r["starts"] = _check_periods(op["starts"], where)
            if op.get("rooms"):
                bad = [x for x in op["rooms"] if x not in ds.rooms]
                if bad:
                    raise OpError(f"{where}: unknown room(s) {bad}")
                r["rooms"] = list(op["rooms"])
            if not r:
                raise OpError(f"{where}: say where to move it (days, starts and/or rooms)")
            restrict[sid] = r
            target = " ".join(filter(None, [
                "/".join(r.get("days", [])), "/".join(f"P{p}" for p in r.get("starts", [])), "/".join(r.get("rooms", []))
            ]))
            lines.append(f"move {sid} to {target}")
        elif kind == "add_session":
            if "session" in op:
                sess = copy.deepcopy(op["session"])
            elif op.get("like_session_id") in ds.sessions:
                sess = copy.deepcopy(ds.sessions[op["like_session_id"]])
                sess["id"] = op.get("id") or _next_id(known_sessions, sess["id"])
                sess["fixed_slot"] = None
            else:
                raise OpError(f"{where}: give a full 'session' or an existing 'like_session_id'")
            missing = [k for k in SESSION_FIELDS if k not in sess]
            if missing:
                raise OpError(f"{where}: session is missing {missing}")
            if sess["id"] in known_sessions:
                raise OpError(f"{where}: session id {sess['id']} already exists")
            if sess["faculty_id"] not in ds.faculty:
                raise OpError(f"{where}: unknown faculty {sess['faculty_id']!r}")
            unknown_groups = [g for g in sess["groups"] if g not in ds.groups]
            if unknown_groups:
                raise OpError(f"{where}: unknown group(s) {unknown_groups}")
            sess.setdefault("needs_accessible", False)
            sess.setdefault("basket_slot", None)
            sess.setdefault("fixed_slot", None)
            known_sessions.add(sess["id"])
            changes.append({"type": "add_session", "session": sess})
            if op.get("days") or op.get("starts"):
                restrict[sess["id"]] = {k: op[k] for k in ("days", "starts", "rooms") if op.get(k)}
            lines.append(f"add {sess['id']} ({sess['course_id']} {sess['kind']}, {sess['faculty_id']})")
        elif kind == "remove_session":
            sid = op.get("session_id")
            if sid not in known_sessions:
                raise OpError(f"{where}: unknown session {sid!r}")
            changes.append({"type": "remove_session", "session_id": sid})
            known_sessions.discard(sid)
            lines.append(f"remove {sid}")
        else:
            raise OpError(f"{where}: unknown operation {kind!r}")
    return {"changes": changes}, restrict, lines


def _next_id(existing: set[str], base: str) -> str:
    stem = base.rstrip("0123456789")
    n = 2
    while f"{stem}{n}" in existing:
        n += 1
    return f"{stem}{n}"


def evaluate_ops(
    ds: Dataset,
    baseline_doc: dict[str, Any],
    ops: list[dict[str, Any]],
    *,
    time_limit_s: float = 45.0,
    workers: int = 8,
    on_progress: ProgressFn | None = None,
) -> dict[str, Any]:
    try:
        change_file, restrict, lines = compile_ops(ds, ops)
    except OpError as exc:
        return {"status": "invalid", "diagnostics": [str(exc)], "ops_summary": []}
    ds_after = Dataset(apply_changes(ds.raw, change_file)) if change_file["changes"] else ds

    # Quick, specific answer for an impossible target before any solving.
    base, _ = assignment_from_schedule(baseline_doc)
    for sid, r in restrict.items():
        if sid not in base:
            continue
        trace = explain_session(ds_after, {k: v for k, v in base.items() if k != sid}, sid,
                                days=r.get("days"), starts=r.get("starts"))
        no_room_ok = r.get("rooms") and not set(r["rooms"]) & set(trace["suitable_rooms"])
        if no_room_ok:
            return {"status": "infeasible", "ops_summary": lines, "changes": change_file, "diagnostics": [
                f"{', '.join(r['rooms'])} cannot host {sid}: it needs a {'/'.join(ds_after.sessions[sid]['room_types'])} "
                f"with {ds_after.sessions[sid]['size']}+ seats."]}
        hard_blocked = {k: v for k, v in trace["blocked_by"].items() if k in ("H9", "H14", "H7", "H12")}
        if trace["checked_start_times"] and sum(hard_blocked.values()) == trace["checked_start_times"]:
            return {"status": "infeasible", "ops_summary": lines, "changes": change_file,
                    "diagnostics": [f"{sid} cannot move there: " + trace["summary"]], "trace": trace}

    result = repair(ds_after, baseline_doc, time_limit_s=time_limit_s, workers=workers,
                    on_progress=on_progress, restrict=restrict)
    result["ops_summary"] = lines
    result["changes"] = change_file
    return result
