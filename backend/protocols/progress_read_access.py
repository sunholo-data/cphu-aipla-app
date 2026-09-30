"""Who may read EVERY group's progress on an activity (1.1.136 M3).

The four ``*_progress`` GETs (table, writing, checklist, concept) are
dual-audience: a student reads their own group's row (``user.group_id``, from
the verified JWT) and never reaches this module. This decides the OTHER branch —
the all-groups view a teacher or researcher reviews.

Until 1.1.136 that branch was ``activity.owner_uid == user.uid``, which refused
every researcher: the people evaluating the work could read a group's
conversation and not the table the conversation was about. Now:

- ``?classId=`` given → :func:`analytics.auth.assert_can_read_class` (the class
  owner, or a researcher), and the result is **narrowed to that class's group
  codes**. This is how a teacher reads their own class's work on an activity
  someone else authored, and it can never widen past their class.
- no ``classId`` → the activity's owner (unchanged), or a researcher (the
  cross-class read the researcher role exists for, tagged on the span like
  every other researcher bypass).
- anyone else — a teacher of a different class, an unknown activity — gets the
  same 404, so the answer does not reveal whether the activity exists.

Synchronous Firestore throughout: callers run :func:`all_groups_scope` and the
scan that follows via ``asyncio.to_thread`` (the 1.1.131 footgun — a long
synchronous scan in an ``async def`` freezes every student stream).
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from opentelemetry import trace

from analytics.auth import assert_can_read_class
from db.activities import get_activity
from db.classes import get_class
from db.firestore import query_documents

NOT_FOUND = "activity not found"


def all_groups_scope(user: Any, activity_id: str, class_id: str | None) -> set[str] | None:
    """The group codes the caller may read on this activity; ``None`` = all.

    Raises a 404 ``HTTPException`` (enumeration-resistant) when the caller may
    read none.
    """
    if class_id:
        try:
            assert_can_read_class(user, class_id)
        except PermissionError as exc:
            raise HTTPException(status_code=404, detail=NOT_FOUND) from exc
        cls = get_class(class_id)
        return set(getattr(cls, "group_codes", None) or ())

    activity = get_activity(activity_id)
    if activity is not None and activity.owner_uid == user.uid:
        return None
    if activity is not None and getattr(user, "is_researcher", False):
        span = trace.get_current_span()
        if span.is_recording():
            span.set_attribute("auth.researcher_bypass", True)
            span.set_attribute("activity_id", activity_id)
        return None
    raise HTTPException(status_code=404, detail=NOT_FOUND)


def read_all_groups(
    user: Any,
    activity_id: str,
    class_id: str | None,
    *,
    collection: str,
    field: str,
    transform: Any = None,
) -> dict[str, Any]:
    """Authorize, then scan ``collection`` for the activity, keyed by group.

    One function so the four routes cannot drift into four idioms again. Run it
    off the event loop.
    """
    scope = all_groups_scope(user, activity_id, class_id)
    rows = query_documents(collection=collection, filters=[("activityId", "==", activity_id)])
    groups: dict[str, Any] = {}
    for d in rows:
        gid = d.get("groupId", d.get("__id", "?"))
        if scope is not None and gid not in scope:
            continue
        raw = d.get(field, {})
        groups[gid] = transform(raw) if transform else raw
    return {"groups": groups}


__all__ = ["NOT_FOUND", "all_groups_scope", "read_all_groups"]
