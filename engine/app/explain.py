"""Deterministic explanations ("why is CS203-L1 at 8 AM?", "why can't this move?").

Holds every other session fixed and tests every start time for the session,
recording the *first* rule that blocks each one and the entity behind it
(faculty, group, room). Free start times are then tried in every suitable
room and scored by the soft-penalty change. The output is structured facts
plus a plain summary built from those facts; an LLM may rephrase the
summary for the user but never adds to it.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Iterable

from .checker import Assignment, PlacementChecker, soft_penalties
from .dataset import LAST_TEACHING_PERIOD, Dataset, periods_of

# Order in which time-level rules are reported (first failing rule wins).
TIME_RULES = ("H9", "H14", "H7", "H2", "H3", "H12")
ROOM_RULES = ("H5", "H6", "H10", "H8", "H4")

RULE_LABEL = {
    "H9": "lunch / lab-start / teaching-hours rules",
    "H14": "the session's fixed slot",
    "H7": "faculty unavailability",
    "H2": "the teacher's other classes",
    "H3": "the students' other classes",
    "H12": "the teacher's daily hour limit",
    "H5": "room too small",
    "H6": "wrong room type",
    "H10": "room not accessible",
    "H8": "room maintenance",
    "H4": "room already in use",
}

SOFT_LABEL = {
    "S1": "a time the teacher asked to avoid",
    "S2": "idle gaps for students",
    "S3": "more than 6 hours in a day",
    "S4": "the same course twice in a day",
    "S5": "a room under 40% full",
    "S6": "a 17:00 class",
}


def _period_clock(ds: Dataset, p: int) -> str:
    for row in ds.raw["calendar"].get("periods", []):
        if row["id"] == p:
            return row["start"]
    return f"P{p}"


def explain_session(
    ds: Dataset,
    assign: Assignment,
    sid: str,
    *,
    days: Iterable[str] | None = None,
    starts: Iterable[int] | None = None,
    max_options: int = 8,
) -> dict[str, Any]:
    """Slot-by-slot trace for ``sid`` against the rest of ``assign``."""
    sess = ds.sessions.get(sid)
    if sess is None:
        return {"session_id": sid, "error": f"Unknown session {sid}"}
    dur = sess["duration"]
    day_list = [d for d in ds.days if days is None or d in set(days)]
    start_set = set(starts) if starts is not None else None
    current = assign.get(sid)
    others = {k: v for k, v in assign.items() if k != sid}
    pc = PlacementChecker(ds, others)

    suitable_rooms = [
        rid
        for rid, r in ds.rooms.items()
        if r["type"] in sess["room_types"]
        and r["capacity"] >= sess["size"]
        and (r["accessible"] or not sess.get("needs_accessible"))
    ]
    base_soft = soft_penalties(ds, assign)[1] if current else None

    slots: list[dict[str, Any]] = []
    tally: Counter[str] = Counter()
    blockers_by_rule: dict[str, Counter[str]] = defaultdict(Counter)
    options: list[dict[str, Any]] = []
    probe_room = suitable_rooms[0] if suitable_rooms else next(iter(ds.rooms))

    for day in day_list:
        for p in range(1, LAST_TEACHING_PERIOD + 1):
            if start_set is not None and p not in start_set:
                continue
            if p + dur - 1 > LAST_TEACHING_PERIOD:
                continue
            if current and (day, p) == tuple(current[:2]):
                continue
            # Time-level rules do not depend on the room; probe with any room.
            found = [b for b in pc.check(sid, day, p, probe_room) if b.rule in TIME_RULES]
            if found:
                first = min(found, key=lambda b: TIME_RULES.index(b.rule))
                tally[first.rule] += 1
                for name in first.blockers:
                    blockers_by_rule[first.rule][name] += 1
                slots.append({"day": day, "start_period": p, "ok": False, "rule": first.rule, "reason": first.reason})
                continue
            free_rooms = []
            room_reasons: Counter[str] = Counter()
            for rid in suitable_rooms:
                bad = [b for b in pc.check(sid, day, p, rid) if b.rule in ROOM_RULES]
                if bad:
                    room_reasons[bad[0].rule] += 1
                else:
                    free_rooms.append(rid)
            if not free_rooms:
                rule = room_reasons.most_common(1)[0][0] if room_reasons else "H6"
                tally[rule] += 1
                slots.append({"day": day, "start_period": p, "ok": False, "rule": rule,
                              "reason": f"No suitable room is free ({len(suitable_rooms)} rooms fit the session)"})
                continue
            tally["free"] += 1
            # Score the snuggest free room (keeps big halls for big classes).
            rid = min(free_rooms, key=lambda r: ds.rooms[r]["capacity"])
            delta = None
            if current:
                moved = dict(assign)
                moved[sid] = (day, p, rid)
                delta = soft_penalties(ds, moved)[1] - (base_soft or 0)
            slots.append({"day": day, "start_period": p, "ok": True, "rooms": free_rooms})
            options.append({"day": day, "start_period": p, "room_id": rid, "rooms": free_rooms, "soft_delta": delta})

    options.sort(key=lambda o: (o["soft_delta"] if o["soft_delta"] is not None else 0, ds.day_index[o["day"]], o["start_period"]))
    current_info = _current_info(ds, assign, sid) if current else None
    facts = {
        "session_id": sid,
        "session": {k: sess[k] for k in ("course_id", "kind", "groups", "faculty_id", "size", "duration")},
        "current": current_info,
        "checked_start_times": sum(tally.values()),
        "blocked_by": {k: v for k, v in tally.items() if k != "free"},
        "free_start_times": tally.get("free", 0),
        "top_blockers": {r: [n for n, _ in c.most_common(3)] for r, c in blockers_by_rule.items()},
        "suitable_rooms": suitable_rooms,
        "options": options[:max_options],
        "slots": slots,
    }
    facts["summary"] = _summary(ds, facts)
    return facts


def _current_info(ds: Dataset, assign: Assignment, sid: str) -> dict[str, Any]:
    day, p, rid = assign[sid]
    sess = ds.sessions[sid]
    others = {k: v for k, v in assign.items() if k != sid}
    with_it = soft_penalties(ds, assign)[0]
    without = soft_penalties(ds, others)[0]
    contrib = {k: with_it[k] - without[k] for k in with_it if with_it[k] != without[k]}
    reasons = []
    for pref in ds.faculty.get(sess["faculty_id"], {}).get("preferences", []):
        if pref.get("type") == "avoid" and day in pref.get("days", ds.days):
            hit = [q for q in periods_of(p, sess["duration"]) if q in pref.get("periods", [])]
            if hit:
                reasons.append(f"{sess['faculty_id']} asked to avoid this time ({pref.get('note', 'preference')})")
    return {"day": day, "start_period": p, "room_id": rid, "clock": _period_clock(ds, p),
            "soft_contribution": contrib, "preference_notes": reasons}


def _summary(ds: Dataset, f: dict[str, Any]) -> str:
    sess = f["session"]
    parts = []
    cur = f["current"]
    if cur:
        parts.append(
            f"{f['session_id']} ({sess['course_id']} {sess['kind']}, {', '.join(sess['groups'])}, "
            f"{sess['faculty_id']}) is on {cur['day']} P{cur['start_period']} ({cur['clock']}) in {cur['room_id']}."
        )
    n = f["checked_start_times"]
    blocked = f["blocked_by"]
    if n:
        pieces = []
        for rule in (*TIME_RULES, *ROOM_RULES):
            if blocked.get(rule):
                label = RULE_LABEL[rule]
                fac, grp = sess["faculty_id"], ", ".join(sess["groups"])
                label = label.replace("the teacher's", f"{fac}'s").replace("faculty unavailability", f"{fac}'s unavailability")
                label = label.replace("the students'", f"{grp}'s")
                pieces.append(f"{blocked[rule]} by {label}")
        alt = "other " if cur else ""
        nblocked = sum(blocked.values())
        free = f["free_start_times"]
        text = f"Of {n} {alt}start times, "
        if pieces:
            text += f"{nblocked} {'is' if nblocked == 1 else 'are'} blocked ({'; '.join(pieces)}) and "
        text += f"{free} {'is' if free == 1 else 'are'} free."
        parts.append(text)
    if cur and cur["soft_contribution"]:
        costs = ", ".join(f"{SOFT_LABEL.get(k, k)} (+{v})" for k, v in cur["soft_contribution"].items() if v > 0)
        if costs:
            parts.append(f"Here it costs {costs}.")
    if cur and cur["preference_notes"]:
        parts.append(" ".join(cur["preference_notes"]) + ".")
    if f["options"]:
        o = f["options"][0]
        if o["soft_delta"] is None:
            parts.append(f"The best free option is {o['day']} P{o['start_period']} in {o['room_id']}.")
        elif o["soft_delta"] >= 0:
            parts.append(
                f"Every free alternative is no better: the best, {o['day']} P{o['start_period']} in {o['room_id']}, "
                f"would change the soft penalty by {o['soft_delta']:+d}. That is why it stays where it is."
            )
        else:
            parts.append(f"Moving to {o['day']} P{o['start_period']} in {o['room_id']} would improve the soft penalty by {-o['soft_delta']}.")
    elif n:
        parts.append("There is no other valid place for it while everything else stays put.")
    return " ".join(parts)


def explain_unplaceable(ds: Dataset, assign: Assignment, sid: str, **kw: Any) -> str:
    """One sentence on why ``sid`` cannot go anywhere (used for infeasibility reports)."""
    f = explain_session(ds, {k: v for k, v in assign.items() if k != sid}, sid, **kw)
    if f.get("error"):
        return f["error"]
    sess = f["session"]
    if not f["suitable_rooms"]:
        return (f"{sid} needs a {'/'.join(ds.sessions[sid]['room_types'])} for {sess['size']} students"
                f"{' (accessible)' if ds.sessions[sid].get('needs_accessible') else ''}; no room qualifies.")
    pieces = []
    for rule in (*TIME_RULES, *ROOM_RULES):
        if f["blocked_by"].get(rule):
            who = f["top_blockers"].get(rule) or []
            pieces.append(f"{f['blocked_by'][rule]} by {RULE_LABEL[rule]}" + (f" ({', '.join(who[:3])})" if who else ""))
    return (f"{sid} ({sess['course_id']}, {', '.join(sess['groups'])}, {sess['faculty_id']}) has no valid slot: of "
            f"{f['checked_start_times']} start times, " + ", ".join(pieces) + ".")
