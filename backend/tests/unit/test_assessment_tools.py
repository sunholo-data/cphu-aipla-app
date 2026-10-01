"""Assessment as a tool, not a tag — 1.1.133 M3.

Acceptance 6: ``record_assessment`` never appears in the student's stream, and
does appear on the chat-log row. Plus the tool's own contract: only on a sim
with a construct map, only for a student, enums ARE the map, evidence required.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace as NS

import pytest

from adk.assessment_tools import build_assessment_tools
from adk.stream_redaction import redact_student_stream, should_hide_tool_call
from artefacts.loader import load_artefact


def _cfg(artefact_id: str | None = "sol-jord-maane") -> NS:
    return NS(artefact_id=artefact_id, activity_id="act-1", class_id="cls-1")


def _ctx() -> NS:
    return NS(invocation_id="inv-1", session=NS(id="sess-1"), function_call_id="fc-7")


@pytest.fixture
def emitted(monkeypatch):
    rows: list[dict] = []
    import observability.chat_log as chat_log

    monkeypatch.setattr(chat_log, "emit_workbench_event", lambda **kw: rows.append(kw))
    return rows


def _tool(teaching=None):
    tools = build_assessment_tools(_cfg(), NS(group_id="sweet-bison-13"), skill_id="sk", teaching=teaching)
    assert len(tools) == 1
    return tools[0]


@pytest.mark.parametrize(
    ("cfg", "user"),
    [
        (None, NS(group_id="g")),
        (_cfg(None), NS(group_id="g")),
        (_cfg("boldkast"), NS(group_id="g")),  # no construct map
        (_cfg(), NS(group_id=None)),  # a teacher's preview: nobody to attribute it to
    ],
    ids=["no-activity", "no-sim", "sim-without-scale", "teacher"],
)
def test_no_tool_unless_a_student_is_on_a_sim_with_a_construct_map(cfg, user) -> None:
    assert build_assessment_tools(cfg, user) == []


def test_sol_jord_maane_defines_its_construct_map_server_side() -> None:
    a = load_artefact("sol-jord-maane")
    assert a is not None and a.assessment is not None
    assert a.assessment.phenomena == ["doegn", "aarstider", "faser", "formoerkelser", "skala"]
    assert (a.assessment.min_level, a.assessment.max_level) == (0, 6)
    # "Never show the student a level" — not even the scale is public.
    assert "assessment" not in a.public()


def test_the_declaration_is_the_construct_map() -> None:
    decl = _tool()._get_declaration()
    props = decl.parameters.properties
    assert props["phenomenon"].enum == ["doegn", "aarstider", "faser", "formoerkelser", "skala"]
    assert (props["level"].minimum, props["level"].maximum) == (0, 6)
    assert props["mission"].enum == ["M1", "M2", "M3", "M4", "M5"]
    assert set(decl.parameters.required) == {"phenomenon", "level", "evidence"}
    # The rule the eval (acceptance 7) checks lives where the model reads it.
    assert "level 0" in decl.description


def test_a_valid_assessment_lands_on_the_chat_log_with_the_tutor_stamped(emitted) -> None:
    teaching = NS(tutor_id="t-sofie", tutor_version=2, framework_id="esru")
    result = _tool(teaching).func(
        "aarstider",
        4,
        "Mener det er koldere om vinteren fordi vi er længere fra Solen.",
        "afstand",
        "M2",
        tool_context=_ctx(),
    )
    assert result == {"ok": True, "recorded": "aarstider"}
    assert len(emitted) == 1
    row = emitted[0]
    assert row["tool"] == "record_assessment"
    assert row["server"] == "sol-jord-maane"
    assert row["field"] == "aarstider"
    assert row["group_id"] == "sweet-bison-13" and row["session_id"] == "sess-1"
    assert row["activity_id"] == "act-1" and row["class_id"] == "cls-1"
    v = row["value"]
    assert v["level"] == 4 and v["mission"] == "M2" and v["misconception"] == "afstand"
    assert v["tutorId"] == "t-sofie" and v["tutorVersion"] == 2 and v["frameworkId"] == "esru"
    assert v["scale"] == [0, 6]
    # The result tells the student-facing stream nothing about the level.
    assert "4" not in str(result)


def test_a_dont_know_is_recordable_as_level_zero(emitted) -> None:
    """Level 0 is "no evidence", and must be a valid value — not refused as falsy."""
    assert _tool().func("faser", 0, 'Skrev "ved ikke".', tool_context=_ctx())["ok"] is True
    assert emitted[0]["value"]["level"] == 0


@pytest.mark.parametrize(
    ("args", "needle"),
    [
        (("tidevand", 3, "x"), "phenomenon"),
        (("faser", 7, "x"), "from 0 to 6"),
        (("faser", -1, "x"), "from 0 to 6"),
        (("faser", 2.5, "x"), "whole number"),
        (("faser", True, "x"), "whole number"),
        (("faser", 3, "   "), "evidence is required"),
        (("faser", 3, "x", "", "M9"), "mission"),
    ],
)
def test_malformed_assessments_are_refused_and_not_logged(emitted, args, needle) -> None:
    result = _tool().func(*args, tool_context=_ctx())
    assert result["ok"] is False
    assert needle in result["error"]
    assert emitted == []


# --- Hidden from the student, structurally ----------------------------------


async def _collect(events: list[dict], *, is_student: bool) -> list[dict]:
    async def gen():
        for e in events:
            yield e

    return [e async for e in redact_student_stream(gen(), is_student=is_student)]


_STREAM = [
    {"type": "TEXT_MESSAGE_CONTENT", "delta": "Godt tænkt."},
    {"type": "TOOL_CALL_START", "toolCallId": "a1", "toolCallName": "record_assessment"},
    {"type": "TOOL_CALL_ARGS", "toolCallId": "a1", "delta": '{"phenomenon": "aarstider", "level": 4'},
    {"type": "TOOL_CALL_END", "toolCallId": "a1"},
    {"type": "TOOL_CALL_RESULT", "toolCallId": "a1", "content": '{"ok": true}'},
    {"type": "TOOL_CALL_START", "toolCallId": "c1", "toolCallName": "control_sim"},
    {"type": "TOOL_CALL_RESULT", "toolCallId": "c1", "content": '{"ok": true}'},
]


def test_a_student_stream_never_carries_the_assessment_call() -> None:
    """Acceptance 6. Not just the result: the ARGS carry the level."""
    out = asyncio.run(_collect(_STREAM, is_student=True))
    assert all(e.get("toolCallId") != "a1" for e in out)
    assert "level" not in str(out)
    # Everything else passes as before.
    assert [e["type"] for e in out] == ["TEXT_MESSAGE_CONTENT", "TOOL_CALL_START", "TOOL_CALL_RESULT"]
    assert out[-1]["content"] == '{"ok": true}'


def test_a_teacher_stream_is_untouched() -> None:
    assert asyncio.run(_collect(_STREAM, is_student=False)) == _STREAM


def test_only_the_assessment_tool_is_hidden() -> None:
    assert should_hide_tool_call("record_assessment")
    for name in ("control_sim", "mark_checklist_item", "record_checkpoint", ""):
        assert not should_hide_tool_call(name)


# --- Over the real agent builder ---------------------------------------------


@pytest.fixture
def _activity_env(monkeypatch):
    from db import firestore as fs_module

    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _tool_names(artefact_id: str, group_id: str | None) -> list[str]:
    from adk.agent import create_agent
    from adk.teacher_focus import LOCAL_MODE_DEMO_CLASS_ID
    from auth.firebase_auth import User
    from db.activity_configs import upsert_activity_config
    from db.local_fixture import WORKSHOP_USER_UID
    from db.models import SkillConfig, SkillMetadata

    skill_id = "55555555-5555-5555-5555-555555555555"
    upsert_activity_config(
        teacher_uid=WORKSHOP_USER_UID,
        class_id=LOCAL_MODE_DEMO_CLASS_ID,
        activity_id=skill_id,
        teaching_goal="Forklar årstiderne.",
        artefact_id=artefact_id,
    )
    skill = SkillConfig(
        name="t",
        description="d",
        instructions="Do the thing.",
        skillId=skill_id,
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
    )
    if group_id:
        user = User(uid="group-x", email="", domain="", group_id=group_id, auth_mode="anonymous_group_id")
    else:
        user = User(uid="u1", email="t@example.com", domain="example.com")
    return [getattr(t, "name", "") for t in create_agent(skill, user).tools]


def test_the_student_agent_gets_record_assessment_on_a_construct_map_sim(_activity_env) -> None:
    assert "record_assessment" in _tool_names("sol-jord-maane", "sweet-bison-13")
    assert "record_assessment" not in _tool_names("boldkast", "sweet-bison-13")
    assert "record_assessment" not in _tool_names("sol-jord-maane", None)
