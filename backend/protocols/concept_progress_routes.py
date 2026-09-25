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
from pydantic import BaseModel, ConfigDict, Field

from auth import User, get_current_user
from db.activities import get_activity, list_activities_by_owner, save_activity
from db.class_concept_rollup import (
    class_concept_distribution,
    normalise_concept,
    suggest_activity_links,
    targets_for_concept,
)
from db.classes import get_class
from db.concept_progress import NodeStatus, get_node_states, record_concept_evidence, states_from_stored
from db.firestore import query_documents
from db.models.activity import ActivityLink

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/activities", tags=["concept-progress"])
class_router = APIRouter(prefix="/api/classes", tags=["concept-progress"])


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
    # Derived through the store's own reducer, never read off the document:
    # since CONCEPT-2 M2 a node holds evidence records and no stored status.
    groups = {d.get("groupId", d.get("__id", "?")): states_from_stored(d.get("nodeStates", {})) for d in docs}
    return {"groups": groups}


@class_router.get("/{class_id}/concept-rollup")
async def get_class_concept_rollup(
    class_id: str,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """The class's concept picture across the year (CONCEPT-2 M4).

    Owner-only, 404 otherwise (enumeration-resistant, like every other read
    here). A **distribution over the class's groups**, never a union — see
    ``db/class_concept_rollup.py`` for why that distinction is the whole point.
    """
    cls = get_class(class_id)
    if cls is None or cls.owner_uid != user.uid:
        raise HTTPException(status_code=404, detail="class not found")
    rollup = class_concept_distribution(class_id)
    # The class's own codes travel with it so the caller can tell a group that
    # has NOT shown a concept from one that never met it — two different facts,
    # which the rollup deliberately does not flatten.
    rollup["classGroups"] = list(cls.group_codes)
    return rollup


@router.get("/{activity_id}/link-suggestions")
async def get_link_suggestions(
    activity_id: str,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Candidate activity links from shared concepts (CONCEPT-2 M4).

    Proposed, never written: a link is the teacher's statement about their own
    curriculum. Scoped to the caller's OWN activities, so a suggestion can never
    reveal that another teacher's activity exists.
    """
    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != user.uid:
        raise HTTPException(status_code=404, detail="activity not found")
    candidates = [a.activity_id for a in list_activities_by_owner(user.uid) if a.activity_id != activity_id]
    linked = {link.to_activity_id for link in activity.links}
    suggestions = [s for s in suggest_activity_links(activity_id, candidates) if s["toActivityId"] not in linked]
    return {"suggestions": suggestions}


class LinksUpdate(BaseModel):
    """The activity's links, replaced wholesale.

    A SEPARATE endpoint from ``ActivityUpsert`` on purpose. That body is a full
    replace of the builder payload, so putting links on it would mean any client
    that saved an activity without rendering them silently cleared them — the
    full-overwrite footgun this repo has shipped before. Links are their own
    authoring gesture and get their own write path.
    """

    links: list[ActivityLink] = Field(default_factory=list, max_length=50)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


@router.put("/{activity_id}/links")
async def put_activity_links(
    activity_id: str,
    body: LinksUpdate,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Set this activity's links to other activities. Owner-only."""
    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != user.uid:
        raise HTTPException(status_code=404, detail="activity not found")
    owned = {a.activity_id for a in list_activities_by_owner(user.uid)}
    unknown = [link.to_activity_id for link in body.links if link.to_activity_id not in owned]
    if unknown:
        # Linking to an activity the caller does not own would both leak its
        # existence and produce a rollup edge nobody can open.
        raise HTTPException(status_code=400, detail=f"not your activities: {sorted(unknown)}")
    saved = save_activity(activity.model_copy(update={"links": body.links}))
    log.info("concept-links: %s set %d link(s) on %s", user.uid, len(body.links), activity_id)
    return {"links": [link.model_dump(by_alias=True) for link in saved.links]}


class ConceptOverride(BaseModel):
    """A teacher's judgement about one group and one concept (CONCEPT-2 M6)."""

    concept: str = Field(min_length=1, max_length=200)
    group_id: str = Field(alias="groupId", min_length=1, max_length=64)
    status: NodeStatus
    note: str = Field(default="", max_length=200)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


@class_router.put("/{class_id}/concept-override")
async def put_concept_override(
    class_id: str,
    body: ConceptOverride,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Record the teacher's own read of a concept for one group.

    ``teacher_focus`` has told the tutor since CONCEPT-1 that *"this is the AI's
    read — the teacher can override it"*. Until now nothing implemented that.

    Written as ``kind="teacher"`` evidence, which outranks every AI record in
    ``derive_status`` and is never overwritten by one; and written to EVERY
    activity in the class that maps this concept, because the rollup takes a
    group's best showing across them — an override applied to one activity while
    another still said ``demonstrated`` would read as having done nothing.

    Per-GROUP is the atom. A class-wide gesture is this call in a loop, not a
    second concept. (Open question: if teachers reach for class-wide every time,
    the default is wrong — that is an observation to make after it ships, not a
    guess to build on.)
    """
    cls = get_class(class_id)
    if cls is None or cls.owner_uid != user.uid:
        raise HTTPException(status_code=404, detail="class not found")
    if body.group_id not in cls.group_codes:
        raise HTTPException(status_code=400, detail="group is not in this class")

    key = normalise_concept(body.concept)
    targets = targets_for_concept(cls, key)
    if not targets:
        raise HTTPException(status_code=400, detail=f"no activity in this class maps {body.concept!r}")

    summary = body.note.strip() or f"Læreren har vurderet dette som {body.status}."
    for activity_id, node_id in targets:
        record_concept_evidence(
            body.group_id, activity_id, node_id, body.status, summary, kind="teacher", class_id=class_id
        )
    log.info(
        "concept-override: %s set %s=%s for group=%s across %d activity/activities",
        user.uid,
        key,
        body.status,
        body.group_id,
        len(targets),
    )
    return {"concept": key, "groupId": body.group_id, "status": body.status, "activities": len(targets)}
