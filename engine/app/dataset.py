"""Dataset loading, indexing and change-file application.

The engine is stateless: every call receives the raw dataset JSON (the
starter-pack format) and builds a :class:`Dataset` index from it. Nothing
here is specific to ``cit_public.json``; any dataset in the same format works.
"""

from __future__ import annotations

import copy
import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

LAST_TEACHING_PERIOD = 9
LAST_EVENT_PERIOD = 13
DEFAULT_MAX_HOURS = 4

#: Points a booking earns per effective category (approved = full, alternative = half).
CATEGORY_WEIGHT = {
    "institute_event": 5,
    "guest_lecture": 4,
    "department_event": 3,
    "club_event": 2,
}

CHANGE_TYPES = (
    "faculty_unavailable",
    "room_unavailable",
    "add_faculty",
    "add_session",
    "remove_session",
)


class ChangeFileError(ValueError):
    """Raised when a change (disruption) file cannot be applied."""


def load_json(path: str | Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def periods_of(start: int, duration: int) -> range:
    """Periods covered by a block that starts at ``start`` and lasts ``duration``."""
    return range(start, start + duration)


@dataclass
class Dataset:
    """Read-only, indexed view over a raw dataset dict."""

    raw: dict[str, Any]
    days: list[str] = field(init=False)
    day_index: dict[str, int] = field(init=False)
    lab_starts: set[int] = field(init=False)
    lunch_after: int = field(init=False)
    rooms: dict[str, dict] = field(init=False)
    faculty: dict[str, dict] = field(init=False)
    groups: dict[str, dict] = field(init=False)
    sessions: dict[str, dict] = field(init=False)
    requests: dict[str, dict] = field(init=False)
    cancelled: dict[str, dict] = field(init=False)
    exams: dict[str, dict] = field(init=False)
    faculty_blocked: dict[str, set[tuple[str, int]]] = field(init=False)
    room_blocked: dict[str, set[tuple[str, int]]] = field(init=False)
    priority_order: list[str] = field(init=False)
    role_cap: dict[str, str] = field(init=False)

    def __post_init__(self) -> None:
        d = self.raw
        cal = d["calendar"]
        self.days = list(cal["days"])
        self.day_index = {day: i for i, day in enumerate(self.days)}
        self.lab_starts = set(cal.get("lab_start_periods", [2, 6]))
        self.lunch_after = cal.get("lunch", {}).get("after_period", 5)
        self.rooms = {r["id"]: r for r in d.get("rooms", [])}
        self.faculty = {f["id"]: f for f in d.get("faculty", [])}
        self.groups = {g["id"]: g for g in d.get("student_groups", [])}
        self.sessions = {s["id"]: s for s in d.get("sessions", [])}
        self.requests = {b["id"]: b for b in d.get("booking_requests", [])}
        self.cancelled = {c["request_id"]: c for c in d.get("cancellations", [])}
        self.exams = {e["id"]: e for e in d.get("exams", [])}
        self.priority_order = list(d.get("priority_order", []))
        self.role_cap = dict(d.get("role_category_cap", {}))

        self.faculty_blocked = defaultdict(set)
        for f in d.get("faculty", []):
            for u in f.get("unavailable", []):
                for p in u["periods"]:
                    self.faculty_blocked[f["id"]].add((u["day"], p))
        self.room_blocked = defaultdict(set)
        for u in d.get("room_unavailability", []):
            for p in u["periods"]:
                self.room_blocked[u["room_id"]].add((u["day"], p))

    # ------------------------------------------------------------------ misc
    @property
    def dataset_id(self) -> str | None:
        return self.raw.get("dataset_id")

    @property
    def exam_days(self) -> list[str]:
        return list(self.raw["calendar"].get("exam_week", {}).get("days", []))

    @property
    def exam_sessions(self) -> list[str]:
        return [s["id"] for s in self.raw["calendar"].get("exam_week", {}).get("sessions", [])]

    def max_hours(self, faculty_id: str) -> int:
        return self.faculty.get(faculty_id, {}).get("max_hours_per_day", DEFAULT_MAX_HOURS)

    def crosses_lunch(self, start: int, duration: int) -> bool:
        last = start + duration - 1
        return start <= self.lunch_after < last

    # ------------------------------------------------------------- priority
    def effective_category(self, req: dict) -> str:
        """Requested category, capped by what the requester's role may claim.

        An unknown requested category is treated as the lowest priority; an
        unknown role is capped at ``club_event``.
        """
        order = self.priority_order
        cap = self.role_cap.get(req.get("role"), "club_event")
        asked = req.get("requested_category")
        asked_rank = order.index(asked) if asked in order else len(order) - 1
        cap_rank = order.index(cap) if cap in order else len(order) - 1
        return order[max(asked_rank, cap_rank)]

    def category_rank(self, category: str) -> int:
        return self.priority_order.index(category)

    def outranks(self, a: dict, b: dict) -> bool:
        """True if request ``a`` has priority over request ``b``."""
        ra = self.category_rank(self.effective_category(a))
        rb = self.category_rank(self.effective_category(b))
        if ra != rb:
            return ra < rb
        return a["submitted_at"] < b["submitted_at"]

    def room_features(self, room: dict) -> set[str]:
        feats = set(room.get("features", []))
        if room.get("accessible"):
            feats.add("accessible")
        return feats


def apply_changes(data: dict[str, Any], change_file: dict[str, Any]) -> dict[str, Any]:
    """Return a new dataset dict with every change in ``change_file`` applied.

    Changes are permanent. The input dict is never mutated.
    """
    out = copy.deepcopy(data)
    fac = {f["id"]: f for f in out.setdefault("faculty", [])}
    out.setdefault("room_unavailability", [])
    for i, ch in enumerate(change_file.get("changes", [])):
        kind = ch.get("type")
        try:
            if kind == "faculty_unavailable":
                f = fac.get(ch["faculty_id"])
                if f is None:
                    raise ChangeFileError(f"change {i}: unknown faculty {ch['faculty_id']}")
                f.setdefault("unavailable", [])
                for day in ch["days"]:
                    f["unavailable"].append(
                        {"day": day, "periods": list(ch["periods"]), "reason": ch.get("reason", "")}
                    )
            elif kind == "room_unavailable":
                for day in ch["days"]:
                    out["room_unavailability"].append(
                        {
                            "room_id": ch["room_id"],
                            "day": day,
                            "periods": list(ch["periods"]),
                            "reason": ch.get("reason", ""),
                        }
                    )
            elif kind == "add_faculty":
                out["faculty"].append(ch["faculty"])
                fac[ch["faculty"]["id"]] = ch["faculty"]
            elif kind == "add_session":
                out["sessions"].append(ch["session"])
            elif kind == "remove_session":
                out["sessions"] = [s for s in out["sessions"] if s["id"] != ch["session_id"]]
            else:
                raise ChangeFileError(f"change {i}: unknown change type {kind!r}")
        except KeyError as exc:
            raise ChangeFileError(f"change {i} ({kind}): missing field {exc}") from exc
    return out


def iter_session_periods(session: dict, start: int) -> Iterable[int]:
    return periods_of(start, session["duration"])
