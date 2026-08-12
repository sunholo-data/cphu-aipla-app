"""The access-tier vocabulary (ACCESS-1 M1).

A leaf module with no imports of its own, so both the auth hot path
(`auth/firebase_auth.py`, which must not touch the database) and the register
(`db/teacher_access.py`, which owns the Firestore rows) can share one definition
of what a tier IS without either importing the other.

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md
"""

from __future__ import annotations

from typing import Literal

AccessTier = Literal["visitor", "pilot"]

#: Full navigation, recorded-demo tutor, no live model, no student join codes.
TIER_VISITOR: AccessTier = "visitor"

#: Individually invited. Live model under a monthly cap; real join codes.
TIER_PILOT: AccessTier = "pilot"

VALID_ACCESS_TIERS: frozenset[str] = frozenset({TIER_VISITOR, TIER_PILOT})

#: The tier every identity carries until the register says otherwise.
#:
#: Default-deny by ABSENCE, not by an explicit check: a new code path that
#: forgets to consult the register still cannot spend, because there is no
#: state in which "no answer" means "allowed".
DEFAULT_ACCESS_TIER: AccessTier = TIER_VISITOR


def can_spend(tier: str) -> bool:
    """Whether ``tier`` authorises paid work and student fan-out."""
    return tier == TIER_PILOT


__all__ = [
    "DEFAULT_ACCESS_TIER",
    "TIER_PILOT",
    "TIER_VISITOR",
    "VALID_ACCESS_TIERS",
    "AccessTier",
    "can_spend",
]
