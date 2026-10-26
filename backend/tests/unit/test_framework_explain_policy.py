"""1.1.129 M0, per approach — the explain policy lives in the framework.

M, 2026-10-26: "explain on second ask — isn't that teaching approach specific?"
So instead of a platform-wide rule, each framework may declare ``explainPolicy``
and the instruction generator renders it into that approach's own instruction.

Pinned here:

1. each value renders its block into the instruction;
2. an ABSENT policy renders byte-identically to the instruction without the
   block — the passthrough guarantee — for every published framework and for a
   custom approach;
3. every published framework declares a value, and the block sits after the
   moves and before the register;
4. the prose is language-neutral (no Danish trigger words baked in).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from db.models.teaching_framework import TeachingFramework
from frameworks.instruction import _EXPLAIN_HEADING, _EXPLAIN_POLICY_TEXT, build_framework_instruction
from frameworks.loader import load_frameworks

_POLICIES = ("hand_back", "second_ask", "first_ask")


def _framework(**kw) -> TeachingFramework:
    return TeachingFramework(
        id="x",
        label="X",
        status="ready_for_review",
        constructs=[{"name": "elicit", "behaviours": ["Ask what they think."], "avoid": ["Answering for them."]}],
        **kw,
    )


@pytest.mark.parametrize("policy", _POLICIES)
def test_the_instruction_contains_the_rendered_policy(policy) -> None:
    text = build_framework_instruction(_framework(explainPolicy=policy))
    assert _EXPLAIN_HEADING in text
    assert _EXPLAIN_POLICY_TEXT[policy] in text
    # Every policy keeps the graded product out of reach.
    assert "never hand over the product" in text


def test_the_policies_say_different_things() -> None:
    assert len({_EXPLAIN_POLICY_TEXT[p] for p in _POLICIES}) == len(_POLICIES)


def test_absent_policy_renders_nothing() -> None:
    text = build_framework_instruction(_framework())
    assert _EXPLAIN_HEADING not in text
    assert text == build_framework_instruction(_framework(explainPolicy=None))


@pytest.mark.parametrize("fw", load_frameworks(), ids=lambda f: f.id)
def test_passthrough_absent_policy_is_byte_identical(fw) -> None:
    """Removing the field yields exactly the instruction minus the block — so a
    framework that declares nothing is what it was before the field existed."""
    with_policy = build_framework_instruction(fw)
    without = build_framework_instruction(fw.model_copy(update={"explain_policy": None}))
    assert _EXPLAIN_HEADING not in without
    block = f"{_EXPLAIN_HEADING}\n"
    start = with_policy.index(block)
    end = with_policy.find("\n\n", start)
    stripped = with_policy[: start - 2] + (with_policy[end:] if end != -1 else "")
    assert stripped == without


def test_custom_approach_passthrough_and_render() -> None:
    base = {
        "id": "c",
        "label": "C",
        "layer": "custom",
        "source": "firestore",
        "status": "ready_for_review",
        "instructionText": "Teach gently.",
    }
    plain = build_framework_instruction(TeachingFramework(**base))
    assert plain and _EXPLAIN_HEADING not in plain
    with_policy = build_framework_instruction(TeachingFramework(**base, explainPolicy="first_ask"))
    assert with_policy.startswith(plain)
    assert _EXPLAIN_POLICY_TEXT["first_ask"] in with_policy


@pytest.mark.parametrize("fw", load_frameworks(), ids=lambda f: f.id)
def test_every_published_framework_declares_a_policy_after_its_moves(fw) -> None:
    assert fw.explain_policy in _POLICIES, fw.id
    text = build_framework_instruction(fw)
    last_construct = [c for c in fw.constructs if c.behaviours][-1]
    tail = last_construct.avoid[-1] if last_construct.avoid else last_construct.behaviours[-1].text
    assert text.index(tail) < text.index(_EXPLAIN_HEADING)


def test_the_proposed_values() -> None:
    """The values proposed for JB/AR review (explain-on-the-second-ask.md)."""
    values = {fw.id: fw.explain_policy for fw in load_frameworks()}
    assert values["esru"] == "hand_back"
    assert values["cer"] == values["cer-components"] == "first_ask"
    for fid in ("poe", "5e", "toulmin", "accountable-talk", "authentic-dialogue"):
        assert values[fid] == "second_ask", fid


def test_prose_is_language_neutral() -> None:
    for text in _EXPLAIN_POLICY_TEXT.values():
        assert not set(text) & set("æøåÆØÅ")
        assert "forklar" not in text.lower()


def test_the_field_refuses_nonsense() -> None:
    with pytest.raises(ValidationError):
        TeachingFramework(id="x", label="X", explainPolicy="always")
