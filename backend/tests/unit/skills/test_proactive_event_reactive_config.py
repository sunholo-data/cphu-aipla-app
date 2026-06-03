"""Unit tests for the proactive sim-reactive SkillConfig fields (sprint
PROACTIVE-SIM-REACTIVE M2).

Asserts the four new fields land correctly via the production seed-
pipeline parser (admin.platform_seed._parse_template) for representative
SKILL.md frontmatter shapes — defaults applied when omitted, custom
values respected when set, all four flow through to the SkillConfig
Pydantic model intact.

Fast (<100ms) — no LLM calls, runs under ``make test-fast``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from admin.platform_seed import _parse_template
from db.models import SkillConfig

_BASE_FRONTMATTER = """\
---
name: {name}
displayName: Test Skill
description: A test skill for proactive sim-reactive fields.
instructions: |
  You are a test tutor.
{extra}---

Body content here.
"""


def _write_skill(tmp_path: Path, name: str, extra: str = "") -> Path:
    """Write a minimal SKILL.md under tmp_path/{name}/SKILL.md, returning
    the path. ``extra`` is concatenated into the frontmatter block (already
    YAML-indented for `---` delimiters)."""
    skill_dir = tmp_path / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(_BASE_FRONTMATTER.format(name=name, extra=extra))
    return skill_md


def test_defaults_when_frontmatter_omits_proactive_event_reactive(tmp_path: Path) -> None:
    """A SKILL.md with no proactive sim-reactive fields parses to the
    SkillConfig defaults (flag off; 10s heartbeat; no per-session cap —
    JB did not agree to a numeric cap, 2026-06-03; empty reactive
    template). The 90s session-wide cooldown is the only proactive
    throttle by default."""
    skill_md = _write_skill(tmp_path, "default-skill")
    parsed = _parse_template(skill_md)

    assert parsed["proactiveEventReactive"] is False
    assert parsed["proactiveHeartbeatSeconds"] == 10
    assert parsed["proactiveMaxPerSession"] is None
    assert parsed["reactiveTemplate"] == ""


def test_custom_values_respected_when_frontmatter_provides_all(tmp_path: Path) -> None:
    """Skill author opts in + tunes the thresholds + supplies a reactive
    template. All four fields round-trip through the parser unchanged."""
    extra = (
        "proactiveEventReactive: true\n"
        "proactiveHeartbeatSeconds: 15\n"
        "proactiveMaxPerSession: 3\n"
        "reactiveTemplate: |\n"
        "  Acknowledge what the student just tried. Ask one short question.\n"
    )
    skill_md = _write_skill(tmp_path, "opted-in-skill", extra=extra)
    parsed = _parse_template(skill_md)

    assert parsed["proactiveEventReactive"] is True
    assert parsed["proactiveHeartbeatSeconds"] == 15
    assert parsed["proactiveMaxPerSession"] == 3
    assert "Acknowledge what the student just tried" in parsed["reactiveTemplate"]


def test_skillconfig_pydantic_model_accepts_new_fields() -> None:
    """SkillConfig accepts the four new fields via camelCase aliases (the
    Firestore wire shape) and exposes them via snake_case attributes."""
    cfg = SkillConfig(
        skill_id="s1",
        owner_id="u1",
        owner_email="u@example.com",
        name="test-skill",
        description="d",
        instructions="i",
        proactiveEventReactive=True,
        proactiveHeartbeatSeconds=20,
        proactiveMaxPerSession=4,
        reactiveTemplate="reactive seed",
    )
    assert cfg.proactive_event_reactive is True
    assert cfg.proactive_heartbeat_seconds == 20
    assert cfg.proactive_max_per_session == 4
    assert cfg.reactive_template == "reactive seed"


def test_skillconfig_defaults_match_parser_defaults() -> None:
    """The Pydantic-side defaults must agree with the parser-side
    fallbacks so a SKILL.md with no proactive fields produces the same
    SkillConfig regardless of whether it went through _parse_template
    or was constructed directly. Guards against drift between the two
    seam definitions."""
    cfg = SkillConfig(
        skill_id="s1",
        owner_id="u1",
        owner_email="u@example.com",
        name="test-skill",
        description="d",
        instructions="i",
    )
    assert cfg.proactive_event_reactive is False
    assert cfg.proactive_heartbeat_seconds == 10
    assert cfg.proactive_max_per_session is None
    assert cfg.reactive_template == ""


@pytest.mark.parametrize(
    "skill_name",
    [
        "problem-set-hints",
        "led-planck-tutor",
        "kinebot-kinematics-tutor",
    ],
)
def test_real_skill_templates_instructions_under_10k_limit(skill_name: str) -> None:
    """SkillConfig._validate_instructions caps the body at 10,000 chars
    (Pydantic field_validator). Pushing a template body past this cap
    silently fails the platform_seed update_skill step at re-read
    validation — the WRITE succeeds and the Firestore doc carries the
    new content, but every later list_marketplace / get_skill call
    400s out with a Pydantic ValidationError. This regression cost ~30
    min on 2026-06-03 when QUICK-WINS-V11's ~400-char verbosity block
    + PROACTIVE-SIM-REACTIVE's M6 push to problem-set-hints crossed
    the cap (the body went 10,134 chars; seed reported the skill as
    failed but the write had partially applied).

    This test catches a body-over-limit at template-edit time, BEFORE
    the seed runs. Cheaper than waiting for the Cloud Run logs."""
    template_path = Path(__file__).resolve().parents[3] / "skills" / "templates" / skill_name / "SKILL.md"
    assert template_path.exists()
    parsed = _parse_template(template_path)
    instructions_len = len(parsed["instructions"])
    assert instructions_len <= 10_000, (
        f"{skill_name} SKILL.md instructions body is {instructions_len} chars — "
        "exceeds the 10,000 char limit enforced by SkillConfig._validate_instructions. "
        "Trim the body or raise the limit (last raised never; default since v0.1)."
    )


@pytest.mark.parametrize(
    "skill_name",
    [
        "problem-set-hints",
        "led-planck-tutor",
        "kinebot-kinematics-tutor",
    ],
)
def test_real_skill_templates_carry_reactive_fields(skill_name: str) -> None:
    """M6 follow-up: every tutor skill that has the reactive flag set in
    its SKILL.md must round-trip through the parser with all four fields
    populated. Guards against a typo in the frontmatter silently
    disabling the feature in production."""
    template_path = Path(__file__).resolve().parents[3] / "skills" / "templates" / skill_name / "SKILL.md"
    assert template_path.exists(), f"Expected template at {template_path}"
    parsed = _parse_template(template_path)

    assert parsed["proactiveEventReactive"] is True, f"{skill_name} SKILL.md should opt in to sim-reactive turns"
    assert parsed["proactiveHeartbeatSeconds"] == 10
    # No per-session cap is the post-2026-06-03 default — the 90s
    # cooldown is the only throttle. A skill can still opt in to a
    # hard cap by setting an explicit positive int, but none of the
    # three v1 tutor skills do today.
    assert parsed["proactiveMaxPerSession"] is None
    assert parsed["reactiveTemplate"], (
        f"{skill_name} SKILL.md has proactiveEventReactive=true but reactiveTemplate is empty — "
        "the helper will no-op silently and the tutor will produce ungrounded reactive turns"
    )


@pytest.mark.parametrize(
    "heartbeat_value,max_value",
    [
        (10, 2),  # design-doc defaults
        (5, 1),  # aggressive tuning
        (60, 5),  # relaxed tuning
    ],
)
def test_int_fields_round_trip_for_representative_values(tmp_path: Path, heartbeat_value: int, max_value: int) -> None:
    """The two integer tuning knobs survive parser → SkillConfig for a
    range of representative values. Frontmatter ``int`` values must not
    be coerced into strings or other types along the way."""
    extra = (
        "proactiveEventReactive: true\n"
        f"proactiveHeartbeatSeconds: {heartbeat_value}\n"
        f"proactiveMaxPerSession: {max_value}\n"
    )
    skill_md = _write_skill(tmp_path, f"tuned-{heartbeat_value}-{max_value}", extra=extra)
    parsed = _parse_template(skill_md)

    assert parsed["proactiveHeartbeatSeconds"] == heartbeat_value
    assert parsed["proactiveMaxPerSession"] == max_value
