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

**1.1.161 — work counts, not only chat.** "Last activity" is the later of the
last chat turn and the last work stamp (``db/group_work.py``: table, writing,
checklist, sim, document), and ``last_work_kind`` says where. *Stuck* now also
needs the group's page to be open (``page_open``, from the pulse poll): a group
that closed the laptop is quiet, not stuck. If the work stamps cannot be read,
the label falls back to the chat-only rule and ``page_open`` is None. It never
pretends to know (docs/design/aipla/v2.1.0-extension/live-status-counts-workbench-work.md).
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
PAGE_OPEN_WINDOW_S = 60  # a tab heartbeats ~2.5 s; the stamp is throttled to 20 s


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
    #: Where the latest activity was: "chat", or a work kind ("table", "sim", …).
    last_work_kind: str = "chat"
    #: A tab of this group is open now. None when the stamps could not be read.
    page_open: bool | None = None


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
    works: dict[str, dict] | None
    try:
        from db.group_work import read_work

        works = read_work(list(group_codes))
    except Exception:
        import logging

        logging.getLogger(__name__).warning("live signals: work stamps unreadable; chat-only labels", exc_info=True)
        works = None

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
        work = (works or {}).get(code) or {}
        work_at = work.get("last_work_at")
        kind = "chat"
        if work_at is not None and work_at > last:
            last, kind = work_at, work.get("last_work_kind") or "chat"
        seen = work.get("last_seen_at")
        page_open = None if works is None else (seen is not None and (now - seen).total_seconds() < PAGE_OPEN_WINDOW_S)
        idle = max(0, int((now - last).total_seconds()))
        if idle > LIVE_WINDOW_S:
            continue  # stale/past session — historical, not live; excluded
        status = "active" if idle < ACTIVE_WINDOW_S else "idle"
        worked = s.turn_count >= STUCK_MIN_TURNS or work_at is not None  # type: ignore[attr-defined]
        stuck = (
            worked
            and STUCK_MIN_IDLE_S <= idle <= STUCK_MAX_IDLE_S
            # A closed laptop is quiet, not stuck. Unreadable stamps: chat-only rule.
            and page_open is not False
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
                last_work_kind=kind,
                page_open=page_open,
            )
        )

    out.sort(key=lambda g: g.last_activity_at, reverse=True)
    return out
