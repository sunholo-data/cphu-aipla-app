"""When a group last did work, and where, and whether its page is open (1.1.161 M1).

Design: docs/design/aipla/v2.1.0-extension/live-status-counts-workbench-work.md

The teacher's live label used to come from chat turns alone. A group working
in the table, a writing sheet or a sim without talking to the tutor showed as
*quiet* after 5 minutes and *stuck* after 6. On 23 November about one working
minute in six was mislabelled, every one of them a group busy in a sim.

So every place a group's work is already written stamps ONE small doc per group:

    group_work/{group_code} = {
        lastWorkAt:   ISO-8601,   # the latest non-chat work
        lastWorkKind: "table" | "writing" | "checklist" | "concept_map" | "sim" | "document",
        lastSeenAt:   ISO-8601,   # a student tab of this group was open (the pulse poll)
    }

One doc per GROUP, not per (group, activity) like ``group_sessions``: the live
view shows one row per group, so the reader needs one doc per row, and every
writer knows the group from the student's token but not always the activity.

Group level only (ADR-001): no device, no student, no content. The kind is a
surface name.

Throttled in-process (``_THROTTLE_S`` per group and field), so a fast typist or
a sim pushing every second does not multiply Firestore writes. A stamp NEVER
raises: a failed stamp must not fail the student's save.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import UTC, datetime
from typing import Any

from db.firestore import get_document, set_document

log = logging.getLogger(__name__)

COLLECTION = "group_work"

WORK_KINDS = frozenset({"table", "writing", "checklist", "concept_map", "sim", "document"})

#: At most one write per group per field in this window, per instance. The live
#: label works in minutes, so 20 s of staleness is invisible to the teacher.
_THROTTLE_S = 20.0

_last_write: dict[tuple[str, str], float] = {}
_lock = threading.Lock()


def _due(group_id: str, field: str, now: float) -> bool:
    with _lock:
        prev = _last_write.get((group_id, field))
        if prev is not None and now - prev < _THROTTLE_S:
            return False
        _last_write[(group_id, field)] = now
        return True


def _reset_throttle_for_tests() -> None:
    with _lock:
        _last_write.clear()


def touch_work(group_id: str | None, kind: str) -> None:
    """Record that ``group_id`` just did work of ``kind``. Never raises."""
    if not group_id or kind not in WORK_KINDS:
        return
    try:
        # Throttle per kind, so switching from the sim to the table is seen at once.
        if not _due(group_id, f"work:{kind}", time.monotonic()):
            return
        now = datetime.now(UTC).isoformat()
        set_document(COLLECTION, group_id, {"lastWorkAt": now, "lastWorkKind": kind}, merge=True)
    except Exception:
        log.warning("group_work: work stamp failed for a group (kind=%s)", kind, exc_info=True)


def touch_seen(group_id: str | None) -> None:
    """Record that a tab of ``group_id`` is open (called from the pulse poll). Never raises."""
    if not group_id:
        return
    try:
        if not _due(group_id, "seen", time.monotonic()):
            return
        set_document(COLLECTION, group_id, {"lastSeenAt": datetime.now(UTC).isoformat()}, merge=True)
    except Exception:
        log.warning("group_work: seen stamp failed for a group", exc_info=True)


def kind_for_server(server_id: str) -> str | None:
    """The work kind for an iframe-context push from ``server_id``, or None.

    ``progress`` carries the tutor's own bookkeeping, not the group's work.
    """
    if not server_id or server_id == "progress":
        return None
    if server_id in ("writing", "table"):
        return server_id
    if server_id == "documents":
        return "document"
    return "sim"


def _parse(iso: Any) -> datetime | None:
    if not isinstance(iso, str) or not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def read_work(group_ids: list[str]) -> dict[str, dict[str, Any]]:
    """{code: {"last_work_at": dt|None, "last_work_kind": str|None, "last_seen_at": dt|None}}.

    Blocking (one Firestore read per group). Call it off the event loop. A
    group with no doc is absent from the result. A read that fails RAISES: the
    caller must tell "no work stamped" apart from "could not read".
    """
    out: dict[str, dict[str, Any]] = {}
    for code in group_ids:
        data = get_document(COLLECTION, code)
        if not data:
            continue
        kind = data.get("lastWorkKind")
        out[code] = {
            "last_work_at": _parse(data.get("lastWorkAt")),
            "last_work_kind": kind if kind in WORK_KINDS else None,
            "last_seen_at": _parse(data.get("lastSeenAt")),
        }
    return out
