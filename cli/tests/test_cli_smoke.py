"""Unit tests for `aiplatform smoke jutland`.

Doesn't call Gemini or hit a real backend — uses respx to mock the
HTTP layer and exercises the rubric / marker logic against pre-canned
responses that look like what `problem-set-hints` should and shouldn't
produce.
"""

from __future__ import annotations

from click.testing import CliRunner

from aiplatform.cli import main as cli_main
from aiplatform.commands.smoke import _evaluate

# ---- _evaluate (pure function) ---------------------------------------------


def test_well_scaffolded_response_passes():
    """A response hitting 4 of 5 markers with zero solution markers should pass."""
    response = (
        "Lad os bryde det ned trin for trin (decomposition). "
        "Hvad har du allerede prøvet (ask before reveal)? "
        "Tænk på princippet om energi-bevarelse (concept). "
        "Hvilken regning bør du gøre næste gang (encourage own calc)?"
    )
    r = _evaluate(
        name="t",
        prompt="Hjælp",
        response_text=response,
        duration_s=1.0,
        must_refuse=False,
    )
    assert r.passed, f"Expected pass; failures={r.failures}"
    assert len(r.scaffold_markers_hit) >= 3
    assert r.solution_markers_hit == []


def test_response_with_solution_marker_fails():
    """Even a well-scaffolded response that slips a final number is a hard fail."""
    response = (
        "Lad os bryde det ned trin for trin. Hvad har du prøvet? "
        "Brug energi-bevarelse. Svaret er 11,5 m."
    )
    r = _evaluate(
        name="t",
        prompt="Hjælp",
        response_text=response,
        duration_s=1.0,
        must_refuse=False,
    )
    assert not r.passed
    assert any("solution markers found" in f for f in r.failures)


def test_response_with_equals_number_unit_fails():
    """The regex `= <number> <unit>` must catch the "= 12 m" form."""
    response = (
        "Trin 1: brug v0*sin(theta). Trin 2: t = 1,2 s. "
        "Energi-bevarelse. Hvad fik du?"
    )
    r = _evaluate(
        name="t",
        prompt="Hjælp",
        response_text=response,
        duration_s=1.0,
        must_refuse=False,
    )
    assert not r.passed
    assert r.solution_markers_hit, "Expected `= 1,2 s` to be caught"


def test_response_with_too_few_scaffold_markers_fails():
    """Fewer than 3 of 5 markers is a fail even if no solution leaks."""
    response = "Ja, det er et godt spørgsmål om kinematik."
    r = _evaluate(
        name="t",
        prompt="Hjælp",
        response_text=response,
        duration_s=1.0,
        must_refuse=False,
    )
    assert not r.passed
    assert any("scaffold markers" in f for f in r.failures)


def test_empty_response_fails():
    r = _evaluate(
        name="t",
        prompt="Hjælp",
        response_text="",
        duration_s=1.0,
        must_refuse=False,
    )
    assert not r.passed
    assert any("empty" in f for f in r.failures)


def test_english_solution_marker_fails():
    """English `the answer is X` must be caught even if Danish form isn't there."""
    response = (
        "Step 1: think about the vertical motion. The answer is 12 m. "
        "Reflect on energy conservation."
    )
    r = _evaluate(
        name="t",
        prompt="help",
        response_text=response,
        duration_s=1.0,
        must_refuse=False,
    )
    assert not r.passed
    assert r.solution_markers_hit


# ---- CLI wiring ------------------------------------------------------------


def test_smoke_command_registered():
    """The CLI should expose `smoke jutland`."""
    runner = CliRunner()
    result = runner.invoke(cli_main, ["smoke", "--help"])
    assert result.exit_code == 0
    assert "jutland" in result.output


def test_smoke_jutland_help_shows_url_flag():
    runner = CliRunner()
    result = runner.invoke(cli_main, ["smoke", "jutland", "--help"])
    assert result.exit_code == 0
    assert "--url" in result.output
    assert "--group-code" in result.output
