"""Shared bounding helpers for per-activity prompt blocks (PILOT-1).

Every variable-length block composed into the tutor's prompt is bounded at
source — the reasoning is in ``adk/teacher_focus.py``'s budget comment: the
composed instruction rides EVERY turn, and long system prompts dilute
instruction-following, so the tutor that has just been told a table is empty
should not lose that among 11,000 characters.

``teacher_focus._fit_lines`` and ``element_manifest._fit`` are the same ten
lines twice over. PILOT-1 would have made it four times; this is the third
copy's home instead. The two existing copies are deliberately left alone —
re-baselining shipped prompt composition four days before a teacher pilot buys
nothing, and they can fold in here afterwards.

``short_date`` is here rather than in either progress module because both
summaries render a stored timestamp and the two must not drift apart in how
they say it.
"""

from __future__ import annotations

from typing import Any


def fit_lines(lines: list[str], budget: int) -> tuple[list[str], int]:
    """Take as many whole lines as fit; report how many were dropped.

    Item-wise, never mid-line: a block truncated inside a sentence reads to the
    model as a corrupted instruction rather than a shortened list.
    """
    kept: list[str] = []
    used = 0
    for i, line in enumerate(lines):
        cost = len(line) + 1
        if used + cost > budget:
            return kept, len(lines) - i
        kept.append(line)
        used += cost
    return kept, 0


def clip(text: str, limit: int) -> str:
    """Truncate on a word boundary with a visible marker."""
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] + "…"


def short_date(raw: Any) -> str:
    """`` on 2026-08-07`` from a stored ISO timestamp, or ``""`` when unusable.

    Age is the one fact that distinguishes this morning's work from three weeks
    ago's, and it is already in both progress stores. Degrades to silence rather
    than printing a raw timestamp at a student.
    """
    if not raw:
        return ""
    date = str(raw)[:10]
    return f" on {date}" if len(date) == 10 and date[4] == "-" else ""


__all__ = ["clip", "fit_lines", "short_date"]
