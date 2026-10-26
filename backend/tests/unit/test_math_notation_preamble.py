r"""The tutor writes maths as maths — no `*`, always units.

Teacher feedback 2026-08-21, two separate items:

  17. *"We do not like asterisks used as multiplication signs."*
  18. *"There should be units and preferably symbols — writing
      'position = 0.2*time' is not acceptable. At minimum, a unit must be
      attached to 0.2."*

`1db461f` fixed the AUTHORING half of 18 (every table and plot label carries its
unit). This is the other half — what the tutor writes in prose, which reaches
every student on every turn rather than only those who look at a plot.

The guidance is centralised in `skills/preambles/math_notation.md` and applied
UNCONDITIONALLY, so a tutor added later cannot silently miss it. These tests
guard the instruction and the wiring; only an eval can prove the model complies.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from adk.math_notation import _load_preamble, build_math_notation_block

_BACKEND = Path(__file__).resolve().parents[2]
_PREAMBLE = _BACKEND / "skills" / "preambles" / "math_notation.md"
_AGENT = _BACKEND / "adk" / "agent.py"

# Every skill whose output a STUDENT reads. The notation block is applied to all
# skills, so this list is about the examples inside each body, not coverage.
_STUDENT_TUTORS = [
    "concept-dialogue",
    "problem-set-hints",
    "kinebot-kinematics-tutor",
    "led-planck-tutor",
]


@pytest.fixture(scope="module")
def preamble_text() -> str:
    assert _PREAMBLE.is_file(), f"math_notation preamble not found at {_PREAMBLE}"
    return _PREAMBLE.read_text(encoding="utf-8")


def test_preamble_forbids_the_asterisk(preamble_text: str) -> None:
    """Item 17, stated as a rule rather than implied by an example."""
    lowered = preamble_text.lower()
    assert "never `*`" in lowered or "never `v*t`" in lowered, (
        "the preamble must forbid `*` explicitly — an example alone is not a rule"
    )
    assert r"\cdot" in preamble_text, "the preamble must name the replacement, not only the prohibition"


def test_preamble_requires_units_on_quantities(preamble_text: str) -> None:
    """Item 18. The teacher's own counter-example is the one to carry."""
    assert "unit" in preamble_text.lower()
    assert "position = 0.2*time" in preamble_text, (
        "keep the teacher's counter-example verbatim — it is what makes the rule concrete"
    )


def test_preamble_names_when_not_to_apply(preamble_text: str) -> None:
    """`1db461f`'s principle: a rule that is wrong some of the time gets
    ignored all of the time. The exceptions must be stated."""
    lowered = preamble_text.lower()
    assert "does not apply" in lowered
    for exception in ("count", "index", "trial number"):
        assert exception in lowered, f"the preamble must name {exception!r} as an exception"


def test_preamble_keeps_the_danish_decimal_comma(preamble_text: str) -> None:
    """Two tutors already carried this rule; centralising it must not lose it."""
    assert "{,}" in preamble_text, "must show the {,} form — a bare comma is typeset as a list separator"


def test_block_is_appendable_and_separated() -> None:
    """Composes onto an existing prompt without running into it."""
    block = build_math_notation_block()
    assert block.startswith("\n\n")
    assert len(block) > 200
    assert "## Mathematical notation" in block


def test_block_degrades_to_empty_when_the_file_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Axiom 5. A lost preamble means "no guidance", never a crash that takes
    every skill's agent build down with it."""
    _load_preamble.cache_clear()
    monkeypatch.setattr("adk.math_notation._PREAMBLE_PATH", Path("/nonexistent/math_notation.md"))
    try:
        assert build_math_notation_block() == ""
    finally:
        _load_preamble.cache_clear()


def test_agent_applies_it_unconditionally() -> None:
    """The wiring, and the reason it has no flag.

    A gated preamble is a second registration site: the next tutor added would
    silently not get it. Asserting the call is unguarded is what makes coverage
    provable rather than assumed.
    """
    source = _AGENT.read_text(encoding="utf-8")
    assert "build_math_notation_block()" in source, "agent.py must apply the notation block"
    call_line = next(
        line for line in source.splitlines() if "build_math_notation_block()" in line and "import" not in line
    )
    assert "if " not in call_line, f"the notation block must not be conditional: {call_line.strip()!r}"


@pytest.mark.parametrize("skill_name", _STUDENT_TUTORS)
def test_no_tutor_body_demonstrates_asterisk_multiplication(skill_name: str) -> None:
    """An example outranks a rule. A worked example written `v*t` inside a
    SKILL.md would teach exactly what the preamble forbids, and the model would
    follow the example.
    """
    import re

    body = (_BACKEND / "skills" / "templates" / skill_name / "SKILL.md").read_text(encoding="utf-8")
    offenders = [
        line.strip()
        for line in body.splitlines()
        # letter/digit * letter/digit, e.g. "v*t" or "0.2*time" — but not "**bold**"
        if re.search(r"(?<!\*)[A-Za-z0-9)]\*[A-Za-z0-9(]", line)
    ]
    assert not offenders, f"{skill_name} SKILL.md demonstrates `*` as multiplication: {offenders}"


def test_preamble_leaves_sim_readings_in_plain_text(preamble_text: str) -> None:
    """09-29 meeting: "the tutor displays simulation variables as LaTeX". Prod,
    25-30 Sep: 78 of 205 tutor turns in sim sessions typeset a slider or reading
    ("$2000 \\text{ W}$" for "Effekt — 2000 W"), and two put `^` inside `\\text{}`,
    which KaTeX renders as red source. Sim values are written as the sim shows them."""
    lowered = preamble_text.lower()
    assert "simulation's own controls and readings are not mathematics" in lowered
    assert "plain text" in lowered
    flat = " ".join(preamble_text.split())
    assert "outside `\\text{}`, never inside it" in flat


def test_preamble_forbids_maths_in_backticks_and_text_mode_degrees(preamble_text: str) -> None:
    """1.1.147 M0, prod 2026-10-05: 15 of 234 tutor turns wrapped maths in
    backticks (`` `$E = P \\cdot t$` ``) — a code span, so the student read the
    source in monospace — and 3 put `^\\circ` or `\\celsius` inside `\\text{}`,
    which KaTeX rejects. Students asked the tutor what `cdot` meant; it explained
    the markup. The renderer now repairs both; these lines lower the rate."""
    flat = " ".join(preamble_text.split())
    assert "never inside backticks or code formatting" in flat
    assert "never `\\(…\\)` or `\\[…\\]`" in flat
    assert "Inside `\\text{…}` write words only; put `^\\circ` outside it." in flat
    assert "\\celsius" in flat
    assert "If a student says the maths looks wrong, rewrite it in plain words" in flat


# --- 1.1.152 M3: when to calculate, equation first, the narrowed sim carve-out ---


def test_preamble_says_when_the_equation_comes_first(preamble_text: str) -> None:
    """F3: the preamble said how to write maths, never when."""
    flat = " ".join(preamble_text.split())
    assert "the equation comes first" in flat
    # An equation must not lose out to a sentence limit it was never meant to hit.
    assert "an equation counts as one sentence" in flat


def test_preamble_requires_the_calculate_tool_for_derived_numbers(preamble_text: str) -> None:
    flat = " ".join(preamble_text.split())
    assert "Calculate with the `calculate` tool, never in your head." in flat
    assert "before you tell a student their number is right or wrong" in flat
    assert "Never state a calculated number the tool did not give you" in flat
    # Rule 1 of the design: the check is not a way of handing over the answer.
    assert "do not give them the correct value" in flat


def test_the_sim_carve_out_is_narrowed_not_removed(preamble_text: str) -> None:
    """A single reading stays plain text (the 09-29 fix); a relationship between readings is maths."""
    flat = " ".join(preamble_text.split())
    assert '"Effekt 2000 W"' in flat
    assert "The moment two readings are related, that relationship is mathematics" in flat
    assert "Typeset only when" not in flat  # the clause that steered sim activities to prose


def test_the_tool_the_preamble_names_is_on_every_agent_it_reaches() -> None:
    """The preamble is unconditional, so the tool it tells the agent to use must be too."""
    source = _AGENT.read_text(encoding="utf-8")
    call = next(line for line in source.splitlines() if "build_calc_tools(" in line and "import" not in line)
    assert "if " not in call, f"calculate must be attached unconditionally: {call.strip()!r}"


def test_a_tutor_and_no_tutor_get_the_same_notation_block(monkeypatch: pytest.MonkeyPatch) -> None:
    """F7: house style changes every prompt equally, so the passthrough guarantee holds.

    One activity with no framework, one with ESRU. The framework text must reach
    only the second, and the notation block must reach both, once and unchanged.
    """
    import asyncio
    from datetime import UTC, datetime
    from unittest.mock import MagicMock

    from adk.agent import create_agent
    from auth.firebase_auth import User
    from db import firestore as fs_module
    from db.models import SkillConfig, SkillMetadata
    from db.models.activity_config import ActivityConfig

    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    skill = SkillConfig(
        name="concept-dialogue",
        description="Test skill.",
        instructions="Teach physics.",
        skillId="concept-dialogue",
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
    )
    user = User(uid="t1", email="teacher@example.dk", domain="example.dk")

    def resolved(framework_id: str | None) -> str:
        cfg = ActivityConfig(
            activityId="act-1",
            classId="c-1",
            teacherUid="t-1",
            frameworkId=framework_id,
            updatedAt=datetime.now(UTC),
        )
        monkeypatch.setattr("adk.teacher_focus.resolve_active_config", lambda *a, **k: cfg)
        monkeypatch.setattr("adk.agent.resolve_active_config", lambda *a, **k: cfg)
        agent = create_agent(skill, user, activity_id="act-1")
        ctx = MagicMock()
        ctx.state = {}
        return asyncio.run(agent.instruction(ctx))

    try:
        plain, tutored = resolved(None), resolved("esru")
    finally:
        fs_module._reset_client_for_testing()
    block = build_math_notation_block()
    assert "Elicit" in tutored and "Elicit" not in plain  # the tutor path really ran
    # The same bytes, once each. (The framework block is composed after it, so
    # the prompts' tails differ by design; the house-style block itself does not.)
    assert plain.count(block) == 1 and tutored.count(block) == 1
    assert "Calculate with the `calculate` tool" in block
