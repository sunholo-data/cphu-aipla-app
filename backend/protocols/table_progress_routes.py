"""Student table data — the workspace's read/write for a data table (1.1.88).

DUAL-AUDIENCE on the read (the ADR-001 corner, tested explicitly): an
anonymous-group STUDENT reads their own group's cells (``group_id`` from the
verified JWT — never a query param); the activity's owning TEACHER reads every
group's. Anyone else gets an enumeration-resistant 404. Same shape as
``writing_progress_routes`` and ``checklist_progress_routes``, deliberately — a
third idiom for the same question would drift.

The WRITE is student-only. A teacher previewing an activity has no group to
record against, and the only way to supply one would be a request field — which
is exactly the parameter this design refuses to have.

**The import that matters.** ``from auth import ...`` — the DISPATCHER, never
``auth.firebase_auth``. All three sibling stores shipped a 401 on that first, and
it is unrecoverable from the client's side because the token is fine: every
anonymous-group student 401s on the one endpoint that got it wrong while
``/api/auth/group/pulse`` keeps returning 200 for the same group and the same
token. ``scripts/check-auth-dispatcher.sh`` enforces this now; the test that
actually witnesses it is a REAL minted group token through the REAL dispatcher,
because a route's own tests ``dependency_overrides`` the same symbol the route
imports and so pass in lockstep with the bug.

No Firestore ``onSnapshot`` client-side: group JWTs are not Firebase identities,
so the client reads this endpoint instead (memory
``feedback-anonymous-users-are-corner-case``).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import User, get_current_user
from db.activities import get_activity
from db.firestore import query_documents
from db.table_progress import MAX_CELLS, get_state, record_cells

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/activities", tags=["table-progress"])


class TableSaveBody(BaseModel):
    """A PATCH of cells, not the whole grid.

    Sending only what changed is what makes two students filling different rows
    non-conflicting: the store merges. Sending the whole grid would re-assert
    every cell this client happens to hold, which re-creates the last-writer-wins
    clobber the store exists to remove — the client's copy of the OTHER student's
    cells is by definition as old as its last read.
    """

    cells: dict[str, str] = Field(default_factory=dict, max_length=MAX_CELLS)

    model_config = {"populate_by_name": True}


@router.get("/{activity_id}/table")
async def get_table(
    activity_id: str,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """The entered cells for the caller: the student's own group, or (owner) all groups."""
    # Student branch: keys off the VERIFIED group claim (never email/domain —
    # both are empty for anonymous-group users).
    if user.group_id:
        return get_state(user.group_id, activity_id)

    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != user.uid:
        raise HTTPException(status_code=404, detail="activity not found")

    rows = query_documents(collection="table_progress", filters=[("activityId", "==", activity_id)])
    groups = {d.get("groupId", d.get("__id", "?")): d.get("cells", {}) for d in rows}
    return {"groups": groups}


@router.put("/{activity_id}/table")
async def save_table(
    activity_id: str,
    body: TableSaveBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """The student commits one or more cells (on blur).

    Returns the WHOLE merged state, not just the acknowledged cells: the client
    needs the other members' readings to render the shared grid and to push a
    complete snapshot to the tutor. Returning only the echo is what would leave
    the AI seeing "the most recently entered values" — the reported defect —
    with the store fixed underneath it.
    """
    if not user.group_id:
        # Teacher preview has no group. 403 rather than inventing one.
        raise HTTPException(status_code=403, detail="table data is recorded per student group")

    return record_cells(user.group_id, activity_id, body.cells)
