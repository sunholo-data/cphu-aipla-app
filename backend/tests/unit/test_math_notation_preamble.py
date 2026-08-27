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
