"""Disruption handling: minimal-change repair and change proposals.

Given the approved baseline schedule and a change file, produce a proposal
that moves as few sessions as possible:

1. Apply the changes and find what the baseline now breaks.
2. If nothing is broken (and no session was added), the baseline stands.
3. Otherwise re-solve with every session hinted at its baseline placement
   and an objective of ``1000 * moved + 5 * time_changed + soft``, so a
   session is never moved to save a few soft points.
4. Re-check the Spectra-week bookings against the new timetable and
   re-allocate only if something they rely on changed.

The result is a *proposal*: a diff, the before/after soft penalty and a
full checker report. Nothing is applied until an Admin approves it in the
web app.
"""

from __future__ import annotations

import re
import time
from typing import Any

from .bookings import allocate_bookings, reservation_options
from .checker import (
    Assignment,
    assignment_from_schedule,
    check_bookings,
    check_timetable,
    full_report,
    soft_penalties,
)
from .dataset import Dataset
from .export import build_schedule
from .explain import explain_unplaceable
from .timetable import EventOption, ProgressFn, SolveOptions, solve_timetable


def broken_sessions(ds: Dataset, assign: Assignment) -> tuple[list[str], list[dict]]:
    """Sessions named in any hard violation of ``assign`` under ``ds``, and the violations."""
    violations = check_timetable(ds, assign).violations
    names = set()
    for v in violations:
        names |= _ids_in(v["detail"]) & set(ds.sessions)
    return sorted(names), violations


_ID = re.compile(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+")


def _ids_in(text: str) -> set[str]:
    return set(_ID.findall(text))


def diff_assignments(ds: Dataset, before: Assignment, after: Assignment) -> list[dict[str, Any]]:
    rows = []
    for sid in sorted(set(before) | set(after)):
        b, a = before.get(sid), after.get(sid)
        if b == a:
            continue
        sess = ds.sessions.get(sid, {})
        if b is None:
            kind = "added"
        elif a is None or sid not in ds.sessions:
            kind = "removed"
        elif b[:2] == a[:2]:
            kind = "room_only"
        else:
            kind = "time_changed"
        rows.append(
            {
                "session_id": sid,
                "kind": kind,
                "course_id": sess.get("course_id"),
                "faculty_id": sess.get("faculty_id"),
                "groups": sess.get("groups", []),
                "from": _slot(b),
                "to": _slot(a),
            }
        )
    order = {"added": 0, "removed": 1, "time_changed": 2, "room_only": 3}
    rows.sort(key=lambda r: (order[r["kind"]], r["session_id"]))
    return rows


def _slot(p) -> dict[str, Any] | None:
    if p is None:
        return None
    return {"day": p[0], "start_period": p[1], "room_id": p[2]}


def repair(
    ds_after: Dataset,
    baseline_doc: dict[str, Any],
    *,
    time_limit_s: float = 60.0,
    workers: int = 8,
    on_progress: ProgressFn | None = None,
    team: str | None = None,
    restrict: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Minimal-change repair. ``restrict`` forces sessions into given days/starts/rooms
    (e.g. a faculty request "move my lab to Friday")."""
    t0 = time.monotonic()
    restrict = {k: v for k, v in (restrict or {}).items() if k in ds_after.sessions}
    base_all, _ = assignment_from_schedule(baseline_doc)
    # Sessions removed by the change file disappear; everything else starts where it was.
    base = {sid: p for sid, p in base_all.items() if sid in ds_after.sessions}
    added = sorted(sid for sid in ds_after.sessions if sid not in base)
    removed = sorted(sid for sid in base_all if sid not in ds_after.sessions)
    broken, violations = broken_sessions(ds_after, base)
    unmet = sorted(sid for sid, r in restrict.items() if sid in base and not _satisfies(base[sid], r))

    if not broken and not added and not unmet:
        new_assign = dict(base)
        status = "unchanged"
        diagnostics: list[str] = []
    else:
        opts = SolveOptions(
            time_limit_s=time_limit_s,
            workers=workers,
            baseline=base,
            hint=base,
            optimize=True,
            event_options=_keep_bookings(ds_after, baseline_doc) or reservation_options(ds_after),
            restrict=restrict,
        )
        res = solve_timetable(ds_after, opts, on_progress=on_progress)
        if not res.ok:
            return {
                "status": "infeasible" if res.status == "infeasible" else res.status,
                "diagnostics": diagnose(ds_after, base, restrict, workers=workers, time_limit_s=min(30.0, time_limit_s))
                or res.diagnostics
                or ["No valid timetable satisfies the changed constraints."],
                "broken_before": broken,
                "violations_before": violations,
                "added": added,
                "removed": removed,
                "wall_time_s": round(time.monotonic() - t0, 2),
            }
        new_assign = res.assignment
        status = res.status
        diagnostics = res.diagnostics

    # Keep the Spectra-week decisions if they still hold; otherwise re-allocate.
    fest = baseline_doc.get("fest_week")
    fest_note = None
    if fest is not None:
        bv, _, _ = check_bookings(ds_after, new_assign, fest)
        if bv:
            fest = allocate_bookings(ds_after, new_assign, workers=workers)["fest_week"]
            fest_note = "Spectra-week bookings were re-allocated because the repaired timetable touched a booked room or group."

    doc = build_schedule(
        ds_after, new_assign, fest_week=fest, exams=baseline_doc.get("exams"),
        team=team or baseline_doc.get("team") or "CIT Crunch",
    )
    report = full_report(ds_after, doc, baseline_doc)
    soft_before = soft_penalties(ds_after, base)
    soft_after = soft_penalties(ds_after, new_assign)
    diff = diff_assignments(ds_after, base_all, new_assign)
    for row in diff:
        if row["kind"] == "added":
            row["why"] = "New session from the change file"
        elif row["kind"] == "removed":
            row["why"] = "Removed by the change file"
        elif row["session_id"] in restrict:
            row["why"] = "Requested move"
        elif row["session_id"] in broken:
            row["why"] = _why_moved(row["session_id"], violations)
        else:
            row["why"] = "Moved to make space for a directly affected session"
    return {
        "status": status,
        "schedule": doc,
        "report": report,
        "diff": diff,
        "summary": {
            "moved": report.get("stability", {}).get("sessions_moved", 0),
            "time_changed": report.get("stability", {}).get("time_changed", 0),
            "room_only": report.get("stability", {}).get("room_only_changed", 0),
            "added": len(added),
            "removed": len(removed),
            "hard_violations": report["hard_violation_count"],
            "soft_before": soft_before[1],
            "soft_after": soft_after[1],
            "soft_delta": soft_after[1] - soft_before[1],
        },
        "broken_before": broken,
        "violations_before": violations,
        "fest_note": fest_note,
        "diagnostics": diagnostics,
        "wall_time_s": round(time.monotonic() - t0, 2),
    }


def _satisfies(p, r: dict[str, Any]) -> bool:
    day, start, room = p
    return (
        (not r.get("days") or day in r["days"])
        and (not r.get("starts") or start in r["starts"])
        and (not r.get("rooms") or room in r["rooms"])
    )


def _keep_bookings(ds: Dataset, baseline_doc: dict[str, Any]) -> list[EventOption]:
    """Existing Spectra placements become fixed options worth keeping (but never worth a move)."""
    out = []
    for d in (baseline_doc.get("fest_week") or {}).get("bookings", []):
        if d.get("status") in ("approved", "alternative_offered") and d.get("room_id") in ds.rooms:
            req = ds.requests.get(d["request_id"], {})
            out.append(EventOption(
                key=d["request_id"], room_id=d["room_id"], day=d["day"], start=d["start_period"],
                end=d["end_period"], value=300, mandatory_groups=tuple(req.get("mandatory_for_groups", [])),
            ))
    return out


def diagnose(
    ds: Dataset, base: Assignment, restrict: dict[str, dict[str, Any]], *, workers: int, time_limit_s: float
) -> list[str]:
    """Explain an infeasible repair: which sessions cannot be placed, and what blocks them.

    Re-solves allowing sessions to stay unplaced at a large cost (fewest
    unplaced first, then fewest moves), then traces each unplaced session
    against the rest of that near-solution with :func:`explain_unplaceable`.
    """
    opts = SolveOptions(
        time_limit_s=time_limit_s, workers=workers, optimize=False, allow_unplaced=True,
        baseline=base, hint=base, restrict=restrict, feasibility_time_s=time_limit_s,
    )
    res = solve_timetable(ds, opts)
    if not res.ok:
        return []
    missing = sorted(sid for sid in ds.sessions if sid not in res.assignment)
    if not missing:
        return []
    out = [f"No valid fix exists: {len(missing)} session(s) cannot be placed without breaking a hard rule."]
    for sid in missing[:5]:
        r = restrict.get(sid, {})
        out.append(explain_unplaceable(ds, res.assignment, sid, days=r.get("days"), starts=r.get("starts")))
    return out


def _why_moved(sid: str, violations: list[dict]) -> str:
    rules = {"H7": "faculty now unavailable", "H8": "room now closed", "H4": "room clash",
             "H2": "faculty clash", "H3": "group clash", "H12": "faculty over daily limit",
             "H5": "room too small", "H6": "wrong room type", "H10": "room not accessible",
             "H14": "fixed slot", "H9": "invalid period", "H11": "basket out of sync", "H1": "not scheduled"}
    hits = [v for v in violations if sid in _ids_in(v["detail"])]
    if not hits:
        return "Directly affected by the change"
    return "; ".join(sorted({rules.get(v["rule"], v["rule"]) for v in hits})).capitalize() + f" ({hits[0]['detail']})"
