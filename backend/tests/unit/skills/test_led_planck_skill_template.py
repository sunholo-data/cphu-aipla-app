"""Unit tests for the AIPLA 1.C LED Planck skill template.

Verifies SKILL.md loads cleanly via `_parse_template` and that the
frontmatter + system prompt carry the Danish stx-A teaching framing
the brief specified verbatim. Fast (<100ms) — runs under `make
test-fast`.
"""

from __future__ import annotations

from pathlib import Path

from admin.platform_seed import _parse_template

TEMPLATE_PATH = Path(__file__).resolve().parents[3] / "skills" / "templates" / "led-planck-tutor" / "SKILL.md"


# === frontmatter ===


def test_template_parses() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["name"] == "led-planck-tutor"
    assert parsed["displayName"] == "LED og Plancks konstant"


def test_avatar_field_present() -> None:
    """1.B follow-up: lesson cards need an avatar. Avatar is an optional
    top-level field; _parse_template surfaces it."""
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["avatar"] == "/lesson-images/led-planck-tutor.svg"


def test_access_control_defaults_to_public() -> None:
    """LED Planck is a student-facing skill — no accessControl override,
    so _parse_template returns None and the seed coerces to public."""
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["accessControl"] is None


def test_description_signals_danish_stx_a() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    desc = parsed["description"].lower()
    assert "dansk" in desc
    assert "stx" in desc


# === metadata.toolConfigs ===


def test_artefacts_and_memory_opted_out() -> None:
    """The Socratic tutor doesn't need artefacts (no document drops) or
    long-term memory (per-session physics tutoring is the whole skill).
    Both must be explicitly disabled in metadata.toolConfigs.defaults so
    the framework doesn't auto-enable them."""
    parsed = _parse_template(TEMPLATE_PATH)
    meta = parsed["metadata"]
    defaults = meta["toolConfigs"]["defaults"]
    assert defaults["artefacts"] is False
    assert defaults["memory"] is False


def test_mcp_allow_context_writes_includes_led_planck() -> None:
    """The artefact pushes ui/update-model-context notifications under
    serverId 'led-planck'; the skill must opt into receiving them so the
    iframe-context route doesn't 403 the writes."""
    parsed = _parse_template(TEMPLATE_PATH)
    mcp = parsed["metadata"]["toolConfigs"]["mcp"]
    assert "led-planck" in mcp["allow_context_writes"]


def test_a2ui_disabled() -> None:
    """LED Planck doesn't emit A2UI surfaces — opt out at framework level
    rather than only via prompt rule (upstream-feedback #22 pattern)."""
    parsed = _parse_template(TEMPLATE_PATH)
    a2ui = parsed["metadata"]["toolConfigs"]["a2ui"]
    assert a2ui["enabled"] is False


# === system prompt: Danish socratic framing + three teaching phases ===


def test_prompt_is_strictly_socratic() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    body = parsed["instructions"]
    assert "STRENGT SOKRATISK" in body
    assert "Du giver aldrig svar direkte" in body


def test_prompt_carries_three_danish_teaching_phases() -> None:
    """Brief §Teaching phases: every Socratic turn picks one of these
    three phase markers as its scaffold. Missing one would let the
    model drift into a single-mode style."""
    parsed = _parse_template(TEMPLATE_PATH)
    body = parsed["instructions"]
    assert "FØR MÅLING" in body
    assert "UNDER/EFTER MÅLING" in body
    assert "REFLEKSION" in body


def test_prompt_names_the_four_lab_steps() -> None:
    """The artefact emits step-change events with stepNames
    circuit/part1/part2/report. The tutor's prompt must reference the
    Danish-language step labels so it can map back to what the student is
    doing right now."""
    parsed = _parse_template(TEMPLATE_PATH)
    body = parsed["instructions"]
    assert "kredsløbssamling" in body.lower()
    assert "I-U-karakteristik" in body
    assert "spektroskopi" in body.lower()
    assert "rapport" in body.lower()


def test_prompt_short_response_constraint() -> None:
    """Brief §Personality: 'Hold svarene korte: 2-4 afsnit maksimum'.
    The constraint must survive to the model so it doesn't wall-of-
    text the student."""
    parsed = _parse_template(TEMPLATE_PATH)
    body = parsed["instructions"]
    en_dash = chr(0x2013)
    assert f"2{en_dash}4 afsnit" in body or "2-4 afsnit" in body
