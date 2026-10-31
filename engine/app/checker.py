"""Deterministic schedule checker: the single source of truth for validity.

Mirrors the official starter-pack validator rule-for-rule (H1-H14, B1-B3,
E1-E2, soft S1-S6, booking score, priority inversions, stability) so that the
app never accepts something the scorer would reject. The oracle tests in
``tests/test_oracle.py`` run the official ``validator.py`` side by side on
random schedules and assert identical results.

Two entry points:

* :func:`full_report` - whole-schedule report, same shape as the validator's.
* :class:`PlacementChecker` - incremental "can session X go to (day, start,
  room) given everything else?" used by manual moves, explanations and repair.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Iterable

from .dataset import (
    CATEGORY_WEIGHT,
    LAST_EVENT_PERIOD,
    LAST_TEACHING_PERIOD,
    Dataset,
    periods_of,
)

Placement = tuple[str, int, str]  # (day, start_period, room_id)
Assignment = dict[str, Placement]
Violation = dict[str, str]


def _violation(rule: str, where: str, detail: str) -> Violation:
    return {"rule": rule, "where": where, "detail": detail}


def assignment_from_schedule(schedule: dict[str, Any]) -> tuple[Assignment, list[str]]:
    """Turn ``schedule["sessions"]`` into an assignment map; also return duplicate ids."""
    out: Assignment = {}
    dups: list[str] = []
    for row in schedule.get("sessions", []):
        sid = row.get("session_id")
        if sid in out:
            dups.append(sid)
        out[sid] = (row.get("day"), row.get("start_period"), row.get("room_id"))
    return out, dups


# ============================================================== timetable
@dataclass
class TimetableResult:
    violations: list[Violation]
    #: (group, day, period) -> set of occupying "units" (basket slot or session id)
    group_units: dict[tuple[str, str, int], set[str]]


def check_timetable(ds: Dataset, assign: Assignment, where: str = "timetable") -> TimetableResult:
    out: list[Violation] = []

    def flag(rule: str, detail: str) -> None:
        out.append(_violation(rule, where, detail))

    room_use: dict[tuple, list[str]] = defaultdict(list)
    fac_use: dict[tuple, list[str]] = defaultdict(list)
    group_units: dict[tuple, set[str]] = defaultdict(set)
    fac_hours: dict[tuple, int] = defaultdict(int)
    basket_slots: dict[str, set[tuple[str, int]]] = defaultdict(set)

    for sid in ds.sessions:
        if sid not in assign:
            flag("H1", f"Session {sid} is not scheduled")

    for sid, (day, start, rid) in assign.items():
        sess = ds.sessions.get(sid)
        if sess is None:
            flag("H1", f"Unknown session id {sid}")
            continue
        if day not in ds.day_index:
            flag("H1", f"{sid}: invalid day {day}")
            continue
        dur = sess["duration"]
        if not isinstance(start, int) or start < 1 or start + dur - 1 > LAST_TEACHING_PERIOD:
            flag("H9", f"{sid}: start period {start} with duration {dur} runs outside P1-P9")
            continue
        room = ds.rooms.get(rid)
        if room is None:
            flag("H1", f"{sid}: unknown room {rid}")
            continue

        covered = periods_of(start, dur)
        first, last = covered[0], covered[-1]
        if first <= ds.lunch_after < last:
            flag("H9", f"{sid}: crosses lunch ({day} P{first}-P{last})")
        if sess["kind"] == "lab" and start not in ds.lab_starts:
            flag("H9", f"{sid}: lab must start at P2 or P6, starts at P{start}")
        fixed = sess.get("fixed_slot")
        if fixed and (fixed["day"] != day or fixed["start_period"] != start):
            flag("H14", f"{sid}: fixed at {fixed['day']} P{fixed['start_period']}, placed at {day} P{start}")
        if room["capacity"] < sess["size"]:
            flag("H5", f"{sid}: size {sess['size']} > {rid} capacity {room['capacity']}")
        if room["type"] not in sess["room_types"]:
            flag("H6", f"{sid}: needs {sess['room_types']}, {rid} is {room['type']}")
        if sess.get("needs_accessible") and not room["accessible"]:
            flag("H10", f"{sid}: needs an accessible room, {rid} is not")

        fid = sess["faculty_id"]
        unit = sess.get("basket_slot") or sid
        for p in covered:
            room_use[(rid, day, p)].append(sid)
            fac_use[(fid, day, p)].append(sid)
            for g in sess["groups"]:
                group_units[(g, day, p)].add(unit)
            if (day, p) in ds.faculty_blocked[fid]:
                flag("H7", f"{sid}: {fid} unavailable {day} P{p}")
            if (day, p) in ds.room_blocked[rid]:
                flag("H8", f"{sid}: {rid} unavailable {day} P{p}")
        fac_hours[(fid, day)] += dur
        if sess.get("basket_slot"):
            basket_slots[sess["basket_slot"]].add((day, start))

    for (rid, day, p), sids in room_use.items():
        if len(sids) > 1:
            flag("H4", f"{rid} double-booked {day} P{p}: {', '.join(sorted(sids))}")
    for (fid, day, p), sids in fac_use.items():
        if len(sids) > 1:
            flag("H2", f"{fid} double-booked {day} P{p}: {', '.join(sorted(sids))}")
    for (g, day, p), units in group_units.items():
        if len(units) > 1:
            flag("H3", f"Group {g} double-booked {day} P{p}: {', '.join(sorted(units))}")
    for slot, times in basket_slots.items():
        if len(times) > 1:
            flag("H11", f"Basket {slot} sessions are not at the same time: {sorted(times)}")
    for (fid, day), hours in fac_hours.items():
        limit = ds.max_hours(fid)
        if hours > limit:
            flag("H12", f"{fid} teaches {hours} hours on {day} (max {limit})")
    return TimetableResult(out, group_units)


# ============================================================== soft score
SOFT_KEYS = ("S1", "S2", "S3", "S4", "S5", "S6")


def soft_penalties(ds: Dataset, assign: Assignment) -> tuple[dict[str, int], int]:
    pen = {k: 0 for k in SOFT_KEYS}
    group_periods: dict[tuple, set[int]] = defaultdict(set)
    group_hours: dict[tuple, int] = defaultdict(int)
    group_course_lectures: dict[tuple, int] = defaultdict(int)
    counted_basket: set[tuple[str, str]] = set()
    basket_course_day: dict[tuple, int] = defaultdict(int)

    for sid, (day, start, rid) in assign.items():
        sess = ds.sessions.get(sid)
        room = ds.rooms.get(rid)
        if sess is None or room is None:
            continue
        covered = periods_of(start, sess["duration"])
        for pref in ds.faculty.get(sess["faculty_id"], {}).get("preferences", []):
            if pref.get("type") == "avoid" and day in pref.get("days", ds.days):
                pen["S1"] += 2 * sum(1 for p in covered if p in pref["periods"])
        if room["capacity"] and sess["size"] / room["capacity"] < 0.4:
            pen["S5"] += 1
        if LAST_TEACHING_PERIOD in covered:
            pen["S6"] += 1

        slot = sess.get("basket_slot")
        for g in sess["groups"]:
            group_periods[(g, day)].update(covered)
            if slot:
                if (g, slot) in counted_basket:
                    continue
                counted_basket.add((g, slot))
            group_hours[(g, day)] += sess["duration"]
            if sess["kind"] == "lecture" and not slot:
                group_course_lectures[(g, day, sess["course_id"])] += 1

    for ps in group_periods.values():
        pen["S2"] += sum(1 for p in range(min(ps), max(ps) + 1) if p not in ps)
    for hours in group_hours.values():
        if hours > 6:
            pen["S3"] += 3 * (hours - 6)
    for n in group_course_lectures.values():
        if n > 1:
            pen["S4"] += 3 * (n - 1)
    # Same basket course twice on one day. Counted from the session alone
    # (even when its room is unknown), exactly as the scorer does.
    for sid, (day, _start, _rid) in assign.items():
        sess = ds.sessions.get(sid)
        if sess and sess.get("basket_slot"):
            basket_course_day[(sess["course_id"], day)] += 1
    for n in basket_course_day.values():
        if n > 1:
            pen["S4"] += 3 * (n - 1)
    return pen, sum(pen.values())


# ============================================================== bookings
def check_bookings(
    ds: Dataset, base: Assignment, fest: dict[str, Any]
) -> tuple[list[Violation], list[str], dict[str, Any]]:
    violations: list[Violation] = []
    warnings: list[str] = []
    overrides = fest.get("session_overrides", [])
    decisions = fest.get("bookings", [])

    def flag(rule: str, detail: str) -> None:
        violations.append(_violation(rule, "fest_week", detail))

    by_request: dict[str, dict] = {}
    for dec in decisions:
        if dec.get("request_id") in by_request:
            flag("B1", f"Two decisions for {dec['request_id']}")
        by_request[dec.get("request_id")] = dec

    # Week-7 view of the timetable: base timetable with overrides applied.
    week = dict(base)
    institute_rank = ds.category_rank("institute_event")
    for ov in overrides:
        sid = ov.get("session_id")
        if sid not in ds.sessions:
            flag("B2", f"Override for unknown session {sid}")
            continue
        displacer = ov.get("displaced_by")
        dec = by_request.get(displacer)
        req = ds.requests.get(displacer)
        if not req or not dec or dec.get("status") != "approved":
            flag("B2", f"Override of {sid} names {displacer}, which is not an approved booking")
        elif ds.category_rank(ds.effective_category(req)) > institute_rank:
            flag("B2", f"{displacer} ({ds.effective_category(req)}) is not allowed to displace a regular session")
        week[sid] = (ov["day"], ov["start_period"], ov["room_id"])

    week_result = check_timetable(ds, week, "fest_week")
    violations += week_result.violations
    week_groups = week_result.group_units

    room_busy: dict[tuple, list[str]] = defaultdict(list)
    for sid, (day, start, rid) in week.items():
        sess = ds.sessions.get(sid)
        if sess:
            for p in periods_of(start, sess["duration"]):
                room_busy[(rid, day, p)].append(sid)

    score = 0.0
    max_score = 0
    placed: dict[str, tuple[str, str, int, int]] = {}
    for req_id, req in ds.requests.items():
        if req_id not in ds.cancelled:
            max_score += CATEGORY_WEIGHT[ds.effective_category(req)]

    for req_id, req in ds.requests.items():
        dec = by_request.get(req_id)
        if dec is None:
            warnings.append(f"No decision for {req_id}")
            continue
        status = dec.get("status")
        if req_id in ds.cancelled:
            if status in ("approved", "alternative_offered"):
                flag("B3", f"{req_id} was cancelled but is {status}")
            continue
        if status not in ("approved", "rejected", "alternative_offered"):
            flag("B1", f"{req_id}: unknown status {status}")
            continue
        if status in ("rejected", "alternative_offered") and not str(dec.get("reason", "")).strip():
            warnings.append(f"{req_id}: {status} without a reason")
        if status == "rejected":
            continue

        problems = booking_problems(ds, req, dec, room_busy, week_groups)
        for detail in problems:
            flag("H13", f"{req_id}: {detail}")
        if not problems:
            rid, day, a, b = dec["room_id"], dec["day"], dec["start_period"], dec["end_period"]
            for p in range(a, b + 1):
                room_busy[(rid, day, p)].append(req_id)
            placed[req_id] = (rid, day, a, b)
            weight = CATEGORY_WEIGHT[ds.effective_category(req)]
            score += weight * (1 if status == "approved" else 0.5)

    inversions = _priority_inversions(ds, by_request, placed, room_busy, week_groups)
    stats = {
        "booking_score": score,
        "booking_score_max_if_all_approved": max_score,
        "approved": sum(1 for x in decisions if x.get("status") == "approved"),
        "alternatives": sum(1 for x in decisions if x.get("status") == "alternative_offered"),
        "rejected": sum(1 for x in decisions if x.get("status") == "rejected"),
        "session_overrides": len(overrides),
        "priority_inversions": inversions,
    }
    return violations, warnings, stats


def booking_problems(
    ds: Dataset,
    req: dict,
    dec: dict,
    room_busy: dict[tuple, list[str]],
    week_groups: dict[tuple, set[str]],
) -> list[str]:
    """Every H13 problem with placing ``req`` as described by decision ``dec``.

    ``dec`` has ``status``, ``room_id``, ``day``, ``start_period``, ``end_period``.
    Returns an empty list when the placement is valid.
    """
    problems: list[str] = []
    room = ds.rooms.get(dec.get("room_id"))
    day, a, b = dec.get("day"), dec.get("start_period"), dec.get("end_period")
    if room is None:
        return [f"unknown room {dec.get('room_id')}"]
    if (
        day not in ds.day_index
        or not isinstance(a, int)
        or not isinstance(b, int)
        or a < 1
        or b > LAST_EVENT_PERIOD
        or b < a
    ):
        return [f"invalid time {day} P{a}-P{b}"]
    if b - a + 1 != req["duration_periods"]:
        problems.append(f"booked {b - a + 1} periods, request needs {req['duration_periods']}")
    if "event" not in room["allowed_uses"]:
        problems.append(f"{room['id']} cannot host events")
    if room["type"] not in req["room_types"]:
        problems.append(f"{room['id']} ({room['type']}) is not one of {req['room_types']}")
    if room["capacity"] < req["attendance"]:
        problems.append(f"{room['id']} seats {room['capacity']}, request needs {req['attendance']}")
    missing = set(req["needs"]) - ds.room_features(room)
    if missing:
        problems.append(f"{room['id']} lacks {sorted(missing)}")
    if dec.get("status") == "approved":
        inside = any(
            w["day"] == day and w["from_period"] <= a and b <= w["to_period"] for w in req["windows"]
        )
        if not inside:
            problems.append(
                f"approved at {day} P{a}-P{b}, outside the requested windows (use alternative_offered)"
            )
    for p in range(a, b + 1):
        if (day, p) in ds.room_blocked[room["id"]]:
            problems.append(f"{room['id']} unavailable {day} P{p}")
        users = room_busy.get((room["id"], day, p))
        if users:
            problems.append(f"{room['id']} {day} P{p} already used by {', '.join(users)}")
        for g in req["mandatory_for_groups"]:
            if week_groups.get((g, day, p)):
                problems.append(f"mandatory for {g}, who have class {day} P{p}")
    return problems


def _priority_inversions(
    ds: Dataset,
    by_request: dict[str, dict],
    placed: dict[str, tuple[str, str, int, int]],
    room_busy: dict[tuple, list[str]],
    week_groups: dict[tuple, set[str]],
) -> list[str]:
    """A rejected request that could have used a slot given to a lower-priority approved one."""
    found: list[str] = []
    for req_id, req in ds.requests.items():
        dec = by_request.get(req_id)
        if req_id in ds.cancelled or not dec or dec.get("status") != "rejected":
            continue
        for other_id, (rid, day, a, b) in placed.items():
            other = ds.requests[other_id]
            if by_request[other_id].get("status") != "approved" or not ds.outranks(req, other):
                continue
            room = ds.rooms[rid]
            if (
                room["type"] not in req["room_types"]
                or room["capacity"] < req["attendance"]
                or set(req["needs"]) - ds.room_features(room)
            ):
                continue
            if _could_take(ds, req, other_id, rid, day, a, b, room_busy, week_groups):
                found.append(
                    f"{req_id} rejected, but {other_id} (lower priority) holds {rid} {day} P{a}-P{b} that {req_id} could use"
                )
    return found


def _could_take(ds, req, other_id, rid, day, a, b, room_busy, week_groups) -> bool:
    dur = req["duration_periods"]
    for w in req["windows"]:
        if w["day"] != day:
            continue
        for s0 in range(w["from_period"], w["to_period"] - dur + 2):
            per = range(s0, s0 + dur)
            if per[-1] > LAST_EVENT_PERIOD or not any(a <= p <= b for p in per):
                continue
            clash = False
            for p in per:
                if (day, p) in ds.room_blocked[rid]:
                    clash = True
                if [x for x in room_busy.get((rid, day, p), []) if x != other_id]:
                    clash = True
                for g in req["mandatory_for_groups"]:
                    if week_groups.get((g, day, p)):
                        clash = True
            if not clash:
                return True
    return False


# ============================================================== exams
def check_exams(ds: Dataset, rows: list[dict]) -> tuple[list[Violation], int]:
    violations: list[Violation] = []
    penalty = 0
    days = set(ds.exam_days)
    slots = set(ds.exam_sessions)
    room_use: dict[tuple, list[str]] = defaultdict(list)
    group_use: dict[tuple, list[str]] = defaultdict(list)
    group_day: dict[tuple, set[str]] = defaultdict(set)
    seen: set[str] = set()

    def flag(rule: str, detail: str) -> None:
        violations.append(_violation(rule, "exams", detail))

    for row in rows:
        eid = row.get("exam_id")
        if eid not in ds.exams:
            flag("E1", f"Unknown exam {eid}")
            continue
        if eid in seen:
            flag("E1", f"{eid} scheduled twice")
        seen.add(eid)
        if row.get("day") not in days or row.get("session") not in slots:
            flag("E1", f"{eid}: invalid slot")
            continue
        seats = 0
        for rid in row.get("rooms", []):
            room = ds.rooms.get(rid)
            if room is None or "exam" not in room["allowed_uses"]:
                flag("E2", f"{eid}: {rid} cannot host exams")
                continue
            seats += room["capacity"] // 2
            room_use[(rid, row["day"], row["session"])].append(eid)
        exam = ds.exams[eid]
        if seats < exam["size"]:
            flag("H5", f"{eid}: {seats} seats at half capacity for {exam['size']} students")
        for g in exam["groups"]:
            group_use[(g, row["day"], row["session"])].append(eid)
            group_day[(g, row["day"])].add(eid)

    for eid in ds.exams:
        if eid not in seen:
            flag("E1", f"{eid} not scheduled")
    for (rid, day, slot), eids in room_use.items():
        if len(eids) > 1:
            flag("H4", f"{rid} has {eids} in {day} {slot}")
    for (g, day, slot), eids in group_use.items():
        if len(eids) > 1:
            flag("H3", f"Group {g} has {eids} in {day} {slot}")
    for eids in group_day.values():
        if len(eids) > 1:
            penalty += 5 * (len(eids) - 1)
    return violations, penalty


# ============================================================== full report
def full_report(
    ds: Dataset, schedule: dict[str, Any], baseline: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Validator-equivalent report for a whole ``schedule.json`` document."""
    report: dict[str, Any] = {
        "dataset_id": ds.dataset_id,
        "schedule_dataset_id": schedule.get("dataset_id"),
        "team": schedule.get("team"),
    }
    assign, dups = assignment_from_schedule(schedule)
    violations = list(check_timetable(ds, assign, "timetable").violations)
    for sid in dups:
        violations.append(_violation("H1", "timetable", f"Session {sid} appears more than once"))
    soft, total = soft_penalties(ds, assign)
    report["soft_penalties"] = soft
    report["soft_total"] = total

    warnings: list[str] = []
    if "fest_week" in schedule:
        bv, bw, stats = check_bookings(ds, assign, schedule["fest_week"])
        violations += bv
        warnings += bw
        report["bookings"] = stats
    if ds.exams and (baseline is None or schedule.get("exams")):
        ev, epen = check_exams(ds, schedule.get("exams") or [])
        violations += ev
        report["exam_soft_penalty"] = epen
    if baseline is not None:
        report["stability"] = stability(ds, assign, assignment_from_schedule(baseline)[0])

    unique: list[Violation] = []
    seen: set[tuple[str, str]] = set()
    for v in violations:  # the week-7 view repeats base problems; count each once
        key = (v["rule"], v["detail"])
        if key not in seen:
            seen.add(key)
            unique.append(v)
    by_rule: dict[str, int] = {}
    for v in unique:
        by_rule[v["rule"]] = by_rule.get(v["rule"], 0) + 1
    report["hard_violations"] = unique
    report["hard_violation_count"] = len(unique)
    report["hard_by_rule"] = by_rule
    report["warnings"] = warnings
    return report


def stability(ds: Dataset, assign: Assignment, base: Assignment) -> dict[str, Any]:
    moved = [
        sid
        for sid in assign
        if sid in base and sid in ds.sessions and tuple(assign[sid]) != tuple(base[sid])
    ]
    return {
        "sessions_moved": len(moved),
        "time_changed": sum(1 for s in moved if assign[s][:2] != base[s][:2]),
        "room_only_changed": sum(1 for s in moved if assign[s][:2] == base[s][:2]),
        "moved_ids": sorted(moved),
    }


# ============================================================== incremental
@dataclass
class Blocker:
    rule: str
    reason: str
    blockers: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"rule": self.rule, "reason": self.reason, "blockers": self.blockers}


class PlacementChecker:
    """Answers "can session X go to (day, start, room)?" against a fixed rest-of-timetable.

    Build once from an assignment, then query many candidate placements.
    The session being tested is excluded from the occupancy indexes, so a
    move is checked against everything *else*. Basket partners are treated as
    moving together with the session (H11), so they are excluded too.
    """

    def __init__(self, ds: Dataset, assign: Assignment):
        self.ds = ds
        self.assign = dict(assign)
        self.room_use: dict[tuple, set[str]] = defaultdict(set)
        self.fac_use: dict[tuple, set[str]] = defaultdict(set)
        self.group_use: dict[tuple, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
        self.fac_hours: dict[tuple, dict[str, int]] = defaultdict(dict)
        for sid, placement in self.assign.items():
            self._index(sid, placement)

    def _index(self, sid: str, placement: Placement) -> None:
        sess = self.ds.sessions.get(sid)
        if sess is None:
            return
        day, start, rid = placement
        unit = sess.get("basket_slot") or sid
        for p in periods_of(start, sess["duration"]):
            self.room_use[(rid, day, p)].add(sid)
            self.fac_use[(sess["faculty_id"], day, p)].add(sid)
            for g in sess["groups"]:
                self.group_use[(g, day, p)][unit].add(sid)
        self.fac_hours[(sess["faculty_id"], day)][sid] = sess["duration"]

    def basket_partners(self, sid: str) -> list[str]:
        slot = self.ds.sessions[sid].get("basket_slot")
        if not slot:
            return []
        return [o for o, s in self.ds.sessions.items() if s.get("basket_slot") == slot and o != sid]

    def check(self, sid: str, day: str, start: int, rid: str) -> list[Blocker]:
        """All reasons the placement is invalid (empty list means it is valid)."""
        ds = self.ds
        sess = ds.sessions.get(sid)
        if sess is None:
            return [Blocker("H1", f"Unknown session {sid}")]
        if day not in ds.day_index:
            return [Blocker("H1", f"Invalid day {day}")]
        room = ds.rooms.get(rid)
        if room is None:
            return [Blocker("H1", f"Unknown room {rid}")]
        dur = sess["duration"]
        out: list[Blocker] = []
        if start < 1 or start + dur - 1 > LAST_TEACHING_PERIOD:
            return [Blocker("H9", f"P{start}-P{start + dur - 1} runs outside teaching periods P1-P9")]
        if ds.crosses_lunch(start, dur):
            out.append(Blocker("H9", f"P{start}-P{start + dur - 1} runs across lunch"))
        if sess["kind"] == "lab" and start not in ds.lab_starts:
            starts = " or ".join(f"P{p}" for p in sorted(ds.lab_starts))
            out.append(Blocker("H9", f"Labs must start at {starts}"))
        fixed = sess.get("fixed_slot")
        if fixed and (fixed["day"] != day or fixed["start_period"] != start):
            out.append(Blocker("H14", f"Fixed to {fixed['day']} P{fixed['start_period']}"))
        if room["capacity"] < sess["size"]:
            out.append(Blocker("H5", f"{rid} seats {room['capacity']}, session has {sess['size']}"))
        if room["type"] not in sess["room_types"]:
            out.append(Blocker("H6", f"{rid} is a {room['type']}, session needs {', '.join(sess['room_types'])}"))
        if sess.get("needs_accessible") and not room["accessible"]:
            out.append(Blocker("H10", f"{rid} is not accessible"))

        moving = {sid, *self.basket_partners(sid)}
        fid = sess["faculty_id"]
        unit = sess.get("basket_slot") or sid
        covered = list(periods_of(start, dur))
        blocked_fac = [p for p in covered if (day, p) in ds.faculty_blocked[fid]]
        if blocked_fac:
            out.append(Blocker("H7", f"{fid} is unavailable {day} {_fmt_periods(blocked_fac)}", [fid]))
        blocked_room = [p for p in covered if (day, p) in ds.room_blocked[rid]]
        if blocked_room:
            out.append(Blocker("H8", f"{rid} is closed {day} {_fmt_periods(blocked_room)}", [rid]))

        room_clash = _others(self.room_use, ((rid, day, p) for p in covered), moving)
        if room_clash:
            out.append(Blocker("H4", f"{rid} is already used by {', '.join(room_clash)}", room_clash))
        fac_clash = _others(self.fac_use, ((fid, day, p) for p in covered), moving)
        if fac_clash:
            out.append(Blocker("H2", f"{fid} already teaches {', '.join(fac_clash)}", fac_clash))
        group_clash: set[str] = set()
        for g in sess["groups"]:
            for p in covered:
                for other_unit, sids in self.group_use.get((g, day, p), {}).items():
                    if other_unit != unit:
                        group_clash |= sids - moving
        if group_clash:
            names = sorted(group_clash)
            out.append(Blocker("H3", f"Groups {', '.join(sess['groups'])} already have {', '.join(names)}", names))
        other_hours = sum(h for o, h in self.fac_hours.get((fid, day), {}).items() if o not in moving)
        limit = ds.max_hours(fid)
        if other_hours + dur > limit:
            out.append(Blocker("H12", f"{fid} would teach {other_hours + dur} h on {day} (max {limit})", [fid]))
        return out


def _others(index: dict[tuple, set[str]], keys: Iterable[tuple], exclude: set[str]) -> list[str]:
    found: set[str] = set()
    for k in keys:
        found |= index.get(k, set()) - exclude
    return sorted(found)


def _fmt_periods(ps: list[int]) -> str:
    if len(ps) == 1:
        return f"P{ps[0]}"
    return f"P{ps[0]}-P{ps[-1]}"
