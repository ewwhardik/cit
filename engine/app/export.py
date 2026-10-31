"""Build ``schedule.json`` documents and gate them on the checker.

An export is refused while it has any hard violation: the file that leaves
the app must be one the official validator scores at zero hard violations.
"""

from __future__ import annotations

from typing import Any

from .checker import Assignment, full_report
from .dataset import Dataset
from .timetable import assignment_rows

DEFAULT_TEAM = "CIT Crunch"


class ExportRefused(Exception):
    def __init__(self, report: dict[str, Any]):
        self.report = report
        super().__init__(f"Export refused: {report['hard_violation_count']} hard violation(s)")


def build_schedule(
    ds: Dataset,
    assignment: Assignment,
    *,
    exams: list[dict[str, Any]] | None = None,
    fest_week: dict[str, Any] | None = None,
    team: str = DEFAULT_TEAM,
) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "team": team,
        "dataset_id": ds.dataset_id,
        "sessions": assignment_rows(assignment),
    }
    if fest_week is not None:
        doc["fest_week"] = fest_week
    if exams is not None:
        doc["exams"] = exams
    return doc


def export_checked(
    ds: Dataset, schedule: dict[str, Any], baseline: dict[str, Any] | None = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return ``(schedule, report)`` or raise :class:`ExportRefused`."""
    report = full_report(ds, schedule, baseline)
    if report["hard_violation_count"] > 0:
        raise ExportRefused(report)
    return schedule, report
