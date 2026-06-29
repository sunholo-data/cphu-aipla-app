"""Deterministic live-class signals (1.1.31 M0, un-gated).

Per-group activity signals a teacher can read *during* the lesson — active/idle,
turns this lesson, last-activity, and a "stuck" heuristic — computed purely from
the chat-session index. **Zero LLM tokens**, no rubric, no R1 dependency: this is
the un-gated half of the live dashboard and is useful on its own. The LLM
narrative/rubric summary (M1) layers on top and consumes the placeholder
framework in ``analytics/live_framework.py``.

A group runs many activities; we report **one row per group** — its most-recent
session (where the group is *right now*). Group-level only (ADR-001): no
per-student data, no content, just counts + timing.

Design doc: docs/design/aipla/v1.1.0-feedback/teacher-analytics-framework.md
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

# Tunables (seconds). Conservative defaults; revisit against the first pilot.
ACTIVE_WINDOW_S = 300  # last turn < 5 min ago → "active"
STUCK_MIN_IDLE_S = 360  # 6 min quiet after working → candidate "stuck"
STUCK_MAX_IDLE_S = 1800  # beyond 30 min it's just idle, not "stuck"
STUCK_MIN_TURNS = 2  # only flag groups that were actually working
LIVE_WINDOW_S = 5400  # 90 min — a group quiet longer than this is a PAST session,
# not "live now". It drops off the live view (and the live summary) so yesterday's
# sessions don't show up as stale "idle"/"stuck" rows; the full history is still in
# the per-group report.


@dataclass
class LiveGroupSignal:
    group_code: str
    status: str  # "active" | "idle"
    turns: int
    last_activity_at: str  # ISO-8601
    idle_seconds: int
    stuck: bool
    activity_title: str
    skill_id: str


def compute_group_signals(
    group_codes: list[str],
    *,
    now: datetime | None = None,
) -> list[LiveGroupSignal]:
    """One deterministic signal row per active group in the class, newest first.

    Reads the chat-session index for the class's group codes, collapses to the
    most-recent session per group (the group's current activity), and derives
    active/idle + a "stuck" flag from turn count and idle time. Groups whose
    most-recent session is older than ``LIVE_WINDOW_S`` are excluded — they're
    historical, not live (so a session from another day doesn't surface here).
    """
    if not group_codes:
        return []

    from db.chat_sessions import list_sessions_for_group_codes

    now = now or datetime.now(UTC)
    sessions = list_sessions_for_group_codes(list(group_codes), page_size=200)

    # Most-recent session per group code = where the group is right now.
    newest: dict[str, object] = {}
    for s in sessions:
        code = getattr(s, "group_code", None)
        if not code:
            continue
        cur = newest.get(code)
        if cur is None or s.last_message_at > cur.last_message_at:  # type: ignore[attr-defined]
            newest[code] = s

    out: list[LiveGroupSignal] = []
    for code, s in newest.items():
        last = s.last_message_at  # type: ignore[attr-defined]
        if last.tzinfo is None:
            last = last.replace(tzinfo=UTC)
        idle = max(0, int((now - last).total_seconds()))
        if idle > LIVE_WINDOW_S:
            continue  # stale/past session — historical, not live; excluded
        status = "active" if idle < ACTIVE_WINDOW_S else "idle"
        stuck = (
            s.turn_count >= STUCK_MIN_TURNS  # type: ignore[attr-defined]
            and STUCK_MIN_IDLE_S <= idle <= STUCK_MAX_IDLE_S
        )
        out.append(
            LiveGroupSignal(
                group_code=code,
                status=status,
                turns=s.turn_count,  # type: ignore[attr-defined]
                last_activity_at=last.isoformat(),
                idle_seconds=idle,
                stuck=stuck,
                activity_title=getattr(s, "title", None) or "",
                skill_id=getattr(s, "skill_id", "") or "",
            )
        )

    out.sort(key=lambda g: g.last_activity_at, reverse=True)
    return out
