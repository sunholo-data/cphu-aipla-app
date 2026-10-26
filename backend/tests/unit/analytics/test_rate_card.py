"""Tests for analytics.rate_card — cost math + model lookup (sprint 1.1.9)."""

from __future__ import annotations

from analytics.rate_card import MODEL_RATE_CARD, cost_eur, lookup_rate


def test_exact_model_match() -> None:
    r = lookup_rate("claude-sonnet-4-6")
    assert r == MODEL_RATE_CARD["claude-sonnet-4-6"]


def test_family_prefix_fallback_picks_longest() -> None:
    # A versioned id not in the card resolves to the longest matching prefix.
    r = lookup_rate("claude-opus-4-7-2026-01-01")
    assert r == MODEL_RATE_CARD["claude-opus-4-7"]


def test_unknown_model_prices_zero() -> None:
    assert cost_eur("definitely-not-a-model", 1000, 1000) == 0.0
    assert lookup_rate("definitely-not-a-model") is None


def test_none_model_prices_zero() -> None:
    assert cost_eur(None, 1000, 1000) == 0.0


def test_nothing_to_price_does_not_warn(caplog) -> None:
    """A student's own turn has no model and no tokens. Warning on it buried
    the one warning that matters — a real call priced at zero — under one
    line per student row."""
    with caplog.at_level("WARNING", logger="analytics.rate_card"):
        assert cost_eur(None, 0, 0) == 0.0
    assert caplog.records == []
    with caplog.at_level("WARNING", logger="analytics.rate_card"):
        assert cost_eur(None, 10, 0) == 0.0
    assert len(caplog.records) == 1


def test_cost_math() -> None:
    # 10k in + 5k out on claude-sonnet-4-6 (0.0027 / 0.0135 per 1k)
    expected = (10000 / 1000) * 0.0027 + (5000 / 1000) * 0.0135
    assert cost_eur("claude-sonnet-4-6", 10_000, 5_000) == expected


def test_negative_and_missing_tokens_treated_as_zero() -> None:
    assert cost_eur("gemini-2.5-flash", -5, 0) == 0.0
