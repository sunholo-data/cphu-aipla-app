"""LLM cost tracking via OpenTelemetry metrics.

Records estimated cost per model call as an OTEL counter.
Called from ADK after_agent callbacks or middleware.

Cost estimates are approximate — based on published pricing as of 2026-04.
"""

from __future__ import annotations

from opentelemetry import metrics

_meter = metrics.get_meter("aitana.llm")

cost_counter = _meter.create_counter(
    "llm.cost.total",
    description="Estimated LLM cost in USD",
    unit="USD",
)

token_counter = _meter.create_counter(
    "llm.tokens.total",
    description="Total tokens consumed",
    unit="tokens",
)

# Approximate cost per 1M tokens (input, output) — USD
# Source: published pricing pages as of 2026-04
_COST_PER_1M: dict[str, tuple[float, float]] = {
    # Gemini
    # Gemini 3.x rates confirmed 2026-07-22 (Vertex list price). Substring match:
    # keep the more specific "-lite" key ahead of any "gemini-3.5-flash".
    "gemini-3.5-flash-lite": (0.30, 2.50),  # platform default
    "gemini-3.7-flash": (0.75, 3.75),  # smart tier (intro pricing thru end of 2026)
    "gemini-3.6-flash": (1.50, 7.50),  # superseded smart tier, still pinned by problem-set-hints
    "gemini-2.5-flash": (0.15, 0.60),
    "gemini-2.5-pro": (1.25, 10.00),
    "gemini-2.0-flash": (0.10, 0.40),
    # Claude (via Vertex AI)
    "claude-sonnet": (3.00, 15.00),
    "claude-haiku": (0.25, 1.25),
    "claude-opus": (15.00, 75.00),
    # OpenAI (via LiteLlm)
    # gpt-5.x added 2026-08-12 (ACCESS-1 M3). They were in config/models.yaml
    # but NOT here, so `estimate_cost` returned 0.0 for them — an unpriced model
    # is both uncharged AND ungated, which is a hole rather than a default.
    # Values ported from `analytics/rate_card.py` (EUR/1k -> USD/1M at the same
    # ~1:1 the rest of that table assumes) rather than invented, so the two
    # tables agree on these rows by construction.
    "gpt-5.4": (1.10, 8.80),
    "gpt-5.1": (1.10, 8.80),
    "gpt-5": (1.10, 8.80),
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
}

# KNOWN DIVERGENCE (recorded 2026-08-12, not resolved here):
# this table prices `gemini-2.5-flash` at 0.15/0.60 per 1M, while
# `analytics/rate_card.py` prices it at 0.0003/0.0012 per 1k = 0.30/1.20 per 1M
# — a factor of two. Neither table cites a source for that row, and it is not on
# the student path (the platform default is gemini-3.5-flash-lite, which the two
# tables DO agree on). Left as-is rather than guessed at: picking one silently
# would make the dashboards and the enforcer agree while both being wrong.
# The startup assertion in fast_api_app.py catches MISSING rows; nothing yet
# catches DISAGREEING ones. That is the natural next guard.


class UnpricedModelError(ValueError):
    """Raised when a model has no entry in the pricing table (ACCESS-1 M3).

    Carries the model id so the caller can name it in a log line without
    re-parsing a message.
    """

    def __init__(self, model: str) -> None:
        self.model = model
        super().__init__(
            f"No pricing entry for model {model!r}. Add it to _COST_PER_1M — an "
            "unpriced model would otherwise be both uncharged and ungated."
        )


def estimate_cost(model: str, input_tokens: int, output_tokens: int, *, strict: bool = False) -> float:
    """Estimate cost in USD for a model call.

    ``strict=False`` (the default, and every pre-ACCESS-1 caller) keeps the
    original behaviour: unknown model -> 0.0, so a missing price never blocks a
    metrics emit.

    ``strict=True`` raises ``UnpricedModelError`` instead. The budget enforcer
    uses it, because on a public domain "unknown model" must not mean "free and
    therefore ungated" — that combination is a hole, not a graceful default.
    Fail-closed is the correct direction when the question is money.
    """
    # Normalize model name: strip version suffixes, provider prefixes
    key = model.lower()
    for known in _COST_PER_1M:
        if known in key:
            input_rate, output_rate = _COST_PER_1M[known]
            return (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000
    if strict:
        raise UnpricedModelError(model)
    return 0.0


def is_priced(model: str) -> bool:
    """Whether ``model`` has a pricing entry. Used by the startup consistency
    assertion so an unpriced model is caught at boot, not at bill time."""
    key = model.lower()
    return any(known in key for known in _COST_PER_1M)


def record_llm_cost(model: str, input_tokens: int, output_tokens: int) -> None:
    """Record LLM cost and token metrics. Call from after_agent callback."""
    cost = estimate_cost(model, input_tokens, output_tokens)
    attrs = {"model": model}
    cost_counter.add(cost, attrs)
    token_counter.add(input_tokens + output_tokens, attrs)
