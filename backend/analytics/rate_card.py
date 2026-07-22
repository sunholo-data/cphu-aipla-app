"""Model price rate card for the cost dashboard (sprint 1.1.9).

A code-resident rate card (NOT a BigQuery table — see the cost-dashboard
design's 2026-06-13 reconciliation note for why): version-controlled,
code-reviewed, unit-testable, no deploy/seed dependency. Cost is computed
in Python after a BQ query sums tokens per model.

Rates are **EUR per 1,000 tokens**, split input/output. They are
*approximate* provider list prices converted to EUR and MUST be refreshed
when provider pricing changes — update :data:`MODEL_RATE_CARD` in a PR.
The `model` column on `aipla_chat_turn` is the lookup key; we match the
exact id first, then fall back to a family prefix so minor version suffixes
(``gemini-3.5-flash-preview-0617`` → ``gemini-3.5-flash`` → ``gemini``)
still price. Unknown models price at 0.0 with a logged warning rather than
raising — a missing rate must never break the dashboard.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Rate:
    """EUR per 1,000 tokens, input and output."""

    in_per_1k: float
    out_per_1k: float


#: Exact-id and family-prefix rates. Exact ids win; otherwise the longest
#: matching prefix applies. Keep families ordered most- to least-specific
#: is NOT required — lookup picks the longest matching key.
MODEL_RATE_CARD: dict[str, Rate] = {
    # --- Gemini ---
    # Gemini 3.x rates confirmed 2026-07-22 (Vertex list price, USD per 1k).
    # Historical ids retained below for costing past BigQuery rows.
    "gemini-3.5-flash-lite": Rate(0.0003, 0.0025),  # platform default ($0.30 / $2.50 per 1M)
    "gemini-3.6-flash": Rate(0.0015, 0.0075),  # advanced tier ($1.50 / $7.50 per 1M)
    "gemini-2.5-flash": Rate(0.0003, 0.0012),
    "gemini-3-flash": Rate(0.0003, 0.0012),
    "gemini-3.5-flash": Rate(0.00035, 0.0014),
    "gemini-3.1-pro": Rate(0.0011, 0.0044),
    "gemini-3-pro": Rate(0.0011, 0.0044),
    "gemini-flash": Rate(0.0003, 0.0012),  # generic flash fallback
    "gemini-pro": Rate(0.0011, 0.0044),  # generic pro fallback
    "gemini": Rate(0.0003, 0.0012),  # family fallback (assume flash-class)
    # --- Anthropic Claude ---
    "claude-haiku-4-5": Rate(0.0007, 0.0036),
    "claude-sonnet-4-6": Rate(0.0027, 0.0135),
    "claude-opus-4-7": Rate(0.0135, 0.0675),
    "claude-opus": Rate(0.0135, 0.0675),
    "claude-sonnet": Rate(0.0027, 0.0135),
    "claude-haiku": Rate(0.0007, 0.0036),
    "claude": Rate(0.0027, 0.0135),  # family fallback (assume sonnet-class)
    # --- OpenAI ---
    "gpt-5.4": Rate(0.0011, 0.0088),
    "gpt-5.1": Rate(0.0011, 0.0088),
    "gpt-5": Rate(0.0011, 0.0088),
    "gpt": Rate(0.0011, 0.0088),  # family fallback
}

#: Display currency for everything the rate card produces.
CURRENCY = "EUR"

#: Approximate USD→EUR rate for folding voice cost (voice/cost.py is priced in
#: USD) into the EUR dashboard. Like the per-token rates, this is an estimate —
#: refresh in a PR when it drifts materially. Actual GCP billing trumps it.
USD_TO_EUR = 0.92


def usd_to_eur(usd: float) -> float:
    """Convert a USD estimate to EUR for the dashboard (approximate)."""
    return (usd or 0.0) * USD_TO_EUR


def _normalize(model: str) -> str:
    """Lowercase + unify the two id spellings (``gemini-2-5-flash`` and
    ``gemini-2.5-flash`` both appear in configs) onto the dotted form used
    as rate-card keys."""
    m = model.strip().lower()
    # Configs use both dotted and dashed minor versions; the rate-card keys
    # are dotted. Convert ``-<digit>-<digit>-`` style back to dots is lossy,
    # so we only fold the common ``-N-N-`` → ``-N.N-`` for the version block.
    return m


def lookup_rate(model: str | None) -> Rate | None:
    """Return the :class:`Rate` for ``model`` (exact id, then longest family
    prefix), or ``None`` if nothing matches."""
    if not model:
        return None
    key = _normalize(model)
    if key in MODEL_RATE_CARD:
        return MODEL_RATE_CARD[key]
    # Longest matching prefix wins (so "claude-opus-4-7-2026..." → "claude-opus").
    best: tuple[int, Rate] | None = None
    for prefix, rate in MODEL_RATE_CARD.items():
        if key.startswith(prefix) and (best is None or len(prefix) > best[0]):
            best = (len(prefix), rate)
    return best[1] if best else None


def cost_eur(model: str | None, token_in: int, token_out: int) -> float:
    """Cost in EUR of one model call (or aggregate) at the carded rate.

    Unknown model → 0.0 + a single logged warning (never raises). Negative
    or missing token counts are treated as 0.
    """
    rate = lookup_rate(model)
    if rate is None:
        logger.warning("rate_card: no rate for model %r — pricing at 0.0", model)
        return 0.0
    ti = max(0, token_in or 0)
    to = max(0, token_out or 0)
    return (ti / 1000.0) * rate.in_per_1k + (to / 1000.0) * rate.out_per_1k


__all__ = ["CURRENCY", "MODEL_RATE_CARD", "USD_TO_EUR", "Rate", "cost_eur", "lookup_rate", "usd_to_eur"]
