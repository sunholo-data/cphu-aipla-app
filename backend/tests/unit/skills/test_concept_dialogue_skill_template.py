"""Unit tests for the concept-dialogue base skill template (TAA-1 M0.5).

The chat-only Socratic concept tutor that backs teacher-authored
no-workbench activities. Verifies it parses, carries the teacher-focus
placeholder + the verbosity constraint, and declares NO workbench / mcp
wiring (it must render chat-only). Fast (<100ms), runs under
``make test-fast``.
"""

from __future__ import annotations

from pathlib import Path

from admin.platform_seed import _parse_template
from db.models import MAX_INSTRUCTIONS_CHARS

TEMPLATE_PATH = Path(__file__).resolve().parents[3] / "skills" / "templates" / "concept-dialogue" / "SKILL.md"

# Pydantic SkillConfig instructions cap. Read from the constant, not restated:
# this was hardcoded to 10_000 until 2026-08-27, three weeks after the real cap
# went to 25,000 — a guard stricter than the thing it guards sends the next
# reader off to trim a body that was never near the limit.
_INSTRUCTIONS_LIMIT = MAX_INSTRUCTIONS_CHARS


def test_template_parses() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["name"] == "concept-dialogue"
    assert parsed["displayName"].startswith("Begrebsdialog")


def test_carries_teacher_focus_placeholder() -> None:
    """The teacher's goal is injected via {teacher_focus}; without the
    placeholder, inject_teacher_focus is a no-op and the activity loses
    its teacher-set topic."""
    body = _parse_template(TEMPLATE_PATH)["instructions"]
    assert "{teacher_focus}" in body


def test_carries_response_length_constraint() -> None:
    body = _parse_template(TEMPLATE_PATH)["instructions"]
    assert "Maximum 3 sentences" in body
    assert "end with a question" in body


def test_is_chat_only_no_workbench_wiring() -> None:
    """Concept-dialogue has no paired sim — it must not declare mcp
    servers (which would attempt to attach a workbench/context channel)."""
    parsed = _parse_template(TEMPLATE_PATH)
    tool_configs = parsed["metadata"].get("toolConfigs", {})
    assert "mcp" not in tool_configs


def test_instructions_under_seed_cap() -> None:
    body = _parse_template(TEMPLATE_PATH)["instructions"]
    assert len(body) < _INSTRUCTIONS_LIMIT, f"instructions are {len(body)} chars (limit {_INSTRUCTIONS_LIMIT})"


def test_access_control_defaults_to_public() -> None:
    """Student-facing — no accessControl override, so the seed coerces to
    public and any group can open it."""
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["accessControl"] is None
