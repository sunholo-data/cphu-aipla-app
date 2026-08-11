"""Student writing — the workspace's read/write for a writing element (1.1.73).

DUAL-AUDIENCE on the read (the ADR-001 corner, tested explicitly): an
anonymous-group STUDENT reads their own group's text (``group_id`` from the
verified JWT — never a query param); the activity's owning TEACHER reads every
group's. Anyone else gets an enumeration-resistant 404. Same shape as
``checklist_progress_routes``, deliberately — a second idiom for the same
question would drift.

The WRITE is student-only. A teacher previewing an activity has no group to
record against, and the only way to supply one would be a request field — which
is exactly the parameter this design refuses to have.

No Firestore ``onSnapshot`` client-side: group JWTs are not Firebase identities,
so the client reads this endpoint instead (memory
``feedback-anonymous-users-are-corner-case``).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth.firebase_auth import User, get_current_user
from db.activities import get_activity
from db.firestore import query_documents
from db.writing_progress import MAX_TEXT_CHARS, get_docs, record_doc

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/activities", tags=["writing-progress"])


class WritingSaveBody(BaseModel):
    element_id: str = Field(alias="elementId", min_length=1, max_length=64)
    # Bounded at the model, so an oversized body is a 422 before it reaches
    # Firestore rather than a silent truncation the student never sees.
    text: str = Field(default="", max_length=MAX_TEXT_CHARS)

    model_config = {"populate_by_name": True}


@router.get("/{activity_id}/writing")
async def get_writing(
    activity_id: str,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """The written text for the caller: the student's own group, or (owner) all groups."""
    # Student branch: keys off the VERIFIED group claim (never email/domain —
    # both are empty for anonymous-group users).
    if user.group_id:
        return {"docs": get_docs(user.group_id, activity_id)}

    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != user.uid:
        raise HTTPException(status_code=404, detail="activity not found")

    rows = query_documents(collection="writing_progress", filters=[("activityId", "==", activity_id)])
    groups = {d.get("groupId", d.get("__id", "?")): d.get("docs", {}) for d in rows}
    return {"groups": groups}


@router.put("/{activity_id}/writing")
async def save_writing(
    activity_id: str,
    body: WritingSaveBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """The student saves their text (autosave on idle / blur).

    Idempotent by construction — the client sends the whole text, not a diff, so
    a retried or out-of-order save can only ever land a whole document. The
    returned ``revision`` is what the client compares to spot that another group
    member edited from a different device.
    """
    if not user.group_id:
        # Teacher preview has no group. 403 rather than inventing one.
        raise HTTPException(status_code=403, detail="written work is recorded per student group")

    entry = record_doc(user.group_id, activity_id, body.element_id, text=body.text)
    return {"elementId": body.element_id, **entry}
