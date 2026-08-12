"""The spend gate for everything the ADK callback cannot see (ACCESS-1 M3).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

``budget/callback.py`` guards the ADK agent loop. It does not — and cannot —
guard the ten places that call ``genai.Client(...).aio.models.generate_content``
directly, nor Vertex RAG, nor Cloud TTS/STT. Between them those are a large
fraction of the bill, and one of them (the compaction summariser) is
student-triggered on the expensive ``smart_model()`` tier.

This is the same enforcer, the same billing identity, reachable from a plain
async function so a non-ADK call site is one line away from being metered:

    await guard_spend(user, purpose="pdf_extract", projected_usd=0.02)

WHAT IT DOES NOT DO
    It does not record the realised cost — the caller knows that, and most of
    these paths do not surface token counts at all. It answers "may this happen"
    and leaves metering to whoever can measure. That asymmetry is deliberate:
    a gate that refused to run until every caller could report exact usage would
    have shipped on none of them.
"""

from __future__ import annotations

import logging
import uuid

from auth.firebase_auth import User
from budget.enforcer import BudgetConsultation, BudgetExceededError, get_registered_enforcer

logger = logging.getLogger("budget.spend_guard")


async def guard_spend(
    user: User,
    *,
    purpose: str,
    projected_usd: float,
    model_id: str = "unknown",
) -> None:
    """Raise ``BudgetExceededError`` when this caller must not spend.

    No-ops when no enforcer is registered (LOCAL_MODE, tests, and any
    deployment that has not opted in) — same posture as the ADK callback, so
    turning the enforcer on is one registration rather than a sweep.

    Args:
        user: the caller. Students resolve to their owning teacher.
        purpose: short slug for logs, e.g. ``"pdf_extract"``, ``"rag_query"``.
        projected_usd: a rough over-estimate. Over-estimating is the safe
            direction here: this path has no ``record()`` to reconcile against.
        model_id: for the log line; not used to price (the caller has already
            projected).
    """
    enforcer = get_registered_enforcer()
    if enforcer is None:
        return

    from auth.spend_authority import resolve_spend_authority

    authority = resolve_spend_authority(user)
    if not authority.billing_identity:
        # Unresolvable payer. Consistent with the ADK callback's inverted
        # default (budget/callback.py): on a public domain, "we cannot tell who
        # is paying" means do not spend.
        logger.error("spend_guard.identity_unresolved purpose=%s uid=%s — BLOCKING", purpose, user.uid)
        from budget.enforcer import BudgetDecision

        raise BudgetExceededError(
            BudgetDecision(
                action="block",
                remaining_usd=None,
                period_end=None,
                message="This feature is unavailable for this account right now.",
                retry_after_seconds=None,
            )
        )

    decision = await enforcer.consult(
        BudgetConsultation(
            identity_value=authority.billing_identity,
            skill_id=f"nonagent:{purpose}",
            model_id=model_id,
            projected_cost_usd=projected_usd,
            invocation_id=uuid.uuid4().hex,
        )
    )
    if decision.action == "block":
        logger.warning("spend_guard.blocked purpose=%s identity=%s", purpose, authority.billing_identity)
        raise BudgetExceededError(decision)


__all__ = ["guard_spend"]
