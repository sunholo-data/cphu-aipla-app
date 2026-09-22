"""1.1.127 — the OPENING GUIDANCE block reaches the model on the opening turn only.

2026-09-22: the block ("They have NOT yet sent a message. You are speaking
first") sat in every turn's instruction. `bold-kazoo-64` re-greeted twenty
exchanges in, right after compaction; `shy-mouse-65`, whose greet never fired,
got the teacher's greeting in front of the answer to its first question.
"""

from __future__ import annotations

from types import SimpleNamespace

from adk.proactive_greet import (
    GREET_SENTINEL,
    inject_opening_guidance,
    render_opening_guidance_for_turn,
    wrap_opening_guidance_per_turn,
)

GREETING = "Hej med jer - I kan bruge mig til at få hints og til at få feedback på jeres arbejde."
TEMPLATE = f"Greet them with: {GREETING}"
BASE = "You are a physics tutor.\n\n## Math notation\nUse · for multiplication."


def _composed() -> str:
    # The real composition, so the regex is tested against the real block.
    return inject_opening_guidance(BASE, proactive_greet=True, opening_template=TEMPLATE)


def _part(text):
    return SimpleNamespace(text=text)


def _ctx(user_text: str, *, prior: list[tuple[str, str]] = ()):
    events = [SimpleNamespace(author=a, content=SimpleNamespace(parts=[_part(t)])) for a, t in prior]
    return SimpleNamespace(
        user_content=SimpleNamespace(parts=[_part(user_text)]),
        session=SimpleNamespace(events=events),
    )


def test_composed_instruction_carries_the_block():
    assert "OPENING GUIDANCE" in _composed()
    assert GREETING in _composed()


def test_opening_turn_keeps_the_block():
    out = render_opening_guidance_for_turn(_composed(), opening_turn=True, first_student_turn=False)
    assert out == _composed()


def test_later_turn_drops_the_block_and_nothing_else():
    out = render_opening_guidance_for_turn(_composed(), opening_turn=False, first_student_turn=False)
    assert "OPENING GUIDANCE" not in out
    assert "NOT yet sent a message" not in out
    assert GREETING not in out
    assert out.strip() == BASE.strip()


def test_first_student_turn_gets_a_true_block():
    out = render_opening_guidance_for_turn(_composed(), opening_turn=False, first_student_turn=True)
    assert "OPENING GUIDANCE" not in out
    assert "NOT yet sent a message" not in out
    assert "FIRST MESSAGE" in out
    assert "answer what they actually asked" in out
    assert GREETING not in out


def test_instruction_without_a_block_is_untouched():
    for opening, first in [(True, False), (False, True), (False, False)]:
        assert render_opening_guidance_for_turn(BASE, opening_turn=opening, first_student_turn=first) == BASE


async def test_wrapper_greet_turn():
    out = await wrap_opening_guidance_per_turn(_composed())(_ctx(GREET_SENTINEL))
    assert "OPENING GUIDANCE" in out


async def test_wrapper_first_message_without_greet():
    # shy-mouse-65: no [session_start] ever ran; the student asks first.
    out = await wrap_opening_guidance_per_turn(_composed())(_ctx("kan du lave en tegneserie om λ = v·T?"))
    assert "FIRST MESSAGE" in out
    assert "OPENING GUIDANCE" not in out


async def test_wrapper_later_turn_even_after_compaction():
    # bold-kazoo-64: the greeting was compacted out of the PROMPT, but the
    # stored events still show the tutor has spoken.
    prior = [("user", GREET_SENTINEL), ("tutor_agent", GREETING), ("user", "hvad skal vi?"), ("tutor_agent", "…")]
    out = await wrap_opening_guidance_per_turn(_composed())(_ctx("er det fint nok?", prior=prior))
    assert "OPENING GUIDANCE" not in out
    assert "FIRST MESSAGE" not in out


async def test_wrapper_accepts_an_upstream_provider():
    async def upstream(_ctx):
        return _composed()

    out = await wrap_opening_guidance_per_turn(upstream)(_ctx("hej", prior=[("tutor_agent", "Hej!")]))
    assert "OPENING GUIDANCE" not in out
