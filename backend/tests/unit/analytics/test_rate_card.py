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


def test_cost_math() -> None:
    # 10k in + 5k out on claude-sonnet-4-6 (0.0027 / 0.0135 per 1k)
    expected = (10000 / 1000) * 0.0027 + (5000 / 1000) * 0.0135
    assert cost_eur("claude-sonnet-4-6", 10_000, 5_000) == expected


def test_negative_and_missing_tokens_treated_as_zero() -> None:
    assert cost_eur("gemini-2.5-flash", -5, 0) == 0.0
