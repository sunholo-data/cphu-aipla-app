"""LOCAL_MODE auth stub — drop-in replacement for ``get_current_user``.

Only activates when ``LOCAL_MODE=1``. Returns a fixed workshop identity
when the request carries the exact stub token, rejects everything else.

Security mitigations layered around this stub:
1. The token must equal ``local-mode-stub-token`` exactly — any other
   bearer is rejected. Prevents a misconfigured LOCAL_MODE backend from
   accidentally accepting real Firebase tokens.
2. ``config/local_mode.py:assert_safe_local_mode()`` refuses to start the
   backend if LOCAL_MODE is paired with K_SERVICE / GAE_ENV / KUBERNETES
   markers (Cloud Run / App Engine / GKE).
3. The visible banner mounted by the frontend in LOCAL_MODE makes the
   stubbed state obvious to anyone using the system.

See ``docs/design/v6.1.0/local-mode-and-workshop-readiness.md`` §313
"Security Considerations" for the full rationale.
"""

from __future__ import annotations

import logging
import os

from fastapi import HTTPException, Request

from auth.access_context import build_access_context
from auth.access_tiers import TIER_PILOT
from auth.firebase_auth import User

logger = logging.getLogger(__name__)

STUB_TOKEN = "local-mode-stub-token"

WORKSHOP_USER_UID = "workshop-user"
WORKSHOP_USER_EMAIL = "workshop@local"
WORKSHOP_USER_DOMAIN = "local"
WORKSHOP_USER_GROUP_TAGS = frozenset({"workshop-attendee", "role:teacher"})


def build_workshop_user() -> User:
    """Return the deterministic workshop user. Kept as a function so callers
    that mock it for tests have a single seam.

    Marked `is_teacher=True` so the LOCAL_MODE dev path can exercise the
    teacher routes added in 1.A teacher-permission-model without
    branching on env. The workshop user has been the de-facto teacher
    in dev since 1.G-Ph2.

    Set `LOCAL_MODE_RESEARCHER=1` to also mark the workshop user as a
    researcher (sprint 1.1.5) — lets a dev exercise the cross-class
    Research view without a real Firebase custom claim.

    Marked `access_tier="pilot"` (ACCESS-1 M1) so LOCAL_MODE keeps working
    end-to-end without an entry in the `teacher_access` register — the
    register lives in Firestore and LOCAL_MODE's is in-memory and empty.
    This is safe by the same assert that guards everything else here:
    `assert_safe_local_mode()` hard-fails if LOCAL_MODE is ever set on a
    real deployment (`config/local_mode.py`), so this tier cannot leak to
    a served environment. It is also why the LOCAL_MODE flag name is
    regex-banned from every deployed config.
    """
    is_researcher = os.environ.get("LOCAL_MODE_RESEARCHER") == "1"
    # Opt-in like the researcher bit above, and for the same reason: the
    # delegated-admin surface (1.1.76) should be reachable in LOCAL_MODE for
    # development, but not be the default identity every local run carries.
    is_programme_admin = os.environ.get("LOCAL_MODE_PROGRAMME_ADMIN") == "1"
    return User(
        uid=WORKSHOP_USER_UID,
        email=WORKSHOP_USER_EMAIL,
        domain=WORKSHOP_USER_DOMAIN,
        group_tags=WORKSHOP_USER_GROUP_TAGS,
        is_teacher=True,
        is_researcher=is_researcher,
        is_programme_admin=is_programme_admin,
        access_tier=TIER_PILOT,
    )


async def get_current_user_local_mode(request: Request) -> User:
    """FastAPI dependency: LOCAL_MODE equivalent of ``get_current_user``.

    Accepts only the stub token. The shape of the parsing is identical to
    the production dep so callers can swap one for the other transparently.

    Raises:
        HTTPException(401): missing header, malformed header, or token does
            not match the stub.
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Malformed Authorization header")
    token = auth_header[len("Bearer ") :].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    if token != STUB_TOKEN:
        logger.info("local_mode auth: rejected non-stub token")
        raise HTTPException(status_code=401, detail="LOCAL_MODE requires stub token")

    user = build_workshop_user()
    request.state.access = build_access_context(user)
    logger.debug("local_mode auth: granted uid=%s", user.uid)
    return user


__all__ = [
    "STUB_TOKEN",
    "WORKSHOP_USER_EMAIL",
    "WORKSHOP_USER_UID",
    "build_workshop_user",
    "get_current_user_local_mode",
]
