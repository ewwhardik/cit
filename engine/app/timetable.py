"""Weekly timetable solver (OR-Tools CP-SAT).

Model
-----
* A *unit* is either a single session or a whole elective basket slot (all
  sessions of a basket share one start, which enforces H11 by construction).
* ``x[u, c]``  - unit ``u`` starts at candidate slot ``c = (day, period)``.
* ``y[s, r]``  - session ``s`` uses room ``r``.
* ``t[u] = sum(stride * day + period) * x[u, c]`` - start time on a single
  axis; a day stride of 20 keeps different days from ever overlapping.
* Optional interval ``(t[u], duration, y[s, r])`` per (session, room) and one
  ``NoOverlap`` per room, including fixed blocker intervals for room
  maintenance windows (H4, H8).

Pruned out of the domains before solving: teaching periods, lunch crossing
and lab starts (H9), fixed slots (H14), faculty unavailability (H7), room
capacity / type / accessibility (H5, H6, H10).

Linear constraints: exactly one start and one room (H1), faculty and group
occupancy at most one per period (H2, H3 - basket units count once), faculty
daily hours (H12).

The optional objective reproduces the scorer's soft penalties S1-S6 with the
same weights, plus an optional "stay close to a baseline" term used by the
repair flow (fewest sessions moved).
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable

from ortools.sat.python import cp_model

from .checker import Assignment, Placement
from .dataset import LAST_EVENT_PERIOD, LAST_TEACHING_PERIOD, Dataset, periods_of

DAY_STRIDE = 20

ProgressFn = Callable[[dict[str, Any]], None]


@dataclass
class SolveOptions:
    time_limit_s: float = 60.0
    workers: int = 8
    seed: int = 7
    optimize: bool = True
    #: Phase-1 (feasibility) time budget when ``optimize`` is on.
    feasibility_time_s: float = 15.0
    #: Placements to keep exactly (session id -> placement).
    pinned: dict[str, Placement] = field(default_factory=dict)
    #: Baseline to stay close to; moving a session costs ``move_weight``,
    #: changing its time costs an extra ``time_change_weight``.
    baseline: Assignment | None = None
    move_weight: int = 1000
    time_change_weight: int = 5
    #: Weight of the soft penalty in the objective.
    soft_weight: int = 1
    #: Starting point for the search (session id -> placement).
    hint: Assignment | None = None
    #: (room_id, day, period) cells to keep free if at all possible, with a weight each.
    reserve_cells: dict[tuple[str, str, int], int] = field(default_factory=dict)
    #: (group_id, day, period) cells to keep free if at all possible, with a weight each.
    reserve_group_cells: dict[tuple[str, str, int], int] = field(default_factory=dict)
    #: Optional event placements that compete with sessions for rooms and groups
    #: (used to leave space for Spectra-week bookings). Each placed option earns ``value``.
    event_options: list["EventOption"] = field(default_factory=list)
    #: Per-session domain restrictions: sid -> {"days": [...], "starts": [...], "rooms": [...]}
    #: (any key may be omitted). Used for "move my lab to Friday" style requests.
    restrict: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: Allow units to stay unplaced at a large cost; used to diagnose infeasibility
    #: ("which session cannot fit, and what blocks it").
    allow_unplaced: bool = False
    unplaced_weight: int = 100_000


@dataclass(frozen=True)
class EventOption:
    key: str  # request id; at most one option per key is chosen
    room_id: str
    day: str
    start: int
    end: int  # inclusive, may run past P9
    value: int
    mandatory_groups: tuple[str, ...] = ()


@dataclass
class SolveResult:
    status: str  # "optimal" | "feasible" | "infeasible" | "unknown" | "invalid"
    assignment: Assignment
    objective: float | None
    wall_time_s: float
    diagnostics: list[str]
    stats: dict[str, Any]

    @property
    def ok(self) -> bool:
        return self.status in ("optimal", "feasible")


@dataclass
class _Unit:
    key: str
    sessions: list[str]
    duration: int
    starts: list[tuple[str, int]]
    groups: set[str]


class TimetableModel:
    """Builds the CP-SAT model for a dataset. Use :func:`solve_timetable`."""

    def __init__(self, ds: Dataset, opts: SolveOptions):
        self.ds = ds
        self.opts = opts
        self.model = cp_model.CpModel()
        self.diagnostics: list[str] = []
        self.units: dict[str, _Unit] = {}
        self.unit_of: dict[str, str] = {}
        self.x: dict[tuple[str, tuple[str, int]], cp_model.IntVar] = {}
        self.y: dict[tuple[str, str], cp_model.IntVar] = {}
        self.t: dict[str, cp_model.IntVar] = {}
        self.rooms_of: dict[str, list[str]] = {}
        self.unplaced: dict[str, cp_model.IntVar] = {}
        self.soft_terms: list[tuple[int, Any]] = []  # (weight, linear expr) - for reporting
        self.objective_terms: list[Any] = []

        self._build_units()
        if self.diagnostics:
            return
        self._build_vars()
        self._event_vars()
        self._room_constraints()
        self._faculty_constraints()
        self._group_constraints()
        self._event_group_constraints()
        self._symmetry_constraints()
        if opts.optimize:
            self._soft_objective()
        self._reservations()
        self._baseline_terms()
        self._hint()
        if self.objective_terms:
            self.model.Minimize(sum(self.objective_terms))

    # ------------------------------------------------------------- domains
    def candidate_starts(self, sid: str) -> list[tuple[str, int]]:
        ds = self.ds
        s = ds.sessions[sid]
        dur = s["duration"]
        fixed = s.get("fixed_slot")
        pinned = self.opts.pinned.get(sid)
        out = []
        for day in ds.days:
            for p in range(1, LAST_TEACHING_PERIOD - dur + 2):
                if ds.crosses_lunch(p, dur):
                    continue
                if s["kind"] == "lab" and p not in ds.lab_starts:
                    continue
                if fixed and (fixed["day"], fixed["start_period"]) != (day, p):
                    continue
                if pinned and (pinned[0], pinned[1]) != (day, p):
                    continue
                r = self.opts.restrict.get(sid, {})
                if r.get("days") and day not in r["days"]:
                    continue
                if r.get("starts") and p not in r["starts"]:
                    continue
                if any((day, q) in ds.faculty_blocked[s["faculty_id"]] for q in periods_of(p, dur)):
                    continue
                out.append((day, p))
        return out

    def candidate_rooms(self, sid: str) -> list[str]:
        s = self.ds.sessions[sid]
        pinned = self.opts.pinned.get(sid)
        out = []
        for rid, r in self.ds.rooms.items():
            if pinned and pinned[2] != rid:
                continue
            allowed = self.opts.restrict.get(sid, {}).get("rooms")
            if allowed and rid not in allowed:
                continue
            if r["type"] not in s["room_types"] or r["capacity"] < s["size"]:
                continue
            if s.get("needs_accessible") and not r["accessible"]:
                continue
            out.append(rid)
        return out

    def _build_units(self) -> None:
        ds = self.ds
        baskets: dict[str, list[str]] = defaultdict(list)
        for sid, s in ds.sessions.items():
            if s.get("basket_slot"):
                baskets[s["basket_slot"]].append(sid)
            else:
                self._add_unit(sid, [sid])
        for slot, sids in baskets.items():
            self._add_unit(f"basket:{slot}", sids)

    def _add_unit(self, key: str, sids: list[str]) -> None:
        ds = self.ds
        durations = {ds.sessions[s]["duration"] for s in sids}
        if len(durations) > 1:
            self.diagnostics.append(f"Basket {key} mixes session durations {sorted(durations)}")
            return
        starts = None
        for sid in sids:
            cs = set(self.candidate_starts(sid))
            starts = cs if starts is None else starts & cs
            if not self.candidate_rooms(sid) and not self.opts.allow_unplaced:
                s = ds.sessions[sid]
                self.diagnostics.append(
                    f"{sid}: no room is a {'/'.join(s['room_types'])} with {s['size']}+ seats"
                    + (" and accessible" if s.get("needs_accessible") else "")
                )
        ordered = [c for c in ((d, p) for d in ds.days for p in range(1, 10)) if c in (starts or set())]
        if not ordered and not self.opts.allow_unplaced:
            names = ", ".join(sids)
            self.diagnostics.append(
                f"{names}: no valid start time (teaching hours, lunch, lab starts, fixed slot and faculty unavailability leave nothing)"
            )
        groups = set().union(*(ds.sessions[s]["groups"] for s in sids))
        unit = _Unit(key, sids, durations.pop(), ordered, groups)
        self.units[key] = unit
        for sid in sids:
            self.unit_of[sid] = key

    # ----------------------------------------------------------- variables
    def _time(self, day: str, period: int) -> int:
        return DAY_STRIDE * self.ds.day_index[day] + period

    def _build_vars(self) -> None:
        m = self.model
        horizon = DAY_STRIDE * len(self.ds.days) + DAY_STRIDE
        for u in self.units.values():
            xs = []
            for c in u.starts:
                v = m.NewBoolVar(f"x[{u.key},{c[0]}{c[1]}]")
                self.x[(u.key, c)] = v
                xs.append(v)
            gone = None
            if self.opts.allow_unplaced:
                gone = m.NewBoolVar(f"unplaced[{u.key}]")
                self.unplaced[u.key] = gone
                m.Add(sum(xs) + gone == 1)
                self.objective_terms.append(self.opts.unplaced_weight * gone)
            else:
                m.AddExactlyOne(xs)
            t = m.NewIntVar(0, horizon, f"t[{u.key}]")
            m.Add(t == sum(self._time(*c) * self.x[(u.key, c)] for c in u.starts))
            self.t[u.key] = t
            for sid in u.sessions:
                ys = []
                self.rooms_of[sid] = self.candidate_rooms(sid)
                for rid in self.rooms_of[sid]:
                    v = m.NewBoolVar(f"y[{sid},{rid}]")
                    self.y[(sid, rid)] = v
                    ys.append(v)
                if gone is not None:
                    m.Add(sum(ys) + gone == 1)
                else:
                    m.AddExactlyOne(ys)

    def covers(self, ukey: str, day: str, period: int) -> list[cp_model.IntVar]:
        """Start literals of unit ``ukey`` that make it occupy (day, period)."""
        u = self.units[ukey]
        return [
            self.x[(ukey, (d, p))]
            for (d, p) in u.starts
            if d == day and p <= period < p + u.duration
        ]

    def _event_vars(self) -> None:
        self.event_lits: dict[EventOption, cp_model.IntVar] = {}
        by_key: dict[str, list] = defaultdict(list)
        for opt in self.opts.event_options:
            if opt.room_id not in self.ds.rooms or opt.day not in self.ds.day_index:
                continue
            v = self.model.NewBoolVar(f"ev[{opt.key},{opt.room_id},{opt.day}{opt.start}]")
            self.event_lits[opt] = v
            by_key[opt.key].append(v)
            self.objective_terms.append(-opt.value * v)
        for lits in by_key.values():
            self.model.AddAtMostOne(lits)

    def _event_group_constraints(self) -> None:
        for opt, v in self.event_lits.items():
            for g in opt.mandatory_groups:
                for p in range(opt.start, min(opt.end, LAST_TEACHING_PERIOD) + 1):
                    lits = self.group_occ.get((g, opt.day, p), [])
                    if lits:
                        self.model.Add(v + sum(lits) <= 1)

    def chosen_events(self, solver) -> list[EventOption]:
        return [o for o, v in self.event_lits.items() if solver.Value(v)]

    # --------------------------------------------------------- constraints
    def _room_constraints(self) -> None:
        m, ds = self.model, self.ds
        per_room: dict[str, list] = defaultdict(list)
        for opt, v in self.event_lits.items():
            size = opt.end - opt.start + 1
            t0 = self._time(opt.day, opt.start)
            per_room[opt.room_id].append(m.NewOptionalIntervalVar(t0, size, t0 + size, v, f"evi[{opt.key}]"))
        for (sid, rid), lit in self.y.items():
            u = self.units[self.unit_of[sid]]
            iv = m.NewOptionalFixedSizeIntervalVar(self.t[u.key], u.duration, lit, f"iv[{sid},{rid}]")
            per_room[rid].append(iv)
        for rid, ivs in per_room.items():
            for day, p in sorted(ds.room_blocked.get(rid, ())):
                if day in ds.day_index and 1 <= p <= LAST_EVENT_PERIOD:
                    ivs.append(m.NewIntervalVar(self._time(day, p), 1, self._time(day, p) + 1, f"blk[{rid},{day}{p}]"))
            if len(ivs) > 1:
                m.AddNoOverlap(ivs)

    def _faculty_constraints(self) -> None:
        m, ds = self.model, self.ds
        by_faculty: dict[str, set[str]] = defaultdict(set)
        for sid, s in ds.sessions.items():
            by_faculty[s["faculty_id"]].add(self.unit_of[sid])
        for fid, ukeys in by_faculty.items():
            for day in ds.days:
                hours = []
                for ukey in ukeys:
                    u = self.units[ukey]
                    n = sum(1 for s in u.sessions if ds.sessions[s]["faculty_id"] == fid)
                    hours += [n * u.duration * self.x[(ukey, c)] for c in u.starts if c[0] == day]
                    if n > 1:  # two basket sessions of one teacher can never run together
                        for c in u.starts:
                            m.Add(self.x[(ukey, c)] == 0)
                if hours:
                    m.Add(sum(hours) <= ds.max_hours(fid))
                for p in range(1, LAST_TEACHING_PERIOD + 1):
                    lits = [lit for ukey in ukeys for lit in self.covers(ukey, day, p)]
                    if len(lits) > 1:
                        m.AddAtMostOne(lits)

    def _group_constraints(self) -> None:
        m, ds = self.model, self.ds
        self.group_units: dict[str, list[str]] = defaultdict(list)
        for u in self.units.values():
            for g in u.groups:
                self.group_units[g].append(u.key)
        self.group_occ: dict[tuple[str, str, int], list] = {}
        for g, ukeys in self.group_units.items():
            for day in ds.days:
                for p in range(1, LAST_TEACHING_PERIOD + 1):
                    lits = [lit for ukey in ukeys for lit in self.covers(ukey, day, p)]
                    self.group_occ[(g, day, p)] = lits
                    if len(lits) > 1:
                        m.AddAtMostOne(lits)

    def _symmetry_constraints(self) -> None:
        """Break symmetry between interchangeable multi-lecture sessions of the same course and cohort."""
        if self.opts.baseline or self.opts.allow_unplaced:
            return
        ds = self.ds
        multi: dict[tuple, list[str]] = defaultdict(list)
        for sid, s in ds.sessions.items():
            if (
                s["kind"] == "lecture"
                and not s.get("basket_slot")
                and not s.get("fixed_slot")
                and sid not in self.opts.pinned
                and sid not in self.opts.restrict
            ):
                key = (s["course_id"], tuple(sorted(s["groups"])), s["faculty_id"])
                multi[key].append(sid)
        for sids in multi.values():
            if len(sids) > 1:
                ordered = sorted(sids)
                for i in range(len(ordered) - 1):
                    u1 = self.units.get(self.unit_of.get(ordered[i], ""))
                    u2 = self.units.get(self.unit_of.get(ordered[i + 1], ""))
                    if u1 and u2 and u1.key in self.t and u2.key in self.t:
                        self.model.Add(self.t[u1.key] < self.t[u2.key])

    # ----------------------------------------------------------- objective
    def _soft(self, weight: int, expr: Any, key: str) -> None:
        self.soft_terms.append((key, weight, expr))
        self.objective_terms.append(self.opts.soft_weight * weight * expr)

    def _soft_objective(self) -> None:
        m, ds = self.model, self.ds
        for u in self.units.values():
            for c in u.starts:
                day, p = c
                covered = list(periods_of(p, u.duration))
                s1 = 0
                for sid in u.sessions:
                    for pref in ds.faculty.get(ds.sessions[sid]["faculty_id"], {}).get("preferences", []):
                        if pref.get("type") == "avoid" and day in pref.get("days", ds.days):
                            s1 += 2 * sum(1 for q in covered if q in pref["periods"])
                if s1:
                    self._soft(1, s1 * self.x[(u.key, c)], "S1")
                if LAST_TEACHING_PERIOD in covered:
                    self._soft(1, len(u.sessions) * self.x[(u.key, c)], "S6")
        for (sid, rid), lit in self.y.items():
            r, s = ds.rooms[rid], ds.sessions[sid]
            if r["capacity"] and s["size"] / r["capacity"] < 0.4:
                self._soft(1, lit, "S5")

        for g, ukeys in self.group_units.items():
            for day in ds.days:
                # S3: more than 6 hours in a day (basket counted once per group).
                hours = [
                    self.units[k].duration * self.x[(k, c)]
                    for k in ukeys
                    for c in self.units[k].starts
                    if c[0] == day
                ]
                if hours:
                    over = m.NewIntVar(0, 9, f"over[{g},{day}]")
                    m.Add(over >= sum(hours) - 6)
                    self._soft(3, over, "S3")
                # S4: same course lectured twice in a day (non-basket).
                by_course: dict[str, list] = defaultdict(list)
                for k in ukeys:
                    u = self.units[k]
                    if len(u.sessions) == 1 and not k.startswith("basket:"):
                        s = ds.sessions[u.sessions[0]]
                        if s["kind"] == "lecture":
                            by_course[s["course_id"]] += [self.x[(k, c)] for c in u.starts if c[0] == day]
                for course, lits in by_course.items():
                    if len(lits) > 1:
                        extra = m.NewIntVar(0, len(lits), f"dup[{g},{day},{course}]")
                        m.Add(extra >= sum(lits) - 1)
                        self._soft(3, extra, "S4")
                # S2: idle periods between the first and last class.
                occ = []
                for p in range(1, LAST_TEACHING_PERIOD + 1):
                    lits = self.group_occ.get((g, day, p), [])
                    o = m.NewBoolVar(f"occ[{g},{day},{p}]")
                    m.Add(o == sum(lits)) if lits else m.Add(o == 0)
                    occ.append(o)
                n = len(occ)
                before = [m.NewBoolVar(f"bef[{g},{day},{i}]") for i in range(n)]
                after = [m.NewBoolVar(f"aft[{g},{day},{i}]") for i in range(n)]
                m.Add(before[0] == 0)
                m.Add(after[n - 1] == 0)
                for i in range(1, n):
                    m.Add(before[i] >= before[i - 1])
                    m.Add(before[i] >= occ[i - 1])
                for i in range(n - 2, -1, -1):
                    m.Add(after[i] >= after[i + 1])
                    m.Add(after[i] >= occ[i + 1])
                for i in range(n):
                    gap = m.NewBoolVar(f"gap[{g},{day},{i}]")
                    m.Add(gap >= before[i] + after[i] - 1 - occ[i])
                    self._soft(1, gap, "S2")

        # S4 for baskets: one course's basket lectures twice on a day.
        basket_course: dict[tuple[str, str], list] = defaultdict(list)
        for u in self.units.values():
            if not u.key.startswith("basket:"):
                continue
            for sid in u.sessions:
                course = ds.sessions[sid]["course_id"]
                for c in u.starts:
                    basket_course[(course, c[0])].append(self.x[(u.key, c)])
        for (course, day), lits in basket_course.items():
            if len(lits) > 1:
                extra = m.NewIntVar(0, len(lits), f"bdup[{course},{day}]")
                m.Add(extra >= sum(lits) - 1)
                self._soft(3, extra, "S4")

    def _reservations(self) -> None:
        """Soft "keep this cell free" terms (used to leave room for Spectra bookings)."""
        for (rid, day, p), weight in self.opts.reserve_cells.items():
            for (sid, r), ylit in self.y.items():
                if r != rid:
                    continue
                for xlit in self.covers(self.unit_of[sid], day, p):
                    both = self.model.NewBoolVar("")
                    self.model.AddBoolAnd([xlit, ylit]).OnlyEnforceIf(both)
                    self.model.AddBoolOr([xlit.Not(), ylit.Not()]).OnlyEnforceIf(both.Not())
                    self.objective_terms.append(weight * both)
        for (g, day, p), weight in self.opts.reserve_group_cells.items():
            lits = self.group_occ.get((g, day, p), [])
            if lits:
                self.objective_terms.append(weight * sum(lits))

    def _baseline_terms(self) -> None:
        base = self.opts.baseline
        if not base:
            return
        for sid in self.ds.sessions:
            if sid not in base:
                continue
            day, p, rid = base[sid]
            ukey = self.unit_of[sid]
            same_time = self.x.get((ukey, (day, p)))
            same_room = self.y.get((sid, rid))
            if same_time is None or same_room is None:
                self.objective_terms.append(self.opts.move_weight + (self.opts.time_change_weight if same_time is None else 0))
                continue
            stay = self.model.NewBoolVar(f"stay[{sid}]")
            self.model.AddBoolAnd([same_time, same_room]).OnlyEnforceIf(stay)
            self.model.AddBoolOr([same_time.Not(), same_room.Not()]).OnlyEnforceIf(stay.Not())
            self.objective_terms.append(self.opts.move_weight * (1 - stay))
            self.objective_terms.append(self.opts.time_change_weight * (1 - same_time))

    def _hint(self) -> None:
        hint = self.opts.hint or self.opts.baseline
        if not hint:
            return
        hinted_units: set[str] = set()
        for sid, (day, p, rid) in hint.items():
            if sid not in self.unit_of:
                continue
            ukey = self.unit_of[sid]
            if ukey not in hinted_units:
                hinted_units.add(ukey)
                for c in self.units[ukey].starts:
                    self.model.AddHint(self.x[(ukey, c)], c == (day, p))
            for r2 in self.rooms_of[sid]:
                self.model.AddHint(self.y[(sid, r2)], r2 == rid)

    # ------------------------------------------------------------- extract
    def extract(self, solver: cp_model.CpSolver | cp_model.CpSolverSolutionCallback) -> Assignment:
        value = solver.Value if hasattr(solver, "Value") else solver.value
        out: Assignment = {}
        for u in self.units.values():
            if u.key in self.unplaced and value(self.unplaced[u.key]):
                continue
            start = next(c for c in u.starts if value(self.x[(u.key, c)]))
            for sid in u.sessions:
                room = next(r for r in self.rooms_of[sid] if value(self.y[(sid, r)]))
                out[sid] = (start[0], start[1], room)
        return out


class _Progress(cp_model.CpSolverSolutionCallback):
    def __init__(self, tm: TimetableModel, on_progress: ProgressFn | None, phase: str):
        super().__init__()
        self.tm = tm
        self.on_progress = on_progress
        self.phase = phase
        self.t0 = time.monotonic()
        self.solutions = 0

    def on_solution_callback(self) -> None:  # noqa: N802 (OR-Tools API name)
        self.solutions += 1
        if self.on_progress:
            self.on_progress(
                {
                    "phase": self.phase,
                    "solutions": self.solutions,
                    "objective": self.ObjectiveValue() if self.tm.objective_terms else 0,
                    "bound": self.BestObjectiveBound() if self.tm.objective_terms else 0,
                    "elapsed_s": round(time.monotonic() - self.t0, 2),
                }
            )


_STATUS = {
    cp_model.OPTIMAL: "optimal",
    cp_model.FEASIBLE: "feasible",
    cp_model.INFEASIBLE: "infeasible",
    cp_model.MODEL_INVALID: "invalid",
    cp_model.UNKNOWN: "unknown",
}


def _run(tm: TimetableModel, time_limit: float, opts: SolveOptions, on_progress, phase: str):
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(1.0, time_limit)
    solver.parameters.num_workers = opts.workers
    solver.parameters.random_seed = opts.seed
    cb = _Progress(tm, on_progress, phase)
    status = solver.Solve(tm.model, cb)
    return solver, status


def solve_timetable(
    ds: Dataset, opts: SolveOptions | None = None, on_progress: ProgressFn | None = None
) -> SolveResult:
    """Solve the timetable.

    * With a baseline (repairs, change requests): one model with the full
      objective, hinted at the baseline (CP-SAT repairs the hint), using the
      whole time budget - the baseline is nearly feasible already.
    * Otherwise two phases: find a feasible timetable (this phase may use any
      time left over if it needs more than ``feasibility_time_s``), then
      optimise from it.
    """
    opts = opts or SolveOptions()
    t0 = time.monotonic()
    elapsed = lambda: time.monotonic() - t0  # noqa: E731

    if opts.baseline:
        tm = TimetableModel(ds, SolveOptions(**{**opts.__dict__, "hint": opts.hint or opts.baseline}))
        if tm.diagnostics:
            return SolveResult("infeasible", {}, None, elapsed(), tm.diagnostics, {})
        solver, status = _run(tm, opts.time_limit_s, opts, on_progress, "optimise")
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return SolveResult(_STATUS[status], tm.extract(solver), solver.ObjectiveValue(), elapsed(), [],
                               {"solve_s": round(solver.WallTime(), 2), "bound": solver.BestObjectiveBound()})
        msg = ("The constraints cannot all be satisfied together." if status == cp_model.INFEASIBLE
               else f"No valid timetable found within {opts.time_limit_s:.0f}s; try a larger time budget.")
        return SolveResult(_STATUS.get(status, "unknown"), {}, None, elapsed(), [msg], {})

    # Phase 1: feasibility only.
    phase1_opts = SolveOptions(**{**opts.__dict__, "optimize": False, "reserve_cells": {}, "reserve_group_cells": {}, "event_options": []})
    tm1 = TimetableModel(ds, phase1_opts)
    if tm1.diagnostics:
        return SolveResult("infeasible", {}, None, elapsed(), tm1.diagnostics, {})
    needs_phase2 = bool(opts.optimize or opts.reserve_cells or opts.reserve_group_cells or opts.event_options)
    budget = opts.feasibility_time_s if needs_phase2 else opts.time_limit_s
    solver1, status1 = _run(tm1, budget, opts, on_progress, "feasibility")
    if status1 == cp_model.UNKNOWN and opts.time_limit_s - elapsed() > 3:
        # Harder instance than usual: give feasibility the rest of the budget.
        solver1, status1 = _run(tm1, opts.time_limit_s - elapsed(), opts, on_progress, "feasibility")
    if status1 not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        msg = ("The constraints cannot all be satisfied together." if status1 == cp_model.INFEASIBLE
               else f"No timetable found within {opts.time_limit_s:.0f}s; try a larger time budget.")
        return SolveResult(_STATUS.get(status1, "unknown"), {}, None, elapsed(), [msg], {})
    first = tm1.extract(solver1)
    if not needs_phase2 or opts.time_limit_s - elapsed() < 2:
        return SolveResult("feasible", first, None, elapsed(), [], {"phase1_s": round(elapsed(), 2)})

    # Phase 2: optimise, starting from the phase-1 solution.
    tm2 = TimetableModel(ds, SolveOptions(**{**opts.__dict__, "hint": first}))
    solver2, status2 = _run(tm2, max(1.0, opts.time_limit_s - elapsed()), opts, on_progress, "optimise")
    if status2 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolveResult(
            _STATUS[status2], tm2.extract(solver2), solver2.ObjectiveValue(), elapsed(), [],
            {"phase1_s": round(solver1.WallTime(), 2), "phase2_s": round(solver2.WallTime(), 2),
             "bound": solver2.BestObjectiveBound()},
        )
    return SolveResult("feasible", first, None, elapsed(),
                       ["Optimisation phase found nothing better; returning the feasible timetable."],
                       {"phase1_s": round(solver1.WallTime(), 2)})


def assignment_rows(assign: Assignment) -> list[dict[str, Any]]:
    return [
        {"session_id": sid, "day": d, "start_period": p, "room_id": r}
        for sid, (d, p, r) in sorted(assign.items())
    ]
