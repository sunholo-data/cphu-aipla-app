"""Post-write effects shared by both doors onto the access register.

The register has two doors (1.1.76) — the unbounded service-account path in
``admin/routes.py`` and the bounded delegated path in
``protocols/programme_routes.py``. They must NOT share a guard: that separation
is what stops one being widened while someone edits the other.

They must, however, share everything that happens AFTER a write lands, because
a grant that skips any of it is a grant that does not take effect:

  * push the register's answer into the ``accessTier`` custom claim
  * stamp the resolved uid onto the row (the spend gates join by uid)
  * invalidate the spend-authority cache
  * close a matching access request

Duplicating these per door is how one door quietly stops working — and the
symptom would be the worst kind: ``list-access`` looks perfectly correct while
the cap never binds. That is not hypothetical; it is the 2026-08-18 incident
where 17 of 18 prod rows carried ``uid: null`` because the stamp ran on only
one path.
"""

from __future__ import annotations

import logging

from firebase_admin import auth as fb_auth

logger = logging.getLogger(__name__)


def sync_access_claim(email: str, tier: str) -> str | None:
    """Push the register's answer into the Firebase custom claim, if we can.

    Returns the uid whose claim was updated, or ``None`` when the person has
    never signed in (no Firebase user yet). That is the normal case for a fresh
    invite and is NOT an error: ``POST /api/teacher/bootstrap`` reconciles the
    claim on their first app load.

    Merges rather than replaces — ``set_custom_user_claims`` overwrites the whole
    blob, so a naive write here would silently un-researcher a researcher (or,
    now, un-programme-admin a programme admin).
    """
    try:
        fb_user = fb_auth.get_user_by_email(email)
    except fb_auth.UserNotFoundError:
        return None
    except Exception:
        logger.warning("access_sync: could not look up %s in Firebase", email, exc_info=True)
        return None

    claims = dict(fb_user.custom_claims or {})
    claims["accessTier"] = tier
    fb_auth.set_custom_user_claims(fb_user.uid, claims)

    # Stamp the uid onto the register HERE, where we have just resolved it. The
    # spend gates join register-to-caller by uid, and this is the one moment an
    # email and a uid are both in hand. Leaving it to the bootstrap route's
    # tier-drift branch meant it never ran for anyone granted while already
    # signed in — see `db.teacher_access.grant_for_uid`.
    try:
        from db.teacher_access import stamp_uid

        stamp_uid(email, fb_user.uid)
    except Exception:
        logger.warning("access_sync: could not stamp uid for %s", email, exc_info=True)

    return fb_user.uid


def invalidate_spend_cache() -> None:
    """Drop the memoised tier/owner lookups so a grant takes effect now.

    Without this a freshly granted teacher keeps reading as a visitor for the
    cache's lifetime, which looks exactly like "the grant did not work".

    Only clears THIS container's cache — other Cloud Run instances keep theirs
    until the TTL expires (60s). That bound is the reason revoke also kills
    refresh tokens rather than relying on this.
    """
    try:
        from auth.spend_authority import clear_cache

        clear_cache()
    except Exception:
        logger.debug("access_sync: could not clear the spend-authority cache", exc_info=True)


def close_access_request(uid: str, *, decided_by: str) -> None:
    """Mark a matching request granted so the queue drains as grants are issued
    rather than needing separate upkeep."""
    try:
        from db.access_requests import mark_decided

        mark_decided(uid, status="granted", decided_by=decided_by)
    except Exception:
        logger.debug("access_sync: could not close the access request", exc_info=True)


def revoke_sessions(uid: str) -> None:
    """Drop outstanding sessions after a revoke.

    The custom claim can be up to an hour stale, so revoking the register row
    alone would leave a revoked teacher spending for the rest of the token's
    life. This closes that window: the next token refresh fails and the client
    must re-authenticate, picking up the visitor claim.
    """
    try:
        fb_auth.revoke_refresh_tokens(uid)
    except Exception:
        logger.warning("access_sync: could not revoke refresh tokens for uid=%s", uid, exc_info=True)
