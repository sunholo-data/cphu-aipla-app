"""Per-teacher features (2026-10-13; first: the Sim workshop).

Researchers have every feature. A teacher has a feature when a researcher or
programme admin switched it on for them on the programme page (the access
register row's ``features``). Everyone else sees the feature greyed out with a
way to ask for it.

The switch is enforced on the server (the sim-author tools, the drafts routes),
not only hidden in the UI.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

SIM_WORKSHOP = "simWorkshop"


def has_feature(user: object, feature: str) -> bool:
    """True when ``user`` may use ``feature``. Fails closed on an unreadable register."""
    if getattr(user, "is_researcher", False):
        return True
    uid = getattr(user, "uid", None)
    if not isinstance(uid, str) or not uid or not getattr(user, "is_teacher", False):
        return False
    try:
        from db.teacher_access import grant_for_uid

        grant = grant_for_uid(uid)
    except Exception:  # an unreadable register refuses; it never grants
        logger.warning("feature check could not read the register for %s", uid)
        return False
    return bool(grant and grant.is_active and grant.features.get(feature))


def feature_map(user: object) -> dict[str, bool]:
    """Every known feature for ``user``."""
    from db.teacher_access import KNOWN_FEATURES

    return {f: has_feature(user, f) for f in sorted(KNOWN_FEATURES)}


_CLAIM_CACHE: dict[str, tuple[float, bool]] = {}
_CLAIM_TTL_S = 60.0


def _is_researcher_uid(uid: str) -> bool:
    """The researcher claim for a uid, via Firebase Admin, cached for a minute."""
    import time

    hit = _CLAIM_CACHE.get(uid)
    if hit and time.monotonic() - hit[0] < _CLAIM_TTL_S:
        return hit[1]
    try:
        from firebase_admin import auth as fb_auth

        claims = fb_auth.get_user(uid).custom_claims or {}
        value = claims.get("role") == "researcher"
    except Exception:  # unreadable -> not a researcher; the register may still grant
        value = False
    _CLAIM_CACHE[uid] = (time.monotonic(), value)
    return value


def has_feature_for_uid(uid: str | None, feature: str) -> bool:
    """``has_feature`` for code that holds only a uid (ADK tools)."""
    if not isinstance(uid, str) or not uid:
        return False
    from config.local_mode import is_local_mode

    if is_local_mode():  # the laptop stub teacher; LOCAL_MODE refuses to run deployed
        return True
    try:
        from db.teacher_access import grant_for_uid

        grant = grant_for_uid(uid)
        if grant and grant.is_active and grant.features.get(feature):
            return True
    except Exception:
        logger.warning("feature check could not read the register for %s", uid)
    return _is_researcher_uid(uid)
