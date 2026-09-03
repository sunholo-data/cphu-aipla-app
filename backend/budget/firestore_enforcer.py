"""Per-teacher monthly cap, backed by Firestore (ACCESS-1 M3).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

Implements the EXISTING ``BudgetEnforcer`` Protocol (``budget/enforcer.py``) —
no new gate, no new callback, no new config schema. The ADK before/after pair at
``adk/agent.py`` has been calling into this seam since template Sprint 2.12; all
that was missing was an implementation registered at startup.

WHY NOT THE REFERENCE IMPL
    ``InMemoryBudgetEnforcer`` says so itself: single-instance only. Cloud Run
    scales, so each instance would enforce its own private fraction of the cap
    and the real ceiling would be N times what anyone configured.

THE CAP IS A CIRCUIT BREAKER, NOT AN ACCOUNTANT
    Spend is held in SHARDED counters and read through a short-lived cache, so
    overshoot is possible and bounded by (staleness x burn rate). That is
    deliberate. Enforcing to the cent would mean a synchronous, unsharded,
    transactional decrement on the critical path of every turn — latency plus a
    hot-document bottleneck (Firestore sustains ~1 write/sec/document, and a
    class of 30 mid-lesson exceeds that) — in exchange for precision nobody
    needs from a safety net.

    Its job is to convert an unbounded liability into a bounded one. The
    BigQuery pipeline (``analytics/cost_queries.py``) stays the accounting
    truth, and Ring 0's Vertex quota stays the actual ceiling.
"""

from __future__ import annotations

import logging
import random
from datetime import UTC, datetime

from budget.enforcer import BudgetConsultation, BudgetDecision

logger = logging.getLogger("budget.firestore")

_SPEND_COLLECTION = "teacher_spend"

#: Counter shards per (identity, period). Firestore sustains roughly one write
#: per second per DOCUMENT, and a 30-student class mid-lesson will exceed that
#: against a single doc. Ten shards buys an order of magnitude for one extra
#: read on the consult path.
SHARD_COUNT = 10

#: How long a summed shard total is trusted. This is the staleness half of the
#: overshoot bound, and the reason this is documented as a breaker not a meter.
_TOTAL_CACHE_SECONDS = 10.0

#: Fraction of the cap that flips allow -> warn.
SOFT_THRESHOLD = 0.8

#: How long a group -> owning-teacher resolution is trusted. Mirrors the TTL in
#: ``auth.spend_authority``; a class changes owner approximately never.
_PAYER_CACHE_SECONDS = 60.0


def _period_key(now: datetime | None = None) -> str:
    """Monthly buckets, UTC. Matches the cost dashboard's period grain."""
    stamp = now or datetime.now(UTC)
    return f"{stamp.year:04d}-{stamp.month:02d}"


class FirestoreBudgetEnforcer:
    """Meters spend per billing identity against that teacher's monthly cap.

    Duck-typed against ``BudgetEnforcer`` — the Protocol is
    ``@runtime_checkable`` and needs only the two async methods.
    """

    def __init__(self, *, soft_threshold: float = SOFT_THRESHOLD) -> None:
        self._soft_threshold = soft_threshold
        # {(identity, period): (total_usd, monotonic_expiry)}
        self._total_cache: dict[tuple[str, str], tuple[float, float]] = {}
        # {(invocation_id, identity): projected_usd} so record() can reconcile.
        self._held: dict[tuple[str, str], float] = {}
        # {identity: (payer_uid | None, monotonic_expiry)} — the group -> owner walk.
        self._payer_cache: dict[str, tuple[str | None, float]] = {}

    # --- Protocol ------------------------------------------------------------

    async def consult(self, request: BudgetConsultation) -> BudgetDecision:
        meter_key = self._billing_key(request.identity_value)
        cap = self._cap_for(request.identity_value)
        if cap is None:
            # No cap configured for this identity. Allow, but say so loudly:
            # an uncapped pilot teacher is a deliberate state (M is watching a
            # handful of them) and a silent one would be a hole.
            logger.info(
                "budget.no_cap identity=%s billed_to=%s skill=%s",
                request.identity_value,
                meter_key,
                request.skill_id,
            )
            return BudgetDecision(
                action="allow", remaining_usd=None, period_end=None, message=None, retry_after_seconds=None
            )

        period = _period_key()
        spent = self._read_total(meter_key, period)
        projected = spent + request.projected_cost_usd
        remaining = max(0.0, cap - spent)

        self._held[(request.invocation_id, meter_key)] = request.projected_cost_usd

        if cap <= 0:
            # A deliberate ZERO cap: spend suspended, grant/classes/codes intact.
            # Must be checked BEFORE the generic over-cap branch so the student
            # gets "paused", not "you have used your whole monthly budget" —
            # they have used nothing. Also guards the ratio below from /0.
            logger.warning("budget.zero_cap identity=%s skill=%s", request.identity_value, request.skill_id)
            return BudgetDecision(
                action="block",
                remaining_usd=0.0,
                period_end=None,
                message="AI usage is paused for this class. Contact the AIPLA team to resume it.",
                retry_after_seconds=None,
            )

        if projected >= cap:
            logger.warning(
                "budget.block identity=%s spent=%.4f cap=%.2f skill=%s",
                request.identity_value,
                spent,
                cap,
                request.skill_id,
            )
            return BudgetDecision(
                action="block",
                remaining_usd=0.0,
                period_end=None,
                message=(
                    "This class has reached its monthly AI budget. The tutor will "
                    "resume at the start of next month, or contact the AIPLA team "
                    "to raise the limit."
                ),
                retry_after_seconds=None,
            )

        if projected >= cap * self._soft_threshold:
            return BudgetDecision(
                action="warn",
                remaining_usd=remaining,
                period_end=None,
                message=f"This class has used {spent / cap:.0%} of its monthly AI budget.",
                retry_after_seconds=None,
            )

        return BudgetDecision(
            action="allow", remaining_usd=remaining, period_end=None, message=None, retry_after_seconds=None
        )

    async def record(self, request: BudgetConsultation, actual_cost_usd: float) -> None:
        """Add the realised cost to a random shard, and drop the held projection.

        The projection is NOT charged at consult time (unlike the reference
        impl): with sharded, cached totals a hold would have to be written and
        then corrected, doubling the writes on the hot path to buy accuracy this
        design has already said it does not need. The consequence is that a
        burst of concurrent turns can each see a pre-burst total — bounded, and
        the documented overshoot.
        """
        meter_key = self._billing_key(request.identity_value)
        self._held.pop((request.invocation_id, meter_key), None)
        if actual_cost_usd <= 0:
            return

        period = _period_key()
        shard = random.randint(0, SHARD_COUNT - 1)
        doc_id = f"{meter_key}|{period}|{shard}"
        try:
            from db.firestore import increment_field, set_document

            try:
                increment_field(_SPEND_COLLECTION, doc_id, "spentMicroUsd", int(actual_cost_usd * 1_000_000))
            except Exception:
                # First write for this shard: increment needs the doc to exist.
                set_document(
                    _SPEND_COLLECTION,
                    doc_id,
                    {
                        "identity": meter_key,
                        "period": period,
                        "shard": shard,
                        "spentMicroUsd": int(actual_cost_usd * 1_000_000),
                    },
                    merge=True,
                )
        except Exception:
            # Losing a record is a metering gap, never a reason to fail a turn
            # the model already answered. Ring 0's quota is still underneath.
            logger.warning("budget.record_failed identity=%s", request.identity_value, exc_info=True)
            return

        # Invalidate the cached total so the next consult sees this spend.
        self._total_cache.pop((meter_key, period), None)

    # --- Internals -----------------------------------------------------------

    def _billing_key(self, identity_value: str) -> str:
        """The key spend is METERED under — always the payer, never the caller.

        `consult` already resolved the CAP through the owning teacher, but the
        running total was read and written under the raw ``identity_value``. For
        a student that is their group code, so a teacher with three classes got
        three independent buckets each measured against their whole monthly cap,
        and their own co-pilot turns a fourth. The ceiling was silently N times
        what anyone configured — the exact failure the group -> owner indirection
        exists to prevent, and what the design specifies as
        ``teacher_spend/{uid}/periods/{YYYY-MM}``.

        Falls back to the raw value when no payer resolves, so that read and
        write always agree on one key. An orphan is uncapped either way
        (``_cap_for`` returns ``None``), so nothing reads what this records.
        """
        uid = self._paying_uid(identity_value)
        return f"teacher:{uid}" if uid else identity_value

    def _paying_uid(self, identity_value: str) -> str | None:
        """Normalise an ``identity_value`` to the uid that pays for it.

        ``User.billing_key`` hands us one of two shapes, and this is where the
        second becomes the first:

          * ``teacher:{uid}`` — already the payer.
          * anything else — an anonymous-group code, which resolves
            group -> class -> owning teacher. This is the step that makes one
            teacher's cap cover the thirty students holding their join code.

        ``None`` means "no payer we can identify", which reads as uncapped here
        (the ADMISSION gate in `auth/spend_authority.py` has already decided
        whether the turn may happen at all; this layer only meters).
        """
        if identity_value.startswith("teacher:"):
            return identity_value.split(":", 1)[1] or None

        # Memoised: this walk is now on both the consult and the record path, and
        # a group's owner changes approximately never. The TTL is the bound on a
        # re-parented class reaching the meter.
        import time

        cached = self._payer_cache.get(identity_value)
        if cached is not None and cached[1] > time.monotonic():
            return cached[0]

        try:
            from db.firestore import get_document

            group_doc = get_document("anon_groups", identity_value) or {}
            class_id = group_doc.get("classId")
            if not class_id:
                self._payer_cache[identity_value] = (None, time.monotonic() + _PAYER_CACHE_SECONDS)
                return None
            class_doc = get_document("classes", str(class_id)) or {}
            owner = str(class_doc.get("ownerUid") or "") or None
        except Exception:
            logger.warning("budget.payer_lookup_failed identity=%s", identity_value, exc_info=True)
            return None

        self._payer_cache[identity_value] = (owner, time.monotonic() + _PAYER_CACHE_SECONDS)
        return owner

    def _cap_for(self, identity_value: str) -> float | None:
        """The monthly cap for whoever pays for ``identity_value``.

        Reads the register row by uid — the same reverse lookup
        ``auth/spend_authority.py`` does, and cached there.
        """
        uid = self._paying_uid(identity_value)
        if not uid:
            return None
        try:
            from db.teacher_access import grant_for_uid

            grant = grant_for_uid(uid)
        except Exception:
            logger.warning("budget.cap_lookup_failed identity=%s", identity_value, exc_info=True)
            return None
        if grant is None:
            return None
        # `None` here means "do not enforce a per-teacher cap", and ONLY the
        # explicit UNCAPPED sentinel earns it. A 0 cap is a real cap of zero —
        # spend suspended without revoking the grant — and must block, not pass.
        return None if grant.is_uncapped else grant.monthly_cap_usd

    def _read_total(self, identity_value: str, period: str) -> float:
        """Sum the shards for this identity+period, through a short-lived cache."""
        import time

        key = (identity_value, period)
        cached = self._total_cache.get(key)
        if cached is not None and cached[1] > time.monotonic():
            return cached[0]

        try:
            from db.firestore import query_documents

            docs = query_documents(
                _SPEND_COLLECTION,
                filters=[("identity", "==", identity_value), ("period", "==", period)],
                limit=SHARD_COUNT,
            )
            total = sum(float(d.get("spentMicroUsd", 0)) for d in docs) / 1_000_000
        except Exception:
            # A read failure must not silently read as "nothing spent" forever;
            # returning 0.0 allows the turn (the turn is not the risk — Ring 0
            # is under it) but the WARN makes the gap visible.
            logger.warning("budget.total_read_failed identity=%s", identity_value, exc_info=True)
            return 0.0

        self._total_cache[key] = (total, time.monotonic() + _TOTAL_CACHE_SECONDS)
        return total


def register_default_enforcer() -> None:
    """Register the Firestore enforcer process-wide. Called once at startup.

    Idempotent-ish: registering twice replaces the previous instance, which is
    the documented behaviour of ``register_budget_enforcer``.
    """
    from budget.enforcer import register_budget_enforcer

    register_budget_enforcer(FirestoreBudgetEnforcer())
    logger.info("budget: FirestoreBudgetEnforcer registered")


__all__ = ["SHARD_COUNT", "SOFT_THRESHOLD", "FirestoreBudgetEnforcer", "register_default_enforcer"]


def read_period_spend_usd(uid: str, *, now: datetime | None = None) -> float | None:
    """Spend so far this period for one PAYING teacher, in USD.

    For the delegated-admin panel (1.1.76), which shows each cap next to the
    spend it bounds. A register listing caps without usage makes you set numbers
    blind, which is exactly how the register arrived at "uncapped" on
    2026-08-12 and revisited it an hour later.

    Reads the same sharded counters the enforcer meters into, under the same
    ``teacher:{uid}`` payer key — so the number shown is the number the cap is
    actually compared against, not a parallel estimate that can disagree with it.

    Returns ``None`` when the total cannot be read. That is deliberately NOT
    0.0: "this teacher has spent nothing" and "Firestore did not answer" are
    different facts, and the reassuring one must not be what a broken read
    produces. The caller renders the difference.
    """
    if not uid:
        return None
    period = _period_key(now)
    try:
        from db.firestore import query_documents

        docs = query_documents(
            _SPEND_COLLECTION,
            filters=[("identity", "==", f"teacher:{uid}"), ("period", "==", period)],
            limit=SHARD_COUNT,
        )
    except Exception:
        logger.warning("budget.period_spend_read_failed uid=%s", uid, exc_info=True)
        return None
    return sum(float(d.get("spentMicroUsd", 0)) for d in docs) / 1_000_000
