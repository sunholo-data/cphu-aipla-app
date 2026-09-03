"""Programme-wide DAILY budget (PROGADMIN-1 M3 — 1.1.76).

A second knob, one layer down from the immutable GCP ceiling:

    GCP Vertex quota          immutable from the app   ops-only, scripts/spend-ceiling.sh
       └─ programme daily budget   this module          NEW
            └─ per-teacher monthly cap   ACCESS-1 M3    already shipped

It fills a real gap rather than duplicating either neighbour. Today's caps are
**per teacher, per month**; nothing answers *"what did the whole programme spend
today?"* or stops a bad Tuesday across every class at once — which is exactly the
shape of the risk a shared research budget carries.

**Why not expose the GCP quota itself.** The Vertex consumer quota override
(``scripts/spend-ceiling.sh``) is Ring 0 *precisely because the application
cannot change it*. Putting it behind an in-product setting would need
``serviceusage.serviceUsageAdmin`` on the runtime SA, after which the app can
raise its own ceiling and Ring 0 becomes an application-level control with a
broader IAM surface. A ceiling the app can lift is not a ceiling.

TWO DELIBERATE DIVERGENCES FROM THE DESIGN DOC, both recorded in the sprint doc:

1. **USD, not tokens.** The doc specifies ``dailyTokenBudget`` in input tokens.
   Every counter this enforcer owns is denominated in micro-USD, and the
   question the knob answers ("what did the programme spend today?") is asked in
   money. Metering tokens would mean a second, parallel counter in a second unit
   that can disagree with the first. So: USD, on the mechanism that already
   exists.

2. **The ceiling is env-configured, not read live from the quota.** The doc
   wants the UI to refuse any value above the deployed Vertex quota. Reading
   that live needs ``serviceusage`` access on the runtime SA — a new IAM grant,
   and the neighbouring argument above is about not widening exactly this
   surface. ``PROGRAMME_MAX_DAILY_BUDGET_USD`` is set by ops alongside the quota
   instead. It bounds the knob without the app learning to read its own ceiling.

**Unset is the honest default.** The per-teacher caps and Ring 0 already bound
things, and inventing a number before ``class_spend`` has a month of pilot data
would be a guess wearing a suit. No document ⇒ no enforcement.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)

_COLLECTION = "programme_budget"

#: One document per environment. Firestore is per-project, so the environment is
#: already implied — but naming it makes an exported document self-describing.
_DOC_ID = "current"

#: `warn` first, always. A programme-wide block is a very large blast radius for
#: a knob someone is still calibrating, and warn-only for the first month tells
#: you where the real numbers are without risking a class mid-lesson.
ACTION_WARN = "warn"
ACTION_BLOCK = "block"
VALID_ACTIONS = frozenset({ACTION_WARN, ACTION_BLOCK})

#: Absolute ceiling on the knob, USD/day. Ops sets this alongside the Vertex
#: quota. The default is deliberately generous relative to a realistic month
#: (~$2,700/mo project ceiling) — it exists to catch a fat-fingered 100x, not to
#: be the operative bound.
DEFAULT_MAX_DAILY_BUDGET_USD = 500.0


def max_daily_budget_usd() -> float:
    """The ceiling a programme budget may not exceed. Unparseable ⇒ the default.

    Never returns "no ceiling": setting a number ABOVE the real ceiling would
    read as raising it while doing nothing, which is the worst kind of control.
    """
    raw = os.environ.get("PROGRAMME_MAX_DAILY_BUDGET_USD", "").strip()
    if not raw:
        return DEFAULT_MAX_DAILY_BUDGET_USD
    try:
        value = float(raw)
    except ValueError:
        logger.warning("programme_budget: unparseable PROGRAMME_MAX_DAILY_BUDGET_USD=%r", raw)
        return DEFAULT_MAX_DAILY_BUDGET_USD
    return value if value > 0 else DEFAULT_MAX_DAILY_BUDGET_USD


@dataclass(frozen=True)
class ProgrammeBudget:
    """The configured programme-wide daily budget."""

    daily_budget_usd: float
    action: str = ACTION_WARN
    updated_by: str = ""
    updated_at: str = ""

    @property
    def blocks(self) -> bool:
        return self.action == ACTION_BLOCK

    def to_doc(self) -> dict[str, Any]:
        return {
            "dailyBudgetUsd": self.daily_budget_usd,
            "action": self.action,
            "updatedBy": self.updated_by,
            "updatedAt": self.updated_at,
        }

    @classmethod
    def from_doc(cls, doc: dict[str, Any]) -> ProgrammeBudget | None:
        raw = doc.get("dailyBudgetUsd")
        if raw is None:
            return None
        try:
            value = float(raw)
        except (TypeError, ValueError):
            logger.warning("programme_budget: unparseable dailyBudgetUsd=%r; treating as unset", raw)
            return None
        if value <= 0:
            # A zero/negative programme budget would block the entire programme
            # on the first turn of the day. That is never what someone means by
            # typing it, so it reads as unset rather than as a total shutdown.
            logger.warning("programme_budget: dailyBudgetUsd=%r is not a budget; treating as unset", raw)
            return None
        action = str(doc.get("action") or ACTION_WARN)
        return cls(
            daily_budget_usd=value,
            action=action if action in VALID_ACTIONS else ACTION_WARN,
            updated_by=str(doc.get("updatedBy") or ""),
            updated_at=str(doc.get("updatedAt") or ""),
        )


def get_programme_budget() -> ProgrammeBudget | None:
    """The configured budget, or ``None`` when none is set.

    Also returns ``None`` when Firestore cannot be read. That direction is
    deliberate for THIS control and the opposite of the per-teacher gate's:
    an unreadable programme budget must not take every class down at once, and
    Ring 0 plus the per-teacher caps are both still underneath it.
    """
    try:
        from db.firestore import get_document

        doc = get_document(_COLLECTION, _DOC_ID)
    except Exception:
        logger.warning("programme_budget: read failed; treating as unset", exc_info=True)
        return None
    if not doc:
        return None
    return ProgrammeBudget.from_doc(doc)


def set_programme_budget(
    *, daily_budget_usd: float, action: str = ACTION_WARN, updated_by: str = ""
) -> ProgrammeBudget:
    """Write the budget. Raises ``ValueError`` on anything out of bounds."""
    if daily_budget_usd <= 0:
        raise ValueError("daily_budget_usd must be positive; to remove the budget, clear it")
    ceiling = max_daily_budget_usd()
    if daily_budget_usd > ceiling:
        raise ValueError(
            f"${daily_budget_usd:.2f}/day exceeds the configured ceiling of ${ceiling:.2f}/day. "
            "A budget above the ceiling it sits under would read as raising that ceiling while doing nothing."
        )
    if action not in VALID_ACTIONS:
        raise ValueError(f"action must be one of {sorted(VALID_ACTIONS)}; got {action!r}")

    from db.firestore import set_document

    budget = ProgrammeBudget(
        daily_budget_usd=float(daily_budget_usd),
        action=action,
        updated_by=updated_by,
        updated_at=datetime.now(UTC).isoformat(),
    )
    set_document(_COLLECTION, _DOC_ID, budget.to_doc(), merge=False)
    logger.info(
        "programme_budget.set daily=%.2f action=%s by=%s", budget.daily_budget_usd, budget.action, updated_by or "?"
    )
    return budget


def clear_programme_budget(*, updated_by: str = "") -> None:
    """Remove the budget entirely — back to the honest default of unset."""
    from db.firestore import set_document

    set_document(
        _COLLECTION, _DOC_ID, {"updatedBy": updated_by, "updatedAt": datetime.now(UTC).isoformat()}, merge=False
    )
    logger.info("programme_budget.cleared by=%s", updated_by or "?")
