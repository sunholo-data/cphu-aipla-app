"""
Firebase JWT verification middleware for FastAPI.

Provides:
    - `User`: Pydantic model for an authenticated caller (uid, email, domain,
      group_tags as frozenset from the JWT `groupTags` custom claim).
    - `get_current_user`: FastAPI dependency that parses the `Authorization`
      header, calls `firebase_admin.auth.verify_id_token`, and returns `User`.

Assumes `firebase_admin.initialize_app()` has been called at app startup
(see `fast_api_app.py`). Uses Application Default Credentials (ADC) — on
Cloud Run the attached service account is picked up automatically; locally,
`gcloud auth application-default login` supplies creds.

No PII (email) is logged on success or failure — only `uid` on success, and
the exception type name on failure.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException, Request
from firebase_admin import auth as fb_auth
from pydantic import BaseModel, ConfigDict, Field

from auth.access_context import build_access_context
from auth.access_tiers import DEFAULT_ACCESS_TIER, VALID_ACCESS_TIERS

logger = logging.getLogger(__name__)


class User(BaseModel):
    """Authenticated caller extracted from a verified auth token.

    Used across all four auth modes (Firebase, Identity Platform,
    LOCAL_MODE stub, anonymous-group-id — sprint 2.11).

    `group_tags` is populated from the JWT `groupTags` custom claim set
    server-side via `firebase_admin.auth.set_custom_user_claims`. Because it
    comes from a signed JWT the client cannot forge it. An absent or empty
    claim lands as an empty frozenset.

    `auth_mode` distinguishes the four modes for downstream code that
    needs to branch on it (e.g. permissions falls back to `group/<gid>`
    lookup for `anonymous_group_id`). Defaults to `"firebase"` for
    back-compat — existing call sites that construct `User` directly
    don't need to change.

    `group_id` is set ONLY when `auth_mode == "anonymous_group_id"`;
    empty string otherwise. Carrying it on User (rather than as a
    side-channel) keeps the permission system and observability hooks
    type-safe.

    `is_teacher` is the gate for the v1 `/api/classes/*` routes (sprint
    1.A teacher-permission-model). In v1, Firebase-authenticated users
    are teachers; LOCAL_MODE stub is also marked teacher so the same
    routes work in dev. Anonymous-group users are not teachers (they
    can only join via codes). v2 may add non-teacher Firebase users
    (UCPH SSO students) — at which point this stops being a synonym
    for `auth_mode == "firebase"` and a real claim/role check is added.

    `is_researcher` is the third permission tier (sprint 1.1.5
    researcher-role). It comes from the Firebase custom claim
    `{"role": "researcher"}`, set per-identity by a platform admin via
    `POST /api/admin/grant-researcher`. It LAYERS ON TOP of teacher
    identity (a researcher is also `is_teacher=True`) and grants
    cross-class read access via `assert_can_read_class`. The claim is in
    a signed JWT so the client cannot forge it; absent claim → False.

    `access_tier` (ACCESS-1 M1) governs SPEND and FAN-OUT, and nothing
    else. It is deliberately NOT folded into `is_teacher`: that boolean
    means "this is a Firebase identity, not an anonymous-group student"
    and is load-bearing for ~35 `assert_teacher` call sites, most of
    which are navigation surfaces a visitor is supposed to reach. Making
    it also mean "may spend money" would silently change all of them —
    and the ones it would break are exactly the wrong ones.

      * `"visitor"` — the default, and what any identity absent from the
        `teacher_access` register gets. Full navigation, recorded demo
        tutor, no live model, no student join codes.
      * `"pilot"`  — individually invited. Live model under a monthly
        cap, real join codes.

    Sourced from the `accessTier` custom claim, mirrored from Firestore
    `teacher_access/{email}` and reconciled on every
    `POST /api/teacher/bootstrap`. Absent claim ⇒ visitor, so the safe
    value is the default by construction rather than by a check that
    could be forgotten.
    """

    model_config = ConfigDict(frozen=True)

    uid: str
    email: str = ""
    domain: str = ""
    group_tags: frozenset[str] = Field(default_factory=frozenset)
    auth_mode: str = "firebase"
    group_id: str = ""
    is_teacher: bool = False
    is_researcher: bool = False
    access_tier: str = DEFAULT_ACCESS_TIER


def _extract_domain(email: str) -> str:
    """Return the part of `email` after `@`, or `""` if there is no `@`."""
    if "@" not in email:
        return ""
    return email.rsplit("@", 1)[1]


def _user_from_decoded_token(decoded: dict[str, Any]) -> User:
    """Build a `User` from a verified Firebase decoded-token dict.

    Sets `is_teacher=True` because in v1, only teachers carry a Firebase
    identity (students use anonymous-group; dev uses LOCAL_MODE stub).
    See `User.is_teacher` docstring for the v2 caveat.

    Injects the synthetic ``role:teacher`` tag into group_tags so the
    existing tagged-access evaluator can scope teacher-only skills
    (e.g. ``manage-class`` from 1.A M8) via the standard 5-type
    AccessControl model. Skill catalogues filter via
    ``AccessContext.can_access`` — no separate "if user.is_teacher"
    branch needed at the access layer.
    """
    email = decoded.get("email") or ""
    raw_tags = decoded.get("groupTags") or []
    group_tags = frozenset(str(t) for t in raw_tags) | {"role:teacher"}
    is_researcher = decoded.get("role") == "researcher"
    return User(
        uid=decoded["uid"],
        email=email,
        domain=_extract_domain(email),
        group_tags=group_tags,
        is_teacher=True,
        is_researcher=is_researcher,
        access_tier=_access_tier_from_claim(decoded),
    )


def _access_tier_from_claim(decoded: dict[str, Any]) -> str:
    """Read the ``accessTier`` custom claim; anything unrecognised ⇒ visitor.

    Free (no I/O) — the claim rides in the signed JWT, exactly like ``role``
    above, so the client cannot forge it. Firestore ``teacher_access`` remains
    the source of truth and is reconciled into this claim by
    ``POST /api/teacher/bootstrap``.

    An absent, misspelled, or unknown value lands on ``visitor`` rather than
    raising: the failure direction for an unreadable tier is "cannot spend",
    and a hard failure here would lock a real teacher out of navigation too.
    """
    claimed = decoded.get("accessTier")
    if claimed in VALID_ACCESS_TIERS:
        return str(claimed)
    if claimed is not None:
        logger.warning("auth: unrecognised accessTier claim %r; treating as visitor", claimed)
    return DEFAULT_ACCESS_TIER


async def get_current_user(request: Request) -> User:
    """FastAPI dependency: verify `Authorization: Bearer <jwt>` → `User`.

    Raises:
        HTTPException(401): missing header, malformed header (not `Bearer `),
            empty bearer token, or `verify_id_token` rejects the token
            (expired, invalid signature, malformed, revoked).
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Malformed Authorization header")
    token = auth_header[len("Bearer ") :].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    try:
        decoded = fb_auth.verify_id_token(token)
    except fb_auth.ExpiredIdTokenError as exc:
        logger.info("auth: rejected expired token")
        raise HTTPException(status_code=401, detail="Token expired") from exc
    except fb_auth.InvalidIdTokenError as exc:
        logger.info("auth: rejected invalid token")
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    except Exception as exc:
        # Last-resort guard: firebase-admin can raise ValueError on shape errors.
        logger.info("auth: rejected token (%s)", type(exc).__name__)
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    user = _user_from_decoded_token(decoded)
    # Stash a request-scoped AccessContext so route handlers can call
    # `request.state.access.can_access_skill(...)` without re-reading the JWT.
    request.state.access = build_access_context(user)
    logger.info("auth: authenticated uid=%s", user.uid)
    return user


__all__ = ["User", "get_current_user"]
