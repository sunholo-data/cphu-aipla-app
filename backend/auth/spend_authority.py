"""Who is paying for this turn (ACCESS-1 M1).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

A Firebase identity carries its own tier in a claim. An anonymous-group student
carries none — by ADR-001 they have no identity at all — so their authority to
spend is their TEACHER's authority, resolved group -> class -> ownerUid ->
register.

That indirection is the point of the whole design: it is what makes one invited
teacher's cap cover the thirty students they hand a join code to, rather than
covering only the teacher's own typing.

CACHING
    The group -> owner mapping changes approximately never, and the register row
    changes when an admin runs a CLI command. Both are cached in-process with a
    short TTL so the gate costs no Firestore round-trip on the common path. The
    TTL is the staleness bound on a revoke reaching students mid-lesson.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from auth.access_tiers import DEFAULT_ACCESS_TIER, TIER_PILOT, AccessTier
from auth.firebase_auth import User

logger = logging.getLogger(__name__)

#: How long a resolved student->teacher tier is trusted. Short enough that a
#: revoke reaches an in-progress class quickly, long enough that a 30-student
#: class does not stampede Firestore on every turn.
_CACHE_TTL_SECONDS = 60.0


@dataclass(frozen=True)
class SpendAuthority:
    """The answer: may this caller spend, and on whose account."""

    tier: AccessTier
    #: Stable key for the paying party — ``teacher:{uid}``. This is the identity
    #: M3's budget enforcer meters against, so a student's turns and their
    #: teacher's co-pilot turns land on one budget.
    billing_identity: str | None
    #: Why we answered this way; goes in logs and the 402 body. Never shown raw
    #: to a student.
    reason: str

    @property
    def can_spend(self) -> bool:
        return self.tier == TIER_PILOT


_cache: dict[str, tuple[float, str]] = {}


def _cache_get(key: str) -> str | None:
    hit = _cache.get(key)
    if hit is None:
        return None
    expires_at, value = hit
    if expires_at < time.monotonic():
        _cache.pop(key, None)
        return None
    return value


def _cache_put(key: str, value: str) -> None:
    _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, value)


def clear_cache() -> None:
    """Drop the memo. Used by tests and by the admin grant/revoke path."""
    _cache.clear()


class _OwnerLookupUnavailable(Exception):
    """The group -> owner walk could not be READ. See ``RegisterUnavailable``."""


def _owner_uid_for_group(group_id: str) -> str | None:
    """Resolve an anonymous-group code to the uid of the class's owning teacher.

    Mirrors the walk ``auth.group_id_auth._resolve_class_tags`` already does for
    tag namespacing: ``anon_groups/{code}.classId`` -> ``classes/{id}.ownerUid``.
    """
    cached = _cache_get(f"group_owner:{group_id}")
    if cached is not None:
        return cached or None

    try:
        from db.firestore import get_document

        group_doc = get_document("anon_groups", group_id) or {}
        class_id = group_doc.get("classId")
        if not class_id:
            _cache_put(f"group_owner:{group_id}", "")
            return None
        class_doc = get_document("classes", str(class_id)) or {}
        owner_uid = str(class_doc.get("ownerUid") or "")
    except Exception:
        logger.warning("spend_authority: could not resolve owner for group=%s", group_id, exc_info=True)
        raise _OwnerLookupUnavailable(group_id) from None

    _cache_put(f"group_owner:{group_id}", owner_uid)
    return owner_uid or None


def _tier_for_uid(uid: str) -> AccessTier | None:
    """The register tier for a teacher uid, or ``None`` if not on the register.

    The register is keyed by EMAIL (so a teacher can be invited before they have
    a uid), and the uid is stamped on the row at first sign-in. This is the
    reverse lookup for the student path, where all we have is the class's
    ``ownerUid``.

    ``None`` means genuinely-not-found, which the caller distinguishes from
    "found and not a pilot" — the two get different failure directions.
    """
    cached = _cache_get(f"uid_tier:{uid}")
    if cached is not None:
        return cached or None  # type: ignore[return-value]

    from db.teacher_access import RegisterUnavailable, grant_for_uid

    try:
        grant = grant_for_uid(uid)
    except RegisterUnavailable:
        raise
    except Exception:
        logger.warning("spend_authority: register lookup failed for uid=%s", uid, exc_info=True)
        raise RegisterUnavailable(uid) from None

    if grant is None:
        _cache_put(f"uid_tier:{uid}", "")
        return None

    tier = grant.effective_tier
    _cache_put(f"uid_tier:{uid}", tier)
    return tier


def resolve_spend_authority(user: User) -> SpendAuthority:
    """Decide whether ``user``'s turn may reach a paid model, and on whose budget."""

    # --- Firebase identity: its own claim decides -----------------------------
    if not user.group_id:
        return SpendAuthority(
            tier=user.access_tier if user.access_tier in {TIER_PILOT, DEFAULT_ACCESS_TIER} else DEFAULT_ACCESS_TIER,  # type: ignore[arg-type]
            billing_identity=f"teacher:{user.uid}" if user.uid else None,
            reason="firebase_claim",
        )

    # --- Anonymous-group student: their teacher's authority -------------------
    #
    # THE ONLY THING THAT STILL FAILS OPEN IS "WE GOT NO ANSWER".
    #
    # Until 2026-08-18 both branches below granted pilot, on the M1 reasoning
    # that a visitor is never issued a join code, so a working code must belong
    # to someone who was invited. That held right up until the uid join silently
    # stopped resolving anyone (see `db.teacher_access.grant_for_uid`) — at which
    # point EVERY student took the not-registered branch and the leniency meant
    # for a handful of legacy classes covered the entire programme, including a
    # visitor's class that spent for four days.
    #
    # A lenient branch is only as narrow as the thing that decides you land in
    # it. So: a resolved answer is now obeyed whatever it says, and leniency is
    # reserved for the case where the database did not answer at all — where
    # refusing would end a live lesson over a transient read, and where Ring 0's
    # quota is still underneath.
    try:
        owner_uid = _owner_uid_for_group(user.group_id)
    except _OwnerLookupUnavailable:
        logger.error(
            "spend_authority: COULD NOT READ the owner for group=%s; allowing this turn",
            user.group_id,
        )
        return SpendAuthority(tier=TIER_PILOT, billing_identity=None, reason="owner_lookup_unavailable")

    if not owner_uid:
        # Read it, and there is no class behind this code — deleted, or a code
        # that never had one. Nobody is paying, so nobody may spend.
        logger.warning(
            "spend_authority: group=%s resolves to no owning teacher; refusing",
            user.group_id,
        )
        return SpendAuthority(tier=DEFAULT_ACCESS_TIER, billing_identity=None, reason="student_owner_unresolved")

    try:
        owner_tier = _tier_for_uid(owner_uid)
    except Exception:  # RegisterUnavailable, re-raised by _tier_for_uid
        logger.error(
            "spend_authority: COULD NOT READ the register for owner uid=%s; allowing this turn (group=%s)",
            owner_uid,
            user.group_id,
        )
        return SpendAuthority(tier=TIER_PILOT, billing_identity=f"teacher:{owner_uid}", reason="register_unavailable")

    if owner_tier is None:
        # Read the register; this owner is not on it. They have no authority to
        # spend, so neither do the students holding their code.
        logger.warning(
            "spend_authority: owner uid=%s is not on the register; refusing (group=%s)",
            owner_uid,
            user.group_id,
        )
        return SpendAuthority(
            tier=DEFAULT_ACCESS_TIER,
            billing_identity=f"teacher:{owner_uid}",
            reason="student_owner_not_registered",
        )

    return SpendAuthority(
        tier=owner_tier,
        billing_identity=f"teacher:{owner_uid}",
        reason="student_owner_tier",
    )


__all__ = ["SpendAuthority", "clear_cache", "resolve_spend_authority"]
