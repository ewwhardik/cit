"""Spectra-week booking allocation (OR-Tools CP-SAT) with deterministic reasons.

Given the Week-7 timetable (fixed), every booking request gets exactly one
decision: ``approved`` (inside a requested window), ``alternative_offered``
(a valid slot outside the windows, half score) or ``rejected``.

Priority is enforced through the objective: each placed request earns
``1000 * category_weight * (2 if approved else 1)`` plus a small bonus for
being earlier in the priority ranking. Because a higher-ranked request is
always worth at least as much as a lower one, the optimum never rejects a
request that could have taken a lower-priority request's slot (the scorer's
"priority inversion"); the result is re-checked by the checker anyway.

Reasons are generated from structured facts (never by an LLM), e.g.
"No venue seats 1,200 people: the largest suitable venue is OAT (800)."
"""

from __future__ import annotations

from collections import defaultdict
from difflib import SequenceMatcher
from dataclasses import dataclass, field
from typing import Any, Iterable

from ortools.sat.python import cp_model

from .checker import Assignment, check_bookings, check_timetable
from .dataset import CATEGORY_WEIGHT, LAST_EVENT_PERIOD, LAST_TEACHING_PERIOD, Dataset, periods_of
from .timetable import EventOption

CATEGORY_LABEL = {
    "exam": "exam",
    "regular_session": "regular class",
    "institute_event": "institute event",
    "guest_lecture": "guest lecture",
    "department_event": "department event",
    "club_event": "club event",
}


@dataclass(frozen=True)
class Option:
    req_id: str
    room_id: str
    day: str
    start: int
    end: int  # inclusive
    approved: bool  # inside a requested window

    @property
    def periods(self) -> range:
        return range(self.start, self.end + 1)


@dataclass
class WeekState:
    """Occupancy of the Week-7 timetable (base + overrides), used to filter options."""

    room_busy: dict[tuple[str, str, int], list[str]]
    group_busy: dict[tuple[str, str, int], set[str]]

    @classmethod
    def from_assignment(cls, ds: Dataset, week: Assignment) -> "WeekState":
        room_busy: dict[tuple, list[str]] = defaultdict(list)
        for sid, (day, start, rid) in week.items():
            s = ds.sessions.get(sid)
            if s:
                for p in periods_of(start, s["duration"]):
                    room_busy[(rid, day, p)].append(sid)
        groups = check_timetable(ds, week, "fest_week").group_units
        return cls(room_busy, groups)


@dataclass
class Decision:
    request_id: str
    status: str
    reason: str
    room_id: str | None = None
    day: str | None = None
    start_period: int | None = None
    end_period: int | None = None
    facts: dict[str, Any] = field(default_factory=dict)

    def export(self) -> dict[str, Any]:
        out: dict[str, Any] = {"request_id": self.request_id, "status": self.status}
        if self.status != "rejected":
            out.update(day=self.day, start_period=self.start_period, end_period=self.end_period, room_id=self.room_id)
        out["reason"] = self.reason
        return out


# ------------------------------------------------------------------ helpers
def period_label(ds: Dataset, start: int, end: int) -> str:
    times = {p["id"]: p for p in ds.raw["calendar"].get("periods", [])}
    if start in times and end in times:
        return f"{times[start]['start']}–{times[end]['end']}"
    return f"P{start}–P{end}"


def slot_label(ds: Dataset, day: str, start: int, end: int) -> str:
    span = f"P{start}" if start == end else f"P{start}–P{end}"
    return f"{day} {span} ({period_label(ds, start, end)})"


def suitable_rooms(ds: Dataset, req: dict) -> tuple[list[str], list[str]]:
    """Rooms that satisfy the request's static needs, and a list of reasons why none might."""
    rooms = []
    for rid, r in ds.rooms.items():
        if "event" not in r.get("allowed_uses", []):
            continue
        if r["type"] not in req["room_types"]:
            continue
        if r["capacity"] < req["attendance"]:
            continue
        if set(req.get("needs", [])) - ds.room_features(r):
            continue
        rooms.append(rid)
    if rooms:
        return rooms, []
    return [], [_why_no_room(ds, req)]


def _why_no_room(ds: Dataset, req: dict) -> str:
    typed = [r for r in ds.rooms.values() if r["type"] in req["room_types"] and "event" in r.get("allowed_uses", [])]
    types = ", ".join(t.replace("_", " ") for t in req["room_types"])
    if not typed:
        return f"No room of the requested type ({types}) can host events."
    biggest_all = max((r for r in ds.rooms.values() if "event" in r.get("allowed_uses", [])), key=lambda r: r["capacity"])
    if req["attendance"] > biggest_all["capacity"]:
        return (
            f"No venue on campus seats {req['attendance']:,} people: the largest is "
            f"{biggest_all['id']} ({biggest_all['name']}, {biggest_all['capacity']:,} seats). "
            f"Consider splitting the event or capping registrations."
        )
    big = [r for r in typed if r["capacity"] >= req["attendance"]]
    if not big:
        best = max(typed, key=lambda r: r["capacity"])
        return (
            f"No {types} seats {req['attendance']:,}: the largest is {best['id']} ({best['capacity']:,} seats)."
        )
    needs = set(req.get("needs", []))
    near = min(big, key=lambda r: len(needs - ds.room_features(r)))
    missing = sorted(needs - ds.room_features(near))
    return (
        f"No {types} with {req['attendance']:,}+ seats has {', '.join(n.replace('_', ' ') for n in sorted(needs))}; "
        f"closest is {near['id']}, which lacks {', '.join(m.replace('_', ' ') for m in missing)}."
    )


def window_positions(req: dict) -> list[tuple[str, int, int]]:
    """(day, start, end) placements fully inside a requested window and within P1-P13."""
    dur = req["duration_periods"]
    out = []
    for w in req["windows"]:
        for a in range(max(1, w["from_period"]), w["to_period"] - dur + 2):
            b = a + dur - 1
            if b <= LAST_EVENT_PERIOD:
                out.append((w["day"], a, b))
    return out


def _window_distance(req: dict, day: str, a: int, ds: Dataset) -> int:
    best = 10_000
    for w in req["windows"]:
        dd = abs(ds.day_index.get(w["day"], 0) - ds.day_index.get(day, 0))
        dp = 0 if w["from_period"] <= a <= w["to_period"] else min(abs(a - w["from_period"]), abs(a - w["to_period"]))
        best = min(best, 4 * dd + dp)
    return best


def generate_options(
    ds: Dataset, req: dict, week: WeekState, *, alternatives: bool = True, ignore_week: bool = False
) -> list[Option]:
    rooms, _ = suitable_rooms(ds, req)
    dur = req["duration_periods"]
    inside = set(window_positions(req))
    out = []
    for rid in rooms:
        for day in ds.days:
            for a in range(1, LAST_EVENT_PERIOD - dur + 2):
                b = a + dur - 1
                approved = (day, a, b) in inside
                if not approved and not alternatives:
                    continue
                ok = True
                for p in range(a, b + 1):
                    if (day, p) in ds.room_blocked[rid]:
                        ok = False
                        break
                    if not ignore_week:
                        if week.room_busy.get((rid, day, p)):
                            ok = False
                            break
                        if any(week.group_busy.get((g, day, p)) for g in req.get("mandatory_for_groups", [])):
                            ok = False
                            break
                if ok:
                    out.append(Option(req["id"], rid, day, a, b, approved))
    return out


def priority_ranking(ds: Dataset, reqs: Iterable[dict]) -> list[str]:
    """Request ids from highest to lowest priority (category, then submission time)."""
    return [
        r["id"]
        for r in sorted(reqs, key=lambda r: (ds.category_rank(ds.effective_category(r)), r["submitted_at"], r["id"]))
    ]


def option_value(ds: Dataset, req: dict, opt: Option, rank: int, n: int) -> int:
    order = ds.priority_order
    cat = ds.effective_category(req)
    idx = order.index(cat) if cat in order else len(order) - 1
    # Dynamic tier weight based on priority_order (matches 5, 4, 3, 2 under default order
    # and guarantees higher-ranked categories always dominate to prevent priority inversions).
    weight = max(1, (len(order) - idx) + 1)
    value = 1000 * weight * (2 if opt.approved else 1) + 10 * (n - rank)
    if req.get("requested_room") == opt.room_id:
        value += 3
    if not opt.approved:
        value -= min(9, _window_distance(req, opt.day, opt.start, ds))
    # Prefer the snuggest room so big venues stay free for big events.
    room = ds.rooms[opt.room_id]
    value -= min(2, (room["capacity"] - req["attendance"]) // 250)
    return value


def reservation_options(ds: Dataset, *, scale: int = 20) -> list[EventOption]:
    """Approved-only options for every live request, ignoring the timetable.

    Fed to the timetable solver so that it leaves rooms and mandatory groups
    free where Spectra events need them. ``value`` is the allocator's value
    divided by ``scale`` (about 100 soft-penalty points per booking-score point).
    """
    active = [r for rid, r in ds.requests.items() if rid not in ds.cancelled]
    ranking = priority_ranking(ds, active)
    rank_of = {rid: i for i, rid in enumerate(ranking)}
    empty = WeekState({}, {})
    out = []
    for req in active:
        for o in generate_options(ds, req, empty, alternatives=False, ignore_week=True):
            out.append(EventOption(
                key=req["id"], room_id=o.room_id, day=o.day, start=o.start, end=o.end,
                value=option_value(ds, req, o, rank_of[req["id"]], len(ranking)) // scale,
                mandatory_groups=tuple(req.get("mandatory_for_groups", [])),
            ))
    return out


# ------------------------------------------------------------------ allocate
def _solve_allocation(
    ds: Dataset,
    week_assign: Assignment,
    *,
    forced: dict[str, Option] | None = None,
    time_limit_s: float,
    workers: int,
) -> tuple[dict[str, Option], WeekState, dict[str, int], str]:
    week = WeekState.from_assignment(ds, week_assign)
    active = [r for rid, r in ds.requests.items() if rid not in ds.cancelled]
    ranking = priority_ranking(ds, active)
    rank_of = {rid: i for i, rid in enumerate(ranking)}
    n = len(ranking)
    forced = forced or {}

    options: dict[str, list[Option]] = {}
    for r in active:
        opts = generate_options(ds, r, week)
        if r["id"] in forced:
            opts = [o for o in opts if o == forced[r["id"]]] or opts
        options[r["id"]] = opts
    m = cp_model.CpModel()
    lit: dict[Option, cp_model.IntVar] = {}
    cell: dict[tuple[str, str, int], list] = defaultdict(list)
    for req in active:
        lits = []
        for opt in options[req["id"]]:
            v = m.NewBoolVar("")
            lit[opt] = v
            lits.append(v)
            for p in opt.periods:
                cell[(opt.room_id, opt.day, p)].append(v)
        if lits:
            m.AddAtMostOne(lits)
        if req["id"] in forced and forced[req["id"]] in lit:
            m.Add(lit[forced[req["id"]]] == 1)
    for lits in cell.values():
        if len(lits) > 1:
            m.AddAtMostOne(lits)
    m.Maximize(sum(option_value(ds, ds.requests[o.req_id], o, rank_of[o.req_id], n) * v for o, v in lit.items()))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_workers = workers
    solver.parameters.random_seed = 7
    status = solver.Solve(m)
    chosen: dict[str, Option] = {}
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for o, v in lit.items():
            if solver.Value(v):
                chosen[o.req_id] = o
    return chosen, week, rank_of, solver.StatusName(status).lower()


def allocate_bookings(
    ds: Dataset,
    week_assign: Assignment,
    *,
    time_limit_s: float = 10.0,
    workers: int = 8,
    allow_overrides: bool = True,
) -> dict[str, Any]:
    """Decide every request. Returns ``{"fest_week": {...}, "decisions": [...], "report": {...}}``.

    If an institute event cannot get a slot inside its window only because
    regular classes are there, those classes are moved for Week 7 (never
    dropped) via ``session_overrides``, and the whole week is re-checked.
    """
    chosen, week, rank_of, status = _solve_allocation(ds, week_assign, time_limit_s=time_limit_s, workers=workers)
    overrides: list[dict[str, Any]] = []
    week_used = week_assign
    if allow_overrides:
        found, forced, moved_week = find_overrides(ds, week_assign, chosen, week)
        if found:
            chosen2, week2, rank2, status2 = _solve_allocation(
                ds, moved_week, forced=forced, time_limit_s=time_limit_s, workers=workers
            )
            trial = _finish(ds, week_assign, chosen2, week2, rank2, found)
            if not trial["report"]["violations"] and all(
                chosen2.get(k) == v for k, v in forced.items()
            ):
                trial["solver_status"] = status2
                return trial
    result = _finish(ds, week_assign, chosen, week, rank_of, overrides)
    result["solver_status"] = status
    return result


def _finish(ds, base_assign, chosen, week, rank_of, overrides) -> dict[str, Any]:
    decisions = [_decide(ds, req, chosen, week, rank_of) for req in ds.requests.values()]
    for d in decisions:
        moved = [o for o in overrides if o["displaced_by"] == d.request_id]
        if moved and d.status == "approved":
            d.reason += " To make room, " + "; ".join(
                f"{o['session_id']} moves to {o['day']} P{o['start_period']} in {o['room_id']}" for o in moved
            ) + " for Week 7 only (classes are moved, never cancelled)."
    fest = {"bookings": [d.export() for d in decisions], "session_overrides": overrides}
    violations, warnings, stats = check_bookings(ds, base_assign, fest)
    return {
        "fest_week": fest,
        "decisions": [d.__dict__ for d in decisions],
        "report": {"violations": violations, "warnings": warnings, **stats},
    }


def find_overrides(
    ds: Dataset, week_assign: Assignment, chosen: dict[str, Option], week: WeekState
) -> tuple[list[dict[str, Any]], dict[str, Option], Assignment]:
    """Displace regular sessions so unplaced institute events fit inside their windows.

    Only sessions block the chosen slot (no other booking, no maintenance, no
    mandatory-group clash). Each displaced session moves to the closest valid
    Week-7 placement: another room at the same time, then the same day, then
    any day. Basket and fixed-slot sessions may only change room.
    """
    from .checker import PlacementChecker  # local import: checker is light, avoids cycles

    active = [r for rid, r in ds.requests.items() if rid not in ds.cancelled]
    order = priority_ranking(ds, active)
    assign = dict(week_assign)
    overrides: list[dict[str, Any]] = []
    forced: dict[str, Option] = {}
    taken: dict[tuple[str, str, int], str] = {}
    for o in chosen.values():
        for p in o.periods:
            taken[(o.room_id, o.day, p)] = o.req_id

    for req_id in order:
        req = ds.requests[req_id]
        if ds.effective_category(req) != "institute_event":
            continue
        if chosen.get(req_id) and chosen[req_id].approved:
            continue
        rooms, _ = suitable_rooms(ds, req)
        done = False
        for day, a, b in window_positions(req):
            for rid in rooms:
                cells = [(rid, day, p) for p in range(a, b + 1)]
                if any((day, p) in ds.room_blocked[rid] for p in range(a, b + 1)):
                    continue
                if any(taken.get(c) not in (None, req_id) for c in cells):
                    continue
                state = WeekState.from_assignment(ds, assign)
                if any(state.group_busy.get((g, day, p)) for g in req.get("mandatory_for_groups", []) for p in range(a, b + 1)):
                    continue
                blockers = sorted({sid for c in cells for sid in state.room_busy.get(c, [])})
                if not blockers:
                    continue
                trial = dict(assign)
                moves = []
                for sid in blockers:
                    spot = _relocate(ds, trial, sid, set(cells), taken, chosen, PlacementChecker)
                    if spot is None:
                        moves = None
                        break
                    trial[sid] = spot
                    moves.append((sid, spot))
                if moves is None:
                    continue
                assign = trial
                for sid, (d2, p2, r2) in moves:
                    overrides.append({"session_id": sid, "day": d2, "start_period": p2, "room_id": r2, "displaced_by": req_id})
                opt = Option(req_id, rid, day, a, b, True)
                forced[req_id] = opt
                for c in cells:
                    taken[c] = req_id
                done = True
                break
            if done:
                break
    return overrides, forced, assign


def _relocate(ds, assign, sid, event_cells, taken, chosen, checker_cls):
    sess = ds.sessions[sid]
    day0, p0, r0 = assign[sid]
    others = {k: v for k, v in assign.items() if k != sid}
    pc = checker_cls(ds, others)
    pinned_time = bool(sess.get("basket_slot") or sess.get("fixed_slot"))
    # Groups that must stay free for approved mandatory events.
    mandatory_cells = set()
    for o in chosen.values():
        req = ds.requests[o.req_id]
        for g in req.get("mandatory_for_groups", []):
            for p in o.periods:
                mandatory_cells.add((g, o.day, p))

    def candidates():
        rooms = sorted(ds.rooms, key=lambda r: ds.rooms[r]["capacity"])
        yield from ((day0, p0, r) for r in rooms if r != r0)
        if pinned_time:
            return
        for p in sorted(range(1, 10), key=lambda q: abs(q - p0)):
            if p != p0:
                yield from ((day0, p, r) for r in rooms)
        for d in sorted(ds.days, key=lambda d: abs(ds.day_index[d] - ds.day_index[day0])):
            if d != day0:
                for p in range(1, 10):
                    yield from ((d, p, r) for r in rooms)

    for day, p, rid in candidates():
        if p + sess["duration"] - 1 > LAST_TEACHING_PERIOD:
            continue
        covered = range(p, p + sess["duration"])
        if any((rid, day, q) in event_cells or (rid, day, q) in taken for q in covered):
            continue
        if any((g, day, q) in mandatory_cells for g in sess["groups"] for q in covered):
            continue
        if not pc.check(sid, day, p, rid):
            return (day, p, rid)
    return None


def _decide(ds: Dataset, req: dict, chosen: dict[str, Option], week: WeekState, rank_of: dict[str, int]) -> Decision:
    rid = req["id"]
    if rid in ds.cancelled:
        c = ds.cancelled[rid]
        when = str(c.get("cancelled_at", ""))[:10]
        note = f" ({c['note']})" if c.get("note") else ""
        return Decision(rid, "rejected", f"Cancelled by {c.get('by', 'the requester')} on {when}{note}; a withdrawn request is never approved.",
                        facts={"cancelled": True})

    notes = _request_notes(ds, req)
    rooms, no_room = suitable_rooms(ds, req)
    if not rooms:
        return Decision(rid, "rejected", " ".join(no_room + notes), facts={"no_suitable_room": True})

    opt = chosen.get(rid)
    if opt is not None and opt.approved:
        cat = CATEGORY_LABEL.get(ds.effective_category(req), ds.effective_category(req))
        article = "an" if cat[0] in "aeiou" else "a"
        reason = f"Approved {ds.rooms[opt.room_id]['name']} ({opt.room_id}), {slot_label(ds, opt.day, opt.start, opt.end)}, as {article} {cat}."
        if req.get("requested_room") and req["requested_room"] != opt.room_id and req["requested_room"] in ds.rooms:
            reason += " " + _why_not_requested_room(ds, req, chosen, week)
        return Decision(rid, "approved", " ".join([reason, *notes]).strip(), opt.room_id, opt.day, opt.start, opt.end)

    why = _why_window_failed(ds, req, rooms, chosen, week, rank_of)
    if opt is not None:
        reason = (
            f"{why} Offered instead: {ds.rooms[opt.room_id]['name']} ({opt.room_id}), "
            f"{slot_label(ds, opt.day, opt.start, opt.end)}."
        )
        return Decision(rid, "alternative_offered", " ".join([reason, *notes]).strip(), opt.room_id, opt.day, opt.start, opt.end)
    return Decision(rid, "rejected", " ".join([why, "No suitable venue is free at any other time either.", *notes]).strip())


def _request_notes(ds: Dataset, req: dict) -> list[str]:
    notes = []
    eff = ds.effective_category(req)
    if req.get("requested_category") != eff:
        notes.append(
            f"Priority: asked for '{CATEGORY_LABEL.get(req.get('requested_category'), req.get('requested_category'))}', "
            f"but a {req.get('role', 'requester').replace('_', ' ')} request is capped at '{CATEGORY_LABEL.get(eff, eff)}'."
        )
    wanted = req.get("requested_room")
    if wanted and wanted not in ds.rooms:
        guess = _closest_room(ds, wanted)
        text = f"Room '{wanted}' does not exist"
        if guess:
            text += f" (did you mean {guess}?"
            g = ds.rooms[guess]
            missing = sorted(set(req.get("needs", [])) - ds.room_features(g))
            if missing:
                text += f" It lacks {', '.join(m.replace('_', ' ') for m in missing)}, so another room was used"
            elif g["capacity"] < req["attendance"]:
                text += f" It seats only {g['capacity']}, so another room was used"
            text += ")"
        notes.append(text + ".")
    elif wanted:
        r = ds.rooms[wanted]
        missing = sorted(set(req.get("needs", [])) - ds.room_features(r))
        if missing:
            notes.append(f"The requested {wanted} lacks {', '.join(m.replace('_', ' ') for m in missing)}.")
        elif r["capacity"] < req["attendance"]:
            notes.append(f"The requested {wanted} seats only {r['capacity']}.")
        elif r["type"] not in req["room_types"]:
            notes.append(f"The requested {wanted} is a {r['type'].replace('_', ' ')}, not one of the requested room types.")
    over = [w for w in req["windows"] if w["to_period"] > LAST_EVENT_PERIOD]
    if over:
        notes.append(f"Events must end by P{LAST_EVENT_PERIOD} (22:00); the window running to P{over[0]['to_period']} cannot be honoured in full.")
    return notes


def _closest_room(ds: Dataset, name: str) -> str | None:
    key = "".join(ch for ch in name.upper() if ch.isalnum())
    best, score = None, 0.0
    for rid, room in ds.rooms.items():
        for label in (rid, room.get("name", "")):
            cand = "".join(ch for ch in label.upper() if ch.isalnum())
            s = SequenceMatcher(None, key, cand).ratio()
            if s > score:
                best, score = rid, s
    return best if score >= 0.6 else None


def _why_not_requested_room(ds: Dataset, req: dict, chosen: dict[str, Option], week: WeekState) -> str:
    wanted = req["requested_room"]
    holders = _holders(ds, req, wanted, chosen, week, req["id"])
    if holders:
        return f"{wanted} was not free: {holders}."
    return f"{wanted} did not meet the request's needs."


def _holders(ds: Dataset, req: dict, rid: str, chosen: dict[str, Option], week: WeekState, me: str) -> str:
    seen: list[str] = []
    for day, a, b in window_positions(req):
        for p in range(a, b + 1):
            for sid in week.room_busy.get((rid, day, p), []):
                label = f"class {sid}"
                if label not in seen:
                    seen.append(label)
            if (day, p) in ds.room_blocked[rid]:
                label = "maintenance"
                if label not in seen:
                    seen.append(label)
            for other in chosen.values():
                if other.req_id != me and other.room_id == rid and other.day == day and other.start <= p <= other.end:
                    o = ds.requests[other.req_id]
                    label = f"{other.req_id} ({o['title']}, {CATEGORY_LABEL.get(ds.effective_category(o))}, higher or equal priority)"
                    if label not in seen:
                        seen.append(label)
    return "; ".join(seen[:4])


def _why_window_failed(ds, req, rooms, chosen, week, rank_of) -> str:
    positions = window_positions(req)
    if not positions:
        return "The requested window is shorter than the event or ends after 22:00, so it cannot be approved as asked."
    blockers: dict[str, set[str]] = defaultdict(set)
    for rid in rooms:
        for day, a, b in positions:
            for p in range(a, b + 1):
                if (day, p) in ds.room_blocked[rid]:
                    blockers["maintenance"].add(rid)
                for sid in week.room_busy.get((rid, day, p), []):
                    blockers["classes"].add(f"{sid} in {rid}")
                for g in req.get("mandatory_for_groups", []):
                    for unit in week.group_busy.get((g, day, p), set()):
                        blockers["groups"].add(f"{g} has {unit} {day} P{p}")
                for other in chosen.values():
                    if other.req_id != req["id"] and other.room_id == rid and other.day == day and other.start <= p <= other.end:
                        blockers["bookings"].add(other.req_id)
    parts = []
    if blockers["bookings"]:
        ids = sorted(blockers["bookings"], key=lambda r: rank_of.get(r, 0))
        desc = ", ".join(f"{i} ({ds.requests[i]['title']})" for i in ids[:4])
        parts.append(f"every suitable venue in the requested window is held by a higher- or equal-priority request: {desc}")
    if blockers["groups"]:
        parts.append("the event is mandatory for groups who have class then (" + "; ".join(sorted(blockers["groups"])[:3]) + ")")
    if blockers["classes"]:
        parts.append("regular classes occupy the suitable rooms (" + ", ".join(sorted(blockers["classes"])[:3]) + ")")
    if blockers["maintenance"]:
        parts.append("rooms closed for maintenance (" + ", ".join(sorted(blockers["maintenance"])) + ")")
    if not parts:
        parts.append("no suitable venue is free in the requested window")
    text = "; ".join(parts)
    return "Not possible as requested: " + text + "."


# ------------------------------------------------------------------ check one
def check_one(
    ds: Dataset, week_assign: Assignment, existing: list[dict[str, Any]], req: dict
) -> dict[str, Any]:
    """Evaluate a single new request against the timetable and existing placed bookings.

    Does not bump existing bookings; returns what would happen right now.
    """
    week = WeekState.from_assignment(ds, week_assign)
    rooms, no_room = suitable_rooms(ds, req)
    notes = _request_notes(ds, req)
    if not rooms:
        return {"status": "rejected", "reason": " ".join(no_room + notes), "options": []}
    taken: dict[tuple[str, str, int], str] = {}
    for d in existing:
        if d.get("status") in ("approved", "alternative_offered") and d.get("room_id"):
            for p in range(d["start_period"], d["end_period"] + 1):
                taken[(d["room_id"], d["day"], p)] = d["request_id"]
    opts = [
        o for o in generate_options(ds, req, week)
        if not any((o.room_id, o.day, p) in taken for p in o.periods)
    ]
    rank = {req["id"]: 0}
    opts.sort(key=lambda o: -option_value(ds, req, o, 0, 1))
    top = [
        {"room_id": o.room_id, "day": o.day, "start_period": o.start, "end_period": o.end, "approved": o.approved}
        for o in opts[:5]
    ]
    if opts and opts[0].approved:
        o = opts[0]
        return {"status": "approved", "room_id": o.room_id, "day": o.day, "start_period": o.start, "end_period": o.end,
                "reason": " ".join([f"{ds.rooms[o.room_id]['name']} ({o.room_id}) is free {slot_label(ds, o.day, o.start, o.end)} and meets every need.", *notes]),
                "options": top}
    fake_chosen = {}
    for (rid_, day, p), other in taken.items():
        d = next(x for x in existing if x["request_id"] == other)
        fake_chosen[other] = Option(other, d["room_id"], d["day"], d["start_period"], d["end_period"], True)
    why = _why_window_failed(ds, req, rooms, {k: v for k, v in fake_chosen.items() if k in ds.requests}, week, rank)
    if opts:
        o = opts[0]
        return {"status": "alternative_offered", "room_id": o.room_id, "day": o.day, "start_period": o.start,
                "end_period": o.end, "reason": " ".join([f"{why} Nearest free option: {o.room_id} {slot_label(ds, o.day, o.start, o.end)}.", *notes]),
                "options": top}
    return {"status": "rejected", "reason": " ".join([why, *notes]), "options": []}
