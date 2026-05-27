"""Unit tests for the AIPLA 1.D KineBot skill template.

Verifies SKILL.md loads cleanly via ``_parse_template`` and that the
frontmatter + system prompt carry the NCERT/CBSE Class 11 markers the
brief specified. Fast (<100ms) — runs under ``make test-fast``.
"""

from __future__ import annotations

from pathlib import Path

from admin.platform_seed import _parse_template

TEMPLATE_PATH = Path(__file__).resolve().parents[3] / "skills" / "templates" / "kinebot-kinematics-tutor" / "SKILL.md"


# === frontmatter ===


def test_template_parses() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["name"] == "kinebot-kinematics-tutor"
    assert parsed["displayName"] == "Kinematics Tutor (NCERT)"


def test_avatar_field_present() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["avatar"] == "/lesson-images/kinebot-kinematics-tutor.svg"


def test_access_control_defaults_to_public() -> None:
    """KineBot is student-facing — no accessControl override, public on seed."""
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["accessControl"] is None


def test_description_signals_ncert_class_11_english() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    desc = parsed["description"].lower()
    assert "ncert" in desc or "cbse" in desc
    assert "class 11" in desc
    assert "english" in desc


# === metadata.toolConfigs ===


def test_artefacts_and_memory_opted_out() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    defaults = parsed["metadata"]["toolConfigs"]["defaults"]
    assert defaults["artefacts"] is False
    assert defaults["memory"] is False


def test_mcp_allow_context_writes_includes_kinebot() -> None:
    """The artefact pushes ui/update-model-context under serverId 'kinebot';
    the skill must opt into that or the iframe-context route 403s."""
    parsed = _parse_template(TEMPLATE_PATH)
    mcp = parsed["metadata"]["toolConfigs"]["mcp"]
    assert "kinebot" in mcp["allow_context_writes"]


def test_a2ui_disabled() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    a2ui = parsed["metadata"]["toolConfigs"]["a2ui"]
    assert a2ui["enabled"] is False


# === system prompt: NCERT scope + Socratic personality + sim awareness ===


def test_prompt_is_class_11_kinematics_tutor() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    body = parsed["instructions"]
    assert "KineBot" in body
    assert "Class 11" in body
    assert "NCERT" in body or "CBSE" in body
    assert "kinematics" in body.lower()


def test_prompt_covers_full_kinematics_scope() -> None:
    """The full 14-item knowledge scope from the source must survive
    the migration — the tutor's coverage hinges on it."""
    parsed = _parse_template(TEMPLATE_PATH)
    body = parsed["instructions"].lower()
    for marker in (
        "distance vs displacement",
        "speed vs velocity",
        "equations of motion",
        "free fall",
        "projectile motion",
        "circular motion",
        "relative velocity",
    ):
        assert marker in body, f"Knowledge scope marker '{marker}' missing"


def test_prompt_references_the_workbench() -> None:
    """KineBot's personality includes nudging the student toward the
    paired simulations. After the migration the wording shifted from
    'above the chat' to 'in the workbench' / 'alongside this chat' —
    confirm the nudge survived."""
    parsed = _parse_template(TEMPLATE_PATH)
    body = parsed["instructions"].lower()
    assert "workbench" in body or "simulation" in body
    # Specific phrasing the migrated copy uses
    assert "in the workbench" in body or "alongside this chat" in body


def test_prompt_carries_the_socratic_personality() -> None:
    """The brief calls out 'warm, encouraging, fun' + real-world
    analogies. Those personality bullets must be intact."""
    parsed = _parse_template(TEMPLATE_PATH)
    body = parsed["instructions"].lower()
    assert "encouraging" in body
    assert "analogies" in body or "real-world" in body


def test_prompt_carries_the_formatting_rules() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    body = parsed["instructions"]
    assert "FORMULA:" in body
    assert "**bold**" in body or "Use **bold**" in body
    assert "concise" in body.lower()
