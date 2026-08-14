"""Concept-map checkpoint state — the student map's light-up read (CONCEPT-1 M3).

DUAL-AUDIENCE endpoint (the ADR-001 corner, tested explicitly): an
anonymous-group STUDENT reads their own group's node states (group_id from the
verified JWT — never a query param); the activity's owning TEACHER reads all
groups' states (the coverage read; the dashboard view proper is design-M3).
Anyone else gets an enumeration-resistant 404.

No Firestore ``onSnapshot`` client-side — group JWTs are not Firebase
identities, so the client polls this endpoint at turn end instead.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from auth import User, get_current_user
from db.activities import get_activity
from db.concept_progress import get_node_states
from db.firestore import query_documents

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/activities", tags=["concept-progress"])


@router.get("/{activity_id}/concept-progress")
async def get_concept_progress(
    activity_id: str,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Node-status map for the caller: the student's own group, or (owner) all groups."""
    # Student branch: keys off the VERIFIED group claim (never email/domain —
    # both are empty for anonymous-group users).
    if user.group_id:
        return {"nodeStates": get_node_states(user.group_id, activity_id)}

    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != user.uid:
        raise HTTPException(status_code=404, detail="activity not found")

    docs = query_documents(collection="concept_progress", filters=[("activityId", "==", activity_id)])
    groups = {d.get("groupId", d.get("__id", "?")): d.get("nodeStates", {}) for d in docs}
    return {"groups": groups}
