"""The teacher access register — who is allowed to spend money (ACCESS-1 M1).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

`aipla.ku.dk` is public. Google sign-in is unrestricted, and until this module
existed every verified Firebase token became a fully-provisioned teacher with a
live student join code and no spend ceiling. This is the register that decides
which of those identities may cause a paid API call.

WHY KEYED BY EMAIL, NOT UID
    The whole point is to authorise someone BEFORE they have ever signed in — a
    uid does not exist until first sign-in, but an invite only needs an address.
    The uid is stamped on the doc at first sight, for audit.

WHY A CUSTOM CLAIM MIRRORS IT
    Reading Firestore inside the auth hot path would put a network round-trip in
    front of every request. So: Firestore is the source of truth (admin writes
    here), a Firebase custom claim is the carried credential (free to read off
    the decoded token), and `POST /api/teacher/bootstrap` reconciles the two on
    every app load. See `auth/firebase_auth.py` and
    `protocols/teacher_bootstrap_routes.py`.

    The consequence to keep in mind: a GRANT is visible within one app load,
    but a REVOKE would ride a stale token for up to an hour — so revoke also
    calls `revoke_refresh_tokens`, and `expiresAt` is checked against the
    register rather than the claim.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from auth.access_tiers import DEFAULT_ACCESS_TIER, VALID_ACCESS_TIERS, AccessTier
from db.firestore import get_document, query_documents, set_document

logger = logging.getLogger(__name__)

_COLLECTION = "teacher_access"

#: Default monthly cap (USD) stamped on a grant that does not name one.
#: Deliberately low — raising it is one CLI call, and an under-provisioned
#: teacher complains, whereas an over-provisioned one does not.
#:
#: THERE IS NO UNCAPPED DEFAULT, on any path (M, 2026-08-12: "we need a default
#: that is not uncapped"). The grandfather script used to default to uncapped,
#: reasoning that capping people already teaching could cut off a lesson; the
#: better answer is a real default plus the enforcer's warn-at-80%, because a
#: cap you can raise in one command beats a limit nobody set.
DEFAULT_MONTHLY_CAP_USD = 25.0

#: The ONLY value meaning "no per-teacher limit". Negative and explicit, because
#: uncapped must be something you ask for, never something you fall into.
#:
#: It used to be 0 — which is what an empty form field, a dropped key and a
#: failed parse all coerce to. A sentinel you can reach by accident is not a
#: sentinel, it is a trapdoor: `cap = 0` disabled the gate outright, so a turn
#: projected at $999,999 returned `allow`. Now 0 means what it says — zero
#: budget, block — which is independently useful: suspend a teacher's spend
#: without revoking their grant, their classes or their join codes.
UNCAPPED = -1.0


def normalise_email(email: str) -> str:
    """Lower-case and strip. Nothing else — deliberately.

    No Gmail dot-folding, no plus-address stripping. The invited string must
    match what the identity provider actually returns: inventing equivalences
    here would create a way to be admitted under an address nobody invited.
    The cost is that an invite typo fails visibly, which is the correct failure.
    """
    return (email or "").strip().lower()


@dataclass(frozen=True)
class AccessGrant:
    """One row of the register."""

    email: str
    tier: AccessTier
    monthly_cap_usd: float
    granted_by: str = ""
    granted_at: str = ""
    expires_at: str | None = None
    note: str = ""
    revoked: bool = False
    uid: str | None = None
    first_seen_at: str | None = None

    @property
    def is_active(self) -> bool:
        """True when this grant should currently confer its tier.

        Revocation and expiry are evaluated HERE, against the register, not
        against the mirrored custom claim — a claim can be up to an hour stale
        and a lapsed grant must not ride one to the end of the contract.
        """
        if self.revoked:
            return False
        if self.tier not in VALID_ACCESS_TIERS:
            return False
        return not _is_expired(self.expires_at)

    @property
    def is_uncapped(self) -> bool:
        """True only for the explicit sentinel. 0 is a ZERO cap, not no cap."""
        return self.monthly_cap_usd == UNCAPPED

    @property
    def effective_tier(self) -> AccessTier:
        """The tier to actually apply: the granted one, or visitor if inactive."""
        return self.tier if self.is_active else DEFAULT_ACCESS_TIER

    def to_doc(self) -> dict[str, Any]:
        return {
            "email": self.email,
            "tier": self.tier,
            "monthlyCapUsd": self.monthly_cap_usd,
            "grantedBy": self.granted_by,
            "grantedAt": self.granted_at,
            "expiresAt": self.expires_at,
            "note": self.note,
            "revoked": self.revoked,
            "uid": self.uid,
            "firstSeenAt": self.first_seen_at,
        }

    @classmethod
    def from_doc(cls, doc: dict[str, Any]) -> AccessGrant:
        raw_tier = str(doc.get("tier") or DEFAULT_ACCESS_TIER)
        tier: AccessTier = raw_tier if raw_tier in VALID_ACCESS_TIERS else DEFAULT_ACCESS_TIER  # type: ignore[assignment]
        raw_cap = doc.get("monthlyCapUsd")
        if raw_cap is None:
            cap = DEFAULT_MONTHLY_CAP_USD  # absent -> the default, never uncapped
        else:
            try:
                cap = float(raw_cap)
            except (TypeError, ValueError):
                logger.warning(
                    "teacher_access: unparseable monthlyCapUsd=%r for %s; using the default",
                    raw_cap,
                    doc.get("email"),
                )
                cap = DEFAULT_MONTHLY_CAP_USD
        return cls(
            email=normalise_email(str(doc.get("email") or "")),
            tier=tier,
            monthly_cap_usd=cap,
            granted_by=str(doc.get("grantedBy") or ""),
            granted_at=str(doc.get("grantedAt") or ""),
            expires_at=doc.get("expiresAt"),
            note=str(doc.get("note") or ""),
            revoked=bool(doc.get("revoked", False)),
            uid=doc.get("uid"),
            first_seen_at=doc.get("firstSeenAt"),
        )


def _is_expired(expires_at: str | None) -> bool:
    """True when ``expires_at`` is a past ISO-8601 timestamp.

    An unparseable value is treated as EXPIRED. That is the fail-closed
    direction: a corrupt date should cost someone their spend authority (one
    CLI call to fix) rather than silently confer it forever.
    """
    if not expires_at:
        return False
    try:
        parsed = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        logger.warning("teacher_access: unparseable expiresAt=%r; treating as expired", expires_at)
        return True
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed <= datetime.now(UTC)


def get_grant(email: str) -> AccessGrant | None:
    """The register row for ``email``, or ``None`` if never invited."""
    key = normalise_email(email)
    if not key:
        return None
    doc = get_document(_COLLECTION, key)
    if not doc:
        return None
    return AccessGrant.from_doc(doc)


def resolve_tier(email: str) -> AccessTier:
    """The tier ``email`` should currently carry. Absent/revoked/expired ⇒ visitor."""
    grant = get_grant(email)
    if grant is None:
        return DEFAULT_ACCESS_TIER
    return grant.effective_tier


def grant_access(
    email: str,
    *,
    tier: AccessTier = "pilot",
    monthly_cap_usd: float = DEFAULT_MONTHLY_CAP_USD,
    granted_by: str = "",
    expires_at: str | None = None,
    note: str = "",
) -> AccessGrant:
    """Write (or re-write) a register row. Idempotent by email.

    Re-granting an existing email preserves ``uid`` / ``firstSeenAt`` (audit
    trail) and clears ``revoked`` — so "grant" is also how you un-revoke.
    """
    key = normalise_email(email)
    if not key:
        raise ValueError("email is required")
    if tier not in VALID_ACCESS_TIERS:
        raise ValueError(f"tier must be one of {sorted(VALID_ACCESS_TIERS)}; got {tier!r}")
    if monthly_cap_usd < 0 and monthly_cap_usd != UNCAPPED:
        raise ValueError(f"monthly_cap_usd must be >= 0, or exactly {UNCAPPED} for uncapped")
    if monthly_cap_usd == UNCAPPED:
        # Loud on purpose: an uncapped teacher is bounded only by the SHARED
        # project quota, so they can starve every other teacher on it.
        logger.warning("teacher_access.grant UNCAPPED email=%s by=%s", key, granted_by or "?")

    existing = get_grant(key)
    grant = AccessGrant(
        email=key,
        tier=tier,
        monthly_cap_usd=float(monthly_cap_usd),
        granted_by=granted_by,
        granted_at=datetime.now(UTC).isoformat(),
        expires_at=expires_at,
        note=note,
        revoked=False,
        uid=existing.uid if existing else None,
        first_seen_at=existing.first_seen_at if existing else None,
    )
    set_document(_COLLECTION, key, grant.to_doc(), merge=False)
    logger.info(
        "teacher_access.grant email=%s tier=%s cap=%.2f by=%s expires=%s",
        key,
        tier,
        monthly_cap_usd,
        granted_by or "?",
        expires_at or "never",
    )
    return grant


def revoke_access(email: str, *, revoked_by: str = "") -> bool:
    """Mark a row revoked. Returns False if the email was never on the register.

    Does NOT delete: the row is the audit trail of who was granted what and
    when. The caller is responsible for `revoke_refresh_tokens` — see
    `admin/routes.py`, which must invalidate outstanding sessions or the
    mirrored claim rides on for up to an hour.
    """
    key = normalise_email(email)
    existing = get_grant(key)
    if existing is None:
        return False
    doc = existing.to_doc()
    doc["revoked"] = True
    doc["revokedBy"] = revoked_by
    doc["revokedAt"] = datetime.now(UTC).isoformat()
    set_document(_COLLECTION, key, doc, merge=False)
    logger.info("teacher_access.revoke email=%s by=%s", key, revoked_by or "?")
    return True


def list_grants(*, include_revoked: bool = False, limit: int = 500) -> list[AccessGrant]:
    """Every row on the register, newest grant first."""
    docs = query_documents(_COLLECTION, limit=limit)
    grants = [AccessGrant.from_doc(d) for d in docs]
    if not include_revoked:
        grants = [g for g in grants if not g.revoked]
    return sorted(grants, key=lambda g: g.granted_at or "", reverse=True)


def stamp_uid(email: str, uid: str) -> None:
    """Record the uid behind an invited email, the first time we see it.

    Audit only — nothing keys off this. Never overwrites an existing uid: if two
    identities ever resolve to one invited address that is worth noticing in the
    logs rather than silently reassigning.
    """
    key = normalise_email(email)
    grant = get_grant(key)
    if grant is None:
        return
    if grant.uid and grant.uid != uid:
        logger.warning(
            "teacher_access: email=%s already stamped uid=%s, saw uid=%s; keeping the first",
            key,
            grant.uid,
            uid,
        )
        return
    if grant.uid == uid:
        return
    doc = grant.to_doc()
    doc["uid"] = uid
    doc["firstSeenAt"] = datetime.now(UTC).isoformat()
    set_document(_COLLECTION, key, doc, merge=False)


__all__ = [
    "DEFAULT_ACCESS_TIER",
    "DEFAULT_MONTHLY_CAP_USD",
    "UNCAPPED",
    "VALID_ACCESS_TIERS",
    "AccessGrant",
    "AccessTier",
    "get_grant",
    "grant_access",
    "list_grants",
    "normalise_email",
    "resolve_tier",
    "revoke_access",
    "stamp_uid",
]
