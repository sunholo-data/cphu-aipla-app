"""The spend gate prices thinking tokens (2026-10-13).

Gemini reports thinking separately (thoughts_token_count) and bills it as output.
Pricing only candidates_token_count let a thinking skill spend past its cap unseen.
"""

from __future__ import annotations

from types import SimpleNamespace

from budget.callback import _extract_actual_cost
from observability.llm_metrics import estimate_cost


def _resp(prompt: int, out: int, thoughts: int | None) -> SimpleNamespace:
    return SimpleNamespace(
        usage_metadata=SimpleNamespace(
            prompt_token_count=prompt, candidates_token_count=out, thoughts_token_count=thoughts
        )
    )


def test_thinking_tokens_are_priced_as_output():
    model = "gemini-3.8-flash"
    assert _extract_actual_cost(_resp(10_000, 2_000, 30_000), model) == estimate_cost(model, 10_000, 32_000)


def test_a_call_without_thinking_costs_what_it_did_before():
    model = "gemini-3.5-flash-lite"
    assert _extract_actual_cost(_resp(1_000, 200, None), model) == estimate_cost(model, 1_000, 200)
