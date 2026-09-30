"""Earned praise only — the house-style praise preamble (BENCH-2, JB 2026-09-29).

*"Mikkel was too sycophantic."* The benchmark showed it was tone, not agreement:
0 of 112 tutors went along with a planted wrong claim, but stock praise opened
nearly every dialogue on flash-lite whatever the approach. These tests guard the
instruction and its wiring; the benchmark's tone probe is how compliance is measured.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from adk.praise_style import _load_preamble, build_praise_block

_BACKEND = Path(__file__).resolve().parents[2]
_PREAMBLE = _BACKEND / "skills" / "preambles" / "praise.md"
_AGENT = _BACKEND / "adk" / "agent.py"
_PREVIEW = _BACKEND / "analytics" / "tutor_preview.py"


@pytest.fixture(scope="module")
def preamble_text() -> str:
    assert _PREAMBLE.is_file(), f"praise preamble not found at {_PREAMBLE}"
    return _PREAMBLE.read_text(encoding="utf-8")


def test_forbids_stock_openers_including_the_observed_one(preamble_text: str) -> None:
    """The benchmark's actual offender, verbatim, so the rule is concrete in the
    language students meet it in — and 'any language' so it is not Danish-only."""
    assert "No stock openers" in preamble_text
    assert "Det er et rigtig godt spørgsmål" in preamble_text
    assert "any language" in preamble_text


def test_forbids_praising_a_wrong_answer(preamble_text: str) -> None:
    assert "Never praise a wrong or empty answer" in preamble_text


def test_keeps_warmth_and_confirmation(preamble_text: str) -> None:
    """The failure mode of an anti-praise rule is a cold tutor, or one that
    will not say 'yes, that is right' when asked. Both are stated as allowed."""
    lowered = preamble_text.lower()
    assert "warmth is not praise" in lowered
    assert "does not stop you confirming a correct result" in lowered


def test_block_is_appendable_and_separated() -> None:
    block = build_praise_block()
    assert block.startswith("\n\n")
    assert block.strip() == _load_preamble()


def test_wired_unconditionally_into_every_agent() -> None:
    """Like the notation block: no skill flag, so the next tutor cannot miss it."""
    src = _AGENT.read_text(encoding="utf-8")
    assert "from adk.praise_style import build_praise_block" in src
    assert "+ build_praise_block()" in src
    # Adjacent to the notation block, not behind a condition.
    notation = src.index("+ build_math_notation_block()")
    praise = src.index("+ build_praise_block()")
    between = src[notation:praise]
    assert " if " not in between.replace("# ", "#"), "the praise block must not be conditional"


def test_preview_carries_the_house_style() -> None:
    """A preview (and the BENCH benchmark, which composes through it) must show the
    tutor a student meets — house style included — or the tone rule is untestable."""
    src = _PREVIEW.read_text(encoding="utf-8")
    assert "build_praise_block()" in src
    assert "build_math_notation_block()" in src


def test_missing_file_degrades_to_empty(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """A lost preamble must never take every agent build down (Axiom 5)."""
    import adk.praise_style as ps

    monkeypatch.setattr(ps, "_PREAMBLE_PATH", tmp_path / "missing.md")
    ps._load_preamble.cache_clear()
    try:
        assert ps.build_praise_block() == ""
    finally:
        monkeypatch.undo()
        ps._load_preamble.cache_clear()
