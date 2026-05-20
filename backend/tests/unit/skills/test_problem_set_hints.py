"""Unit tests for the AIPLA v0.1 problem-set-hints skill template.

Verifies SKILL.md loads cleanly via the ADK skill loader and that the
system prompt enforces the five scaffolding principles + the
no-full-solution anti-pattern. Does NOT call Gemini — that's M4's smoke
test. This file is fast (<100ms) and runs in `make test-fast`.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from google.adk.skills import load_skill_from_dir

SKILL_DIR = Path(__file__).resolve().parents[3] / "skills" / "templates" / "problem-set-hints"


@pytest.fixture(scope="module")
def skill():
    """Load the skill once per test module — load_skill_from_dir reads the YAML + body."""
    assert SKILL_DIR.exists(), f"Expected skill template at {SKILL_DIR}"
    return load_skill_from_dir(str(SKILL_DIR))


# === frontmatter ===


def test_skill_name(skill):
    assert skill.frontmatter.name == "problem-set-hints"


def test_skill_uses_gemini_3_5_flash(skill):
    """Resolved Decision 1 (jutland-demo.md): default model is gemini-3.5-flash on Vertex AI global."""
    assert skill.frontmatter.metadata["model"] == "gemini-3.5-flash"


def test_skill_aipla_author(skill):
    """AIPLA-authored skill, not template-inherited."""
    assert skill.frontmatter.metadata["author"] == "aipla"


def test_skill_has_no_tools_in_v01(skill):
    """v0.1 ships tool-less per design doc Backend Changes — RAG / code-exec land in v1."""
    tools = skill.frontmatter.metadata.get("tools", [])
    assert tools == [], f"Expected zero tools in v0.1, got {tools}"


def test_skill_v01_version(skill):
    assert skill.frontmatter.metadata["version"] == "0.1.0"


# === system prompt: five scaffolding principles ===


@pytest.mark.parametrize(
    "principle_marker",
    [
        "never give the final numerical answer",  # no-solution rule
        "decompose on request, not on greeting",  # greeting-aware (added 2026-05-20)
        "decompose into\n   3-5 sub-steps",  # decomposition on real help request
        "ask what the student has already tried",  # ask before reveal
        "match the student's language",  # Danish-aware
        "cite the seeded problem",  # citation
    ],
)
def test_system_prompt_embeds_principle(skill, principle_marker):
    """Every scaffolding principle from design doc Backend Changes is in the instructions.

    History:
    - 2026-05-20: added greeting-aware + A2UI-forbidden rules after the first
      deployed chat overshared on a 'hi' input + emitted A2UI surfaces.
    - 2026-05-21: A2UI-forbidden prompt rule deleted; now opt-out at the
      framework level via `toolConfigs.a2ui.enabled: false`. See
      upstream-feedback #22 resolution + test_create_agent.py
      test_create_agent_omits_a2ui_toolset_when_opted_out."""
    instructions = skill.instructions.lower()
    assert principle_marker.lower() in instructions, (
        f"Scaffolding principle marker '{principle_marker}' missing from system prompt."
    )


# === seeded problem: AR's Danish stx projectile motion ===


def test_seeded_problem_is_danish_projectile_motion(skill):
    """The v0.1 seed (Resolved Decision 2 fallback) is AR's projectile-motion problem."""
    text = skill.instructions
    # Danish-language signal — both 'kastes' (thrown) and 'starthastighed' (initial speed)
    assert "kastes" in text.lower(), "Expected Danish 'kastes' in seeded problem"
    assert "starthastighed" in text.lower(), "Expected Danish 'starthastighed' in seeded problem"


def test_seeded_problem_carries_specific_givens(skill):
    """The seeded problem must carry concrete numbers so the tutor can cite them, not invent."""
    text = skill.instructions
    # Initial speed of 15 m/s, angle of 40 degrees — anchors the citation rule (#5)
    assert "15 m/s" in text, "Expected initial-speed 15 m/s in seeded problem"
    assert "40°" in text or "40 °" in text, "Expected launch angle 40° in seeded problem"
    # SI units for g
    assert "9,82 m/s²" in text or "9.82 m/s²" in text, "Expected g = 9,82 m/s² in seeded problem"


def test_seeded_problem_surfaces_ar_misconception(skill):
    """AR's domain insight (sources/aswin-trials/prompt-aswin.txt): students struggle with
    independence of horizontal and vertical motion. The prompt must name this concept."""
    text = skill.instructions.lower()
    assert "independence" in text, (
        "Expected AR's documented misconception (independence of horizontal "
        "and vertical motion) named in the system prompt."
    )


# === scaffold rubric: 5 internal markers ===


@pytest.mark.parametrize(
    "marker_name",
    [
        "decomposition marker",
        "ask-before-reveal marker",
        "concept marker",
        "encourage-own-calculation marker",
        "misconception-aware marker",
    ],
)
def test_scaffold_rubric_documents_marker(skill, marker_name):
    """The internal rubric (5 markers; smoke test in M4 asserts ≥ 3 present per response)
    must be documented in the system prompt so the model knows what shape to produce."""
    assert marker_name in skill.instructions, (
        f"Scaffold rubric marker '{marker_name}' missing — M4 smoke test asserts ≥ 3 of "
        "5 markers present per response, so the model must see them in the prompt."
    )


# === anti-patterns: explicit no-go list ===


@pytest.mark.parametrize(
    "anti_pattern_phrase",
    [
        "compute a final number",
        "provide a full worked solution",
        "the answer is",
    ],
)
def test_system_prompt_lists_anti_pattern(skill, anti_pattern_phrase):
    """The system prompt must list anti-patterns explicitly — telling the model what NOT
    to do is more reliable than only telling it what to do."""
    assert anti_pattern_phrase.lower() in skill.instructions.lower(), (
        f"Anti-pattern '{anti_pattern_phrase}' must be explicitly named in system prompt."
    )
