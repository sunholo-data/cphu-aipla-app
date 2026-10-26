"""Compare one element across every group of a class (1.1.99 M1).

A teacher picks an activity of their class and one of its workbench elements —
a table, a chart, a writing box or the checklist — and sees that element for
EVERY group at once: eight graphs side by side, eight tables. The physics point
is outliers: one graph with a different slope, one table with a decimal error.

Two reads, both class-scoped:

- ``GET /api/classes/{class_id}/compare/elements`` — the picker: the class's
  activities and the comparable elements each one has. Definitions only; no
  student data.
- ``GET /api/classes/{class_id}/compare?activityId=&kind=&elementId=`` — THE
  read: the element's definition plus, per group code of the class, that
  group's stored state for it and when it was last updated. One request, one
  store scan, so a grid of thirty miniatures is not thirty round trips.

**Who.** :func:`analytics.auth.assert_can_read_class` — the class owner, or a
researcher (span-tagged). Anyone else, a missing class, an activity the class
does not run, or an element the activity does not have: the same 404, so the
answer never reveals what exists. A **student** (a group JWT through the
dispatcher) is refused with 403 before anything is read — this is a teacher
surface, and a student seeing every other group's work is a different product
(the doc's open question 2).

**Every group, including the empty ones.** The grid lists ALL of the class's
evidence codes (``Class.group_codes`` — a revoked code's work is still evidence,
1.1.146), each with ``updatedAt: null`` and no data when the group has not
touched the element. An empty card is an honest "nothing yet"; a read FAILURE
is a 503, never an empty grid — an empty card read as "this group has done
nothing" is the reassuring-wrong-answer this project keeps shipping.

**Off the loop.** Firestore is synchronous; the whole read runs in
``asyncio.to_thread`` (the 1.1.131 footgun).

The import that matters: ``from auth import ...`` — the dispatcher.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from analytics.auth import assert_can_read_class
from auth import User, get_current_user
from auth.guards import assert_teacher
from db.activities import get_activity
from db.classes import get_class
from db.firestore import query_documents

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/classes", tags=["class-compare"])

NOT_FOUND = "not found"
CHECKLIST_ID = "checklist"
"""The checklist is one list per activity, not several elements — it is
addressed by this fixed id."""

Kind = Literal["table", "chart", "writing", "checklist"]

_STORE: dict[str, tuple[str, str]] = {
    "table": ("table_progress", "cells"),
    "chart": ("table_progress", "cells"),
    "writing": ("writing_progress", "docs"),
    "checklist": ("checklist_progress", "itemStates"),
}


def _refuse_students(user: User) -> None:
    if user.group_id:
        raise HTTPException(status_code=403, detail="teacher access required")
    assert_teacher(user)


def _readable_class(user: User, class_id: str) -> Any:
    try:
        assert_can_read_class(user, class_id)
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=NOT_FOUND) from exc
    cls = get_class(class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return cls


def _dump(items: list[Any]) -> list[dict[str, Any]]:
    return [i.model_dump(by_alias=True) if hasattr(i, "model_dump") else dict(i) for i in items]


def _elements_of(activity: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for t in activity.table or []:
        out.append({"kind": "table", "id": t.id, "title": t.title or ""})
    for c in activity.chart or []:
        out.append({"kind": "chart", "id": c.id, "title": getattr(c, "title", "") or ""})
    for w in activity.writing or []:
        out.append({"kind": "writing", "id": w.id, "title": (w.title or getattr(w, "prompt", "") or "")[:120]})
    if activity.checklist:
        out.append({"kind": "checklist", "id": CHECKLIST_ID, "title": ""})
    return out


def list_comparable(user: User, class_id: str) -> dict[str, Any]:
    """The picker: each class activity that has something to compare."""
    cls = _readable_class(user, class_id)
    activities: list[dict[str, Any]] = []
    for aid in getattr(cls, "activity_ids", None) or []:
        activity = get_activity(aid)
        if activity is None:
            continue
        elements = _elements_of(activity)
        if elements:
            activities.append({"activityId": aid, "title": activity.title or aid, "elements": elements})
    return {"classId": class_id, "activities": activities}


def _element_defs(activity: Any, kind: str, element_id: str) -> dict[str, Any]:
    """The definitions the client needs to render the element; 404 if absent.

    A chart carries every table too: its binding resolves against them."""
    if kind == "checklist":
        if element_id != CHECKLIST_ID or not activity.checklist:
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        return {"checklist": _dump(activity.checklist)}
    pool = {"table": activity.table, "chart": activity.chart, "writing": activity.writing}[kind] or []
    match = [e for e in pool if e.id == element_id]
    if not match:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    defs: dict[str, Any] = {kind: _dump(match)}
    if kind == "chart":
        defs["table"] = _dump(activity.table or [])
    return defs


def _slice(kind: str, element_id: str, raw: Any) -> tuple[Any, str | None]:
    """The part of a group's stored state this element owns, plus its own
    updatedAt when the store keeps one per element (writing)."""
    if not isinstance(raw, dict):
        return {}, None
    if kind == "table":
        prefix = f"{element_id}::"
        return {k: v for k, v in raw.items() if k.startswith(prefix)}, None
    if kind == "writing":
        entry = raw.get(element_id)
        if not isinstance(entry, dict):
            return None, None
        return entry, entry.get("updatedAt")
    # chart (every table's cells — the binding picks its columns) and checklist
    return raw, None


def _has_data(kind: str, data: Any) -> bool:
    if kind == "writing":
        return isinstance(data, dict) and bool(str(data.get("text", "")).strip())
    if kind == "checklist":
        return isinstance(data, dict) and any(isinstance(v, dict) and v.get("done") for v in data.values())
    return isinstance(data, dict) and any(str(v).strip() for v in data.values())


def compare_element(user: User, class_id: str, activity_id: str, kind: str, element_id: str) -> dict[str, Any]:
    """One element, every group of the class. Synchronous — run off the loop."""
    cls = _readable_class(user, class_id)
    if activity_id not in (getattr(cls, "activity_ids", None) or []):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    activity = get_activity(activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    defs = _element_defs(activity, kind, element_id)

    codes = list(getattr(cls, "group_codes", None) or [])
    revoked = set(getattr(cls, "revoked_group_codes", None) or [])
    collection, field = _STORE[kind]
    try:
        rows = query_documents(collection=collection, filters=[("activityId", "==", activity_id)])
    except Exception as exc:  # a failed read must not look like "nothing yet"
        log.warning("class compare read failed class=%s activity=%s: %s", class_id, activity_id, exc)
        raise HTTPException(status_code=503, detail="cannot read group work") from exc

    by_group = {d.get("groupId"): d for d in rows if d.get("groupId") in set(codes)}
    groups: list[dict[str, Any]] = []
    for code in codes:
        doc = by_group.get(code)
        entry: dict[str, Any] = {"groupCode": code, "revoked": code in revoked, "updatedAt": None, "data": None}
        if doc is not None:
            data, element_updated = _slice(kind, element_id, doc.get(field, {}))
            if _has_data(kind, data):
                entry["data"] = data
                entry["updatedAt"] = element_updated or doc.get("updatedAt")
        groups.append(entry)

    return {
        "classId": class_id,
        "activityId": activity_id,
        "activityTitle": activity.title or activity_id,
        "kind": kind,
        "elementId": element_id,
        "elements": defs,
        "groups": groups,
    }


@router.get("/{class_id}/compare/elements")
async def get_comparable_elements(
    class_id: str,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    _refuse_students(user)
    return await asyncio.to_thread(list_comparable, user, class_id)


@router.get("/{class_id}/compare")
async def get_class_compare(
    class_id: str,
    kind: Kind,
    activityId: str = Query(..., min_length=1, max_length=128),
    elementId: str = Query(..., min_length=1, max_length=64),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    _refuse_students(user)
    return await asyncio.to_thread(compare_element, user, class_id, activityId, kind, elementId)


__all__ = ["CHECKLIST_ID", "compare_element", "list_comparable", "router"]
