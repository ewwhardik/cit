"""Resilience scan: how well does the current timetable absorb likely disruptions?

For the most loaded faculty members and rooms, simulate losing them for their
busiest teaching day and run the real minimal-change repair on each scenario.
The result says, per scenario, whether a clash-free fix exists and how many
sessions it would move. Nothing is applied; this is analysis only.
"""

from __future__ import annotations

import time
from collections import Counter
from typing import Any, Callable

from .checker import assignment_from_schedule
from .dataset import Dataset, apply_changes
from .repair import repair

ProgressFn = Callable[[dict], None]
ALL_DAY = list(range(1, 10))


def _scenarios(ds: Dataset, baseline: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    assign, _ = assignment_from_schedule(baseline)
    fac_day: Counter[tuple[str, str]] = Counter()
    room_day: Counter[tuple[str, str]] = Counter()
    for sid, (day, _start, room) in assign.items():
        sess = ds.sessions.get(sid)
        if not sess:
            continue
        fac_day[(sess["faculty_id"], day)] += sess["duration"]
        room_day[(room, day)] += sess["duration"]

    def busiest(counter: Counter[tuple[str, str]]) -> list[tuple[str, str, int]]:
        best: dict[str, tuple[str, int]] = {}
        for (who, day), hours in counter.items():
            if hours > best.get(who, ("", -1))[1]:
                best[who] = (day, hours)
        return sorted(((w, d, h) for w, (d, h) in best.items()), key=lambda x: -x[2])

    out: list[dict[str, Any]] = []
    for fid, day, hours in busiest(fac_day):
        out.append({
            "id": f"faculty:{fid}:{day}",
            "kind": "faculty_leave",
            "target": fid,
            "day": day,
            "load": hours,
            "label": f"{fid} on leave all {day}",
            "change": {"type": "faculty_unavailable", "faculty_id": fid, "days": [day], "periods": ALL_DAY,
                       "reason": "resilience scan"},
        })
    for rid, day, hours in busiest(room_day):
        out.append({
            "id": f"room:{rid}:{day}",
            "kind": "room_closed",
            "target": rid,
            "day": day,
            "load": hours,
            "label": f"{rid} closed all {day}",
            "change": {"type": "room_unavailable", "room_id": rid, "days": [day], "periods": ALL_DAY,
                       "reason": "resilience scan"},
        })
    # Interleave the heaviest faculty and room scenarios, then cap.
    out.sort(key=lambda s: -s["load"])
    return out[:limit]


def resilience_scan(
    raw: dict[str, Any],
    baseline: dict[str, Any],
    *,
    per_scenario_s: float = 40.0,
    limit: int = 16,
    workers: int = 4,
    on_progress: ProgressFn | None = None,
) -> dict[str, Any]:
    t0 = time.monotonic()
    ds = Dataset(raw)
    scenarios = _scenarios(ds, baseline, limit)
    rows: list[dict[str, Any]] = []
    for i, sc in enumerate(scenarios, 1):
        ds_after = Dataset(apply_changes(raw, {"changes": [sc["change"]]}))
        res = repair(ds_after, baseline, time_limit_s=per_scenario_s, workers=workers)
        summary = res.get("summary") or {}
        ok = res.get("status") not in ("infeasible", "unknown", "model_invalid") and (
            (res.get("report") or {}).get("hard_violation_count", 1) == 0
        )
        rows.append({
            "id": sc["id"],
            "kind": sc["kind"],
            "target": sc["target"],
            "day": sc["day"],
            "label": sc["label"],
            "load": sc["load"],
            "ok": ok,
            "status": res.get("status"),
            "moved": summary.get("moved", 0),
            "time_changed": summary.get("time_changed", 0),
            "room_only": summary.get("room_only", 0),
            "blockers": [] if ok else [str(d) for d in (res.get("diagnostics") or [])][:3],
        })
        if on_progress:
            on_progress({"phase": "scenario", "done": i, "total": len(scenarios), "label": sc["label"],
                         "elapsed_s": round(time.monotonic() - t0, 1)})

    fixable = [r for r in rows if r["ok"]]
    infeasible = [r for r in rows if r["status"] == "infeasible"]
    moves = sorted(r["moved"] for r in fixable)
    return {
        "status": "done",
        "scenarios": rows,
        "summary": {
            "total": len(rows),
            "fixable": len(fixable),
            "infeasible": len(infeasible),
            "timed_out": len(rows) - len(fixable) - len(infeasible),
            "median_moved": moves[len(moves) // 2] if moves else 0,
            "max_moved": moves[-1] if moves else 0,
            "score": round(100 * len(fixable) / (len(fixable) + len(infeasible))) if fixable or infeasible else 100,
            "elapsed_s": round(time.monotonic() - t0, 1),
        },
    }
