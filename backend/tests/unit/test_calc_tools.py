"""``calculate`` reaches every agent, keeps a plain schema, and never renders to a student.

Design: docs/design/aipla/v1.1.0-feedback/verifiable-maths-tool.md (M2, F5, rule 1)
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from adk.agent import create_agent
from adk.calc_tools import TOOL_NAME, build_calc_tools
from adk.stream_redaction import (
    REDACTED_CONTENT,
    begin_renderable_declaration,
    redact_student_stream,
    should_redact_tool,
)
from auth.firebase_auth import User
from db.models import SkillConfig, SkillMetadata


def _skill(skill_id: str = "concept-dialogue") -> SkillConfig:
    return SkillConfig(
        name=skill_id,
        description="Test skill.",
        instructions="Teach.",
        skillId=skill_id,
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
    )


def _names(agent) -> list[str]:
    return [getattr(t, "name", None) or getattr(t, "__name__", type(t).__name__) for t in agent.tools]


@pytest.mark.parametrize(
    "user",
    [
        User(uid="group:sweet-bison-13", email="", group_id="sweet-bison-13"),
        User(uid="t1", email="teacher@example.dk", domain="example.dk"),
    ],
    ids=["student", "teacher"],
)
def test_every_agent_gets_calculate(user):
    """Unconditional, like the notation preamble that tells the agent to use it."""
    for skill_id in ("concept-dialogue", "problem-set-hints", "activity-authoring-assistant"):
        assert TOOL_NAME in _names(create_agent(_skill(skill_id), user)), skill_id


def test_the_declaration_is_plain_strings_with_no_free_form_object():
    """A dict parameter becomes additionalProperties, which model APIs handle badly."""
    decl = build_calc_tools()[0]._get_declaration()
    schema = decl.parameters_json_schema or decl.parameters.model_dump(exclude_none=True)
    text = json.dumps(schema)
    assert "additionalProperties" not in text
    props = schema["properties"]
    assert set(props) == {"expression", "quantities", "result_unit", "check"}
    assert schema.get("required") == ["expression"]
    # The rules the model must act on live where the model reads them.
    assert "BEFORE you state any number you derived" in decl.description
    assert "Do not" in decl.description and "correct value" in decl.description


def test_the_tool_returns_the_engine_result():
    tool = build_calc_tools(SimpleNamespace(language="en"))[0]
    r = asyncio.run(
        tool.run_async(
            args={"expression": "P * t", "quantities": ["P = 2.2 kW", "t = 3 min"], "result_unit": "kJ"},
            tool_context=None,
        )
    )
    assert r["ok"] and r["result"]["value"] == 396.0
    assert "2.2" in r["latex"]  # English: decimal point


@pytest.mark.parametrize(
    ("cfg_lang", "student", "expected"),
    [("da", None, "{,}"), ("en", None, "."), ("da", "en", "."), ("en", "da", "{,}"), (None, None, "{,}")],
)
def test_language_is_the_students_choice_then_the_activitys_then_danish(cfg_lang, student, expected):
    cfg = SimpleNamespace(language=cfg_lang) if cfg_lang else None
    tool = build_calc_tools(cfg, student_language=student)[0]
    r = asyncio.run(tool.run_async(args={"expression": "x", "quantities": ["x = 2.5 m"]}, tool_context=None))
    assert f"2{expected}5" in r["latex"]


# --- private to the tutor (rule 1; M4's show_calculation is the visible one) --------


def test_calculate_is_redacted_for_a_student():
    begin_renderable_declaration()
    assert should_redact_tool(TOOL_NAME)


def test_a_student_stream_carries_the_sentinel_not_the_result():
    begin_renderable_declaration()
    result = json.dumps({"ok": True, "result": {"value": 360.0, "unit": "kJ"}, "latex": "$E = 360\\,\\text{kJ}$"})
    events = [
        {"type": "TOOL_CALL_START", "toolCallId": "c1", "toolCallName": TOOL_NAME},
        {"type": "TOOL_CALL_RESULT", "toolCallId": "c1", "content": result},
    ]

    async def _agen():
        for e in events:
            yield e

    async def _collect():
        return [e async for e in redact_student_stream(_agen(), is_student=True)]

    out = asyncio.run(_collect())
    results = [e for e in out if e["type"] == "TOOL_CALL_RESULT"]
    assert results and results[0]["content"] == REDACTED_CONTENT
    assert "360" not in json.dumps(out)
