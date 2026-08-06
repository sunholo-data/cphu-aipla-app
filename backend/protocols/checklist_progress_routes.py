"""Checklist (ILO) tick state — the student workspace's read/write (1.1.62 M3).

DUAL-AUDIENCE on the read (the ADR-001 corner, tested explicitly): an
anonymous-group STUDENT reads their own group's item states (``group_id`` from
the verified JWT — never a query param); the activity's owning TEACHER reads all
groups' states. Anyone else gets an enumeration-resistant 404.

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
from db.checklist_progress import get_item_states, record_item_state
from db.firestore import query_documents

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/activities", tags=["checklist-progress"])


class ChecklistTickBody(BaseModel):
    item_id: str = Field(alias="itemId", min_length=1, max_length=64)
    done: bool

    model_config = {"populate_by_name": True}


@router.get("/{activity_id}/checklist-progress")
async def get_checklist_progress(
    activity_id: str,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Item states for the caller: the student's own group, or (owner) all groups."""
    # Student branch: keys off the VERIFIED group claim (never email/domain —
    # both are empty for anonymous-group users).
    if user.group_id:
        return {"itemStates": get_item_states(user.group_id, activity_id)}

    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != user.uid:
        raise HTTPException(status_code=404, detail="activity not found")

    docs = query_documents(collection="checklist_progress", filters=[("activityId", "==", activity_id)])
    groups = {d.get("groupId", d.get("__id", "?")): d.get("itemStates", {}) for d in docs}
    return {"groups": groups}


@router.post("/{activity_id}/checklist-progress")
async def tick_checklist_item(
    activity_id: str,
    body: ChecklistTickBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """The student ticks (or unticks) a step themselves.

    Recorded with ``by="student"``, which is what makes the override in
    "the AI helps auto-grade" real: a student disagreeing with an AI tick flips
    the provenance, and the UI stops presenting the item as the tutor's read.
    """
    if not user.group_id:
        # Teacher preview has no group. 403 rather than inventing one.
        raise HTTPException(status_code=403, detail="checklist progress is recorded per student group")

    states = record_item_state(
        user.group_id,
        activity_id,
        body.item_id,
        done=body.done,
        by="student",
    )
    return {"itemStates": states}
