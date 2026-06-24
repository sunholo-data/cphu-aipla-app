"""FastAPI routes for the anonymous group-ID auth flow (sprint 2.11, M2).

Four endpoints:
  - POST   /api/auth/group/create     teacher-only (Firebase auth required)
  - POST   /api/auth/group/join       anonymous; rate-limited per IP
  - DELETE /api/auth/group/{id}       teacher-only; creator-match required
  - GET    /api/auth/group/{id}       metadata only (no member list)

Status-code map (mirrors the M1 seven-gate matrix):
  gate 1: 422  Pydantic body schema rejection
  gate 2: 401  unknown group_id
  gate 3: 401  expired group
  gate 4: 401  revoked group
  gate 5: 429  rate-limit exceeded (Retry-After header included)
  gate 6: 503  per-group concurrent-session cap exceeded
  gate 7: 200  happy path with token + uid + expires_at

DELETE produces:
  204  on success
  403  caller is not the group's creator
  404  group never existed (or was already deleted)

GET produces:
  200  with {group_id, title, expires_at, max_concurrent_sessions}
  404  unknown group_id (revoked OR never existed — privacy: don't leak the difference)
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth.group_id_auth import (
    DEFAULT_GROUP_CODE_TTL_DAYS,
    GroupExpired,
    GroupNotFound,
    GroupRecord,
    GroupRevoked,
    GroupSessionCapExceeded,
    InvalidGroupToken,
    create_group,
    delete_group,
    get_group,
    join_group,
    refresh_group_token,
)
from auth.group_rate_limit import RateLimitExceeded
from db.group_sessions import get_active_session_for_group

if TYPE_CHECKING:
    from auth.firebase_auth import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/group", tags=["anonymous-group-auth"])


# ─── Wire models ────────────────────────────────────────────────────────────


class CreateGroupRequest(BaseModel):
    """Body of POST /api/auth/group/create."""

    title: str = Field(min_length=1, max_length=200)
    skill_ids: list[str] = Field(min_length=1, max_length=50)
    ttl_days: int = Field(default=DEFAULT_GROUP_CODE_TTL_DAYS, ge=1, le=365)
    max_concurrent_sessions: int = Field(default=100, ge=1, le=10_000)

    model_config = {"extra": "forbid"}


class CreateGroupResponse(BaseModel):
    group_id: str
    expires_at: float
    join_url: str


class JoinGroupRequest(BaseModel):
    group_id: str = Field(min_length=1, max_length=64)

    model_config = {"extra": "forbid"}


class JoinGroupResponse(BaseModel):
    token: str
    uid: str
    expires_at: float
    # Group's permitted skills. Live-resolved from Class.lessons for
    # class-bound codes; falls back to stored GroupRecord.skill_ids for
    # unbound codes. Frontend uses this to scope the lesson list.
    skill_ids: list[str] = []
    # Session to resume (1.F). Null on the first join for a group; set on
    # re-joins while the session is active (< 30d and not teacher-reset).
    resumedSessionId: str | None = None
    # Class context for class-bound codes. Null for unbound groups.
    class_name: str | None = None
    class_id: str | None = None


class RefreshGroupRequest(BaseModel):
    """Body of POST /api/auth/group/refresh."""

    token: str = Field(min_length=1)

    model_config = {"extra": "forbid"}


class GroupMetadataResponse(BaseModel):
    group_id: str
    title: str
    expires_at: float
    max_concurrent_sessions: int


# ─── Helpers ────────────────────────────────────────────────────────────────


def _firebase_user() -> User:
    """Resolver for endpoints that require Firebase auth (teacher path).

    Imported lazily so this module can be loaded before the rest of the
    auth dispatcher wiring; the actual ``get_current_user`` is set on
    the route as a Depends below.
    """
    raise RuntimeError("placeholder — replaced at route registration time")


def _build_join_url(group_id: str, request: Request) -> str:
    """Produce a teacher-shareable join link. Trusts the X-Forwarded-Host
    if present (Cloud Run); falls back to the request URL's base."""
    base = request.headers.get("x-forwarded-host") or request.url.netloc
    scheme = request.headers.get("x-forwarded-proto") or request.url.scheme
    return f"{scheme}://{base}/group?code={group_id}"


def _client_ip(request: Request) -> str:
    """Best-effort caller IP. Cloud Run / load balancer set X-Forwarded-For."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # First entry is the originating client per RFC 7239.
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ─── Endpoints ──────────────────────────────────────────────────────────────


def _resolve_firebase_user_dep():
    """Yield the configured Firebase-auth dependency.

    Indirected so tests can dependency_override(get_current_user) and
    have BOTH the routes module AND the main app pick up the override.
    """
    from auth import get_current_user

    return get_current_user


@router.post("/create", status_code=201, response_model=CreateGroupResponse)
async def create_group_endpoint(
    body: CreateGroupRequest,
    request: Request,
    user: User = Depends(_resolve_firebase_user_dep()),  # noqa: B008
) -> CreateGroupResponse:
    """Teacher creates a group. Requires Firebase auth."""
    rec = create_group(
        title=body.title,
        skill_ids=body.skill_ids,
        creator_uid=user.uid,
        ttl_days=body.ttl_days,
        max_concurrent_sessions=body.max_concurrent_sessions,
    )
    logger.info(
        "group_routes: created group=%s creator=%s ttl=%dd skills=%d",
        rec.group_id,
        user.uid,
        body.ttl_days,
        len(body.skill_ids),
    )
    return CreateGroupResponse(
        group_id=rec.group_id,
        expires_at=rec.expires_at,
        join_url=_build_join_url(rec.group_id, request),
    )


@router.post("/join", status_code=200, response_model=JoinGroupResponse)
async def join_group_endpoint(
    body: JoinGroupRequest,
    request: Request,
) -> JoinGroupResponse:
    """Anonymous join. No auth required; rate-limited per IP."""
    ip = _client_ip(request)
    try:
        result = join_group(body.group_id, client_ip=ip)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail=f"rate limit exceeded; retry after {exc.retry_after_seconds}s",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    except GroupSessionCapExceeded as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except GroupExpired as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except GroupRevoked as exc:
        # Privacy: don't distinguish revoked from unknown in client message
        raise HTTPException(status_code=401, detail="group not found or no longer active") from exc
    except GroupNotFound as exc:
        raise HTTPException(status_code=401, detail="group not found or no longer active") from exc
    except ValueError as exc:
        # Gate 1 fallback if Pydantic didn't catch — defensive
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return JoinGroupResponse(
        token=result.token,
        uid=result.uid,
        expires_at=result.expires_at,
        skill_ids=list(result.skill_ids),
        resumedSessionId=get_active_session_for_group(body.group_id),
        class_name=result.class_name,
        class_id=result.class_id,
    )


@router.post("/refresh", status_code=200, response_model=JoinGroupResponse)
async def refresh_group_endpoint(body: RefreshGroupRequest) -> JoinGroupResponse:
    """Trade an existing (possibly expired) group token for a fresh one.

    Silent token renewal for long-lived anonymous sessions (a student who
    leaves a tab open across a laptop sleep). No Firebase auth: the presented
    token's signature is the credential. NOT rate-limited and does NOT consume
    a daily session-cap slot — it's the same member continuing the same shared
    group session, not a new join. See ``refresh_group_token`` for the gates.

    All failure modes are terminal (the caller must re-join with a code), so
    every one maps to 401 — the frontend treats a 401 here as "session ended".
    """
    try:
        result = refresh_group_token(body.token)
    except GroupExpired as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except (GroupRevoked, GroupNotFound) as exc:
        # Privacy: don't distinguish revoked from unknown in the client message.
        raise HTTPException(status_code=401, detail="group not found or no longer active") from exc
    except InvalidGroupToken as exc:
        raise HTTPException(status_code=401, detail="session token invalid; please re-join") from exc
    return JoinGroupResponse(
        token=result.token,
        uid=result.uid,
        expires_at=result.expires_at,
        skill_ids=list(result.skill_ids),
        resumedSessionId=get_active_session_for_group(result.group_id),
        class_name=result.class_name,
        class_id=result.class_id,
    )


class CurrentSkillsResponse(BaseModel):
    skill_ids: list[str]
    class_name: str | None = None
    class_id: str | None = None


@router.get("/my-skill-ids", response_model=CurrentSkillsResponse)
async def get_my_skill_ids(
    user: User = Depends(_resolve_firebase_user_dep()),  # noqa: B008
) -> CurrentSkillsResponse:
    """Return the current lesson list for the authenticated group member.

    Live-resolves from ``Class.lessons`` so that teacher updates (add/remove
    lesson) are visible to students immediately on the next ``/lessons`` page
    load, without requiring a re-join. 404 if the caller is not a group-auth
    user (no group_id on their token).
    """
    if not user.group_id:
        raise HTTPException(status_code=404, detail="not a group-auth user")
    from db.classes import get_class
    from db.firestore import get_document

    anon_doc = get_document("anon_groups", user.group_id)
    if anon_doc:
        bound_class_id = anon_doc.get("classId")
        if bound_class_id:
            cls = get_class(bound_class_id)
            if cls and not cls.revoked:
                return CurrentSkillsResponse(
                    skill_ids=list(cls.lessons),
                    class_name=cls.name,
                    class_id=cls.class_id,
                )
    # Unbound group — return empty (no lesson filter applied)
    return CurrentSkillsResponse(skill_ids=[], class_name=None, class_id=None)


class StudentActivitySummary(BaseModel):
    """One activity in a student's lesson list (ALS-1 M0). ``skill_id`` is the
    skill the activity runs — the frontend opens a chat for ``(skill_id,
    activity_id)``: the skill runs the agent, the activity selects the focus."""

    activity_id: str = Field(alias="activityId")
    skill_id: str = Field(alias="skillId")
    title: str = ""
    artefact_id: str | None = Field(default=None, alias="artefactId")
    workbench_type: str = Field(default="none", alias="workbenchType")

    model_config = {"populate_by_name": True}


class CurrentActivitiesResponse(BaseModel):
    activities: list[StudentActivitySummary]
    class_name: str | None = None
    class_id: str | None = None


@router.get("/my-activities", response_model=CurrentActivitiesResponse)
async def get_my_activities(
    user: User = Depends(_resolve_firebase_user_dep()),  # noqa: B008
) -> CurrentActivitiesResponse:
    """Return the activity-keyed lesson list for the authenticated group member (ALS-1 M0).

    The activity-era replacement for ``my-skill-ids``: resolves the bound class,
    then loads each assigned ``Activity`` from ``Class.activity_ids``. Many concept
    activities can now share one skill — each carries a distinct ``activity_id``, so
    the collision that overwrote the second activity is gone. Live-resolves so a
    teacher's add/remove is visible on the next ``/lessons`` load without a re-join.
    404 if the caller is not a group-auth user.
    """
    if not user.group_id:
        raise HTTPException(status_code=404, detail="not a group-auth user")
    from db.activities import get_activity
    from db.classes import get_class
    from db.firestore import get_document

    anon_doc = get_document("anon_groups", user.group_id)
    if anon_doc:
        bound_class_id = anon_doc.get("classId")
        if bound_class_id:
            cls = get_class(bound_class_id)
            if cls and not cls.revoked:
                activities: list[StudentActivitySummary] = []
                for aid in cls.activity_ids:
                    a = get_activity(aid)
                    if a is None:
                        continue  # soft-deleted / dangling reference — skip silently
                    activities.append(
                        StudentActivitySummary(
                            activityId=a.activity_id,
                            skillId=a.skill_id,
                            title=a.title,
                            artefactId=a.artefact_id,
                            workbenchType=a.workbench_type,
                        )
                    )
                return CurrentActivitiesResponse(
                    activities=activities,
                    class_name=cls.name,
                    class_id=cls.class_id,
                )
    return CurrentActivitiesResponse(activities=[], class_name=None, class_id=None)


class ActiveSessionResponse(BaseModel):
    """Live-resolved active ADK session for the caller's group (1.F)."""

    session_id: str | None = Field(default=None, alias="sessionId")

    model_config = {"populate_by_name": True}


@router.get("/active-session", response_model=ActiveSessionResponse)
async def get_active_session_endpoint(
    user: User = Depends(_resolve_firebase_user_dep()),  # noqa: B008
) -> ActiveSessionResponse:
    """Re-resolve the group's active session id WITHOUT a re-join (1.F fix).

    The join response's ``resumedSessionId`` is frozen at join time — null on
    the first join (before any chat), and never refreshed afterward. So a
    student who joins, chats, then revisits in the same tab keeps reading a
    stale null and starts a blank session every time. The chat page calls this
    on load to resume the group's live session (mapping written by
    ``/api/sessions/{id}/bootstrap``). Returns null when there's no active
    session (first ever, expired, or teacher-reset). 404 if not group-auth.
    """
    if not user.group_id:
        raise HTTPException(status_code=404, detail="not a group-auth user")
    return ActiveSessionResponse(session_id=get_active_session_for_group(user.group_id))


@router.delete("/{group_id}", status_code=204)
async def delete_group_endpoint(
    group_id: str,
    user: User = Depends(_resolve_firebase_user_dep()),  # noqa: B008
) -> None:
    """Revoke a group. Only the creator may delete."""
    try:
        delete_group(group_id, requesting_uid=user.uid)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except GroupNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return None


@router.get("/{group_id}", response_model=GroupMetadataResponse)
async def get_group_endpoint(
    group_id: str,
    user: User = Depends(_resolve_firebase_user_dep()),  # noqa: B008
) -> GroupMetadataResponse:
    """Return group metadata. NO member list returned (privacy)."""
    rec: GroupRecord | None = get_group(group_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="group not found")
    return GroupMetadataResponse(
        group_id=rec.group_id,
        title=rec.title,
        expires_at=rec.expires_at,
        max_concurrent_sessions=rec.max_concurrent_sessions,
    )


__all__ = ["router"]
