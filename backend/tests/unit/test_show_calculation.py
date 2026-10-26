"""``show_calculation``: the card a student sees, and the value a ``hold`` tutor keeps back (1.1.152 M4).

Design: docs/design/aipla/v1.1.0-feedback/verifiable-maths-tool.md (M4, Pedagogy)

What has to hold, and why each test exists:

* the number on the card is the engine's, never the model's;
* on a ``hold`` skill the final value is ABSENT from the result, because this
  result streams to the student's browser — not merely undrawn;
* a wrong answer gets a direction, never the value (pedagogy rule 3);
* only the student can unlock it: a ``student_value`` not in their message is
  ignored, and with no message to read it does not count either;
* the mode comes from the skill's stored ``calculationResults`` end to end
  (template → seed → SkillConfig → create_agent → tool AND prompt), witnessed
  with values that CONFLICT with the skill's name so a fallthrough to a default
  or a name-keyed shortcut would fail.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from google.genai import types

from adk.agent import create_agent
from adk.calc_tools import SHOW_TOOL_NAME, TOOL_NAME, build_calc_tools
from adk.math_notation import build_calculation_hold_block
from adk.stream_redaction import REDACTED_CONTENT, begin_renderable_declaration, redact_student_stream
from admin.platform_seed import _parse_template, _template_updates
from auth.firebase_auth import User
from db.models import SkillConfig, SkillMetadata
from maths.card import calculation_card, numbers_in

KETTLE = ["P = 2000 W", "t = 150 s"]  # E = 300 kJ = 300000 J
_TEMPLATES = Path(__file__).resolve().parents[2] / "skills" / "templates"


def _ctx(text: str | None) -> SimpleNamespace:
    """A stand-in ToolContext whose user_content is the student's message."""
    content = None if text is None else types.Content(role="user", parts=[types.Part(text=text)])
    return SimpleNamespace(user_content=content)


def _show(mode: str = "show", text: str | None = None, **args):
    tool = build_calc_tools(SimpleNamespace(language="da"), calculation_results=mode)[1]
    return asyncio.run(
        tool.run_async(args={"expression": "P * t", "quantities": KETTLE, **args}, tool_context=_ctx(text))
    )


def _answer_forms(card_json: str) -> list[str]:
    """Every spelling of 300 kJ / 300000 J that could leak the answer."""
    return [f for f in ("300", "3{,}0", "3.0", "3e5", "300000", "3 \\cdot 10^{5}") if f in card_json]


# --- show mode: the whole calculation ------------------------------------------


def test_show_mode_carries_the_engines_result_and_working():
    r = _show(result_unit="kJ")
    assert r["ok"] and r["held"] is False and r["mode"] == "show"
    assert r["result"] == {"value": 300.0, "unit": "kJ"}
    assert r["latex"] == r"$P \cdot t = 2000\,\text{W} \cdot 150\,\text{s} = 300\,\text{kJ}$"
    assert r["working"] == r"$P \cdot t = 2000\,\text{W} \cdot 150\,\text{s}$"


def test_the_card_has_no_parameter_for_a_result_so_the_model_cannot_paste_one():
    decl = build_calc_tools()[1]._get_declaration()
    schema = decl.parameters_json_schema or decl.parameters.model_dump(exclude_none=True)
    assert set(schema["properties"]) == {"expression", "quantities", "result_unit", "student_value"}
    assert "additionalProperties" not in json.dumps(schema)  # tool_context is not a model parameter


def test_show_mode_with_a_student_answer_also_compares():
    r = _show(result_unit="kJ", student_value="18000 kJ", text="jeg fik 18000 kJ")
    assert r["result"]["value"] == 300.0
    assert r["student"]["status"] == "mismatch" and r["student"]["ratio"] == 60.0


# --- hold mode: the value is absent until the student's answer matches ----------


def test_hold_without_an_answer_has_the_working_and_no_value_anywhere():
    r = _show("hold", text="hvordan regner jeg energien ud?", result_unit="kJ")
    assert r["ok"] and r["held"] is True
    assert "result" not in r and "latex" not in r
    assert r["working"] == r"$P \cdot t = 2000\,\text{W} \cdot 150\,\text{s}$"
    assert r["result_unit_latex"] == r"\text{kJ}"
    assert _answer_forms(json.dumps(r, ensure_ascii=False)) == []


def test_the_leak_check_finds_the_value_on_a_show_card():
    """Witness for the two no-leak tests: the check is not vacuous."""
    assert _answer_forms(json.dumps(calculation_card("P * t", KETTLE, "kJ"), ensure_ascii=False))
    assert _answer_forms(json.dumps(calculation_card("P * t", KETTLE), ensure_ascii=False))


def test_hold_without_a_unit_asked_for_shows_the_unprefixed_si_unit():
    """'= ? kJ' already says the answer is in the thousands; '= ? J' does not."""
    assert _show("hold", text="?")["result_unit_latex"] == r"\text{J}"


def test_hold_unlocks_when_the_students_own_answer_matches():
    r = _show("hold", text="Jeg har fået 300 kJ", result_unit="kJ", student_value="300 kJ")
    assert r["held"] is False and r["result"]["value"] == 300.0
    assert r["student"] == {"value": "300 kJ", "status": "match"}


def test_a_rounded_answer_within_tolerance_counts():
    r = _show("hold", text="ca. 0,3 MJ", student_value="0,3 MJ")
    assert r["student"]["status"] == "match" and r["held"] is False


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        ("18000 kJ", {"direction": "too_large", "hint": "time_unit", "factor": 60.0}),  # t in minutes
        ("3 kJ", {"direction": "too_small", "hint": "power_of_ten", "power": -2}),
        ("600 kJ", {"direction": "too_large", "hint": "factor_two", "factor": 2.0}),
        ("471 kJ", {"direction": "too_large"}),  # no named cause: no factor either
        ("-300 kJ", {"direction": "sign"}),
    ],
)
def test_a_wrong_answer_gets_a_direction_never_the_value(answer, expected):
    r = _show("hold", text=f"svaret er {answer}", result_unit="kJ", student_value=answer)
    assert r["held"] is True and "result" not in r
    student = {k: v for k, v in r["student"].items() if k not in ("value", "status")}
    assert r["student"]["status"] == "mismatch" and student == expected
    assert "ratio" not in r["student"]  # the exact ratio would give the value back


@pytest.mark.parametrize(
    ("answer", "status"),
    [("300 W", "different_quantity"), ("300", "no_unit"), ("300 bananer", "unreadable")],
)
def test_answers_that_cannot_be_compared_say_why_and_stay_held(answer, status):
    r = _show("hold", text=f"mit svar: {answer}", result_unit="kJ", student_value=answer)
    assert r["held"] is True and r["student"]["status"] == status and "result" not in r


# --- only the student can unlock it ---------------------------------------------


def test_a_student_value_not_in_the_students_message_is_ignored():
    r = _show("hold", text="jeg ved det ikke", result_unit="kJ", student_value="300 kJ")
    assert r["held"] is True and "result" not in r and "student" not in r
    assert "not in the student's message" in r["student_value_ignored"]


def test_with_no_message_to_read_a_student_value_does_not_count():
    r = _show("hold", text=None, result_unit="kJ", student_value="300 kJ")
    assert r["held"] is True and "result" not in r


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("E = 3,2·10^-19 C", [3.2e-19]),
        ("1.6e-19", [1.6e-19]),
        ("2 000 kJ", [2000.0]),
        ("360 000 J", [360000.0]),
        ("0,3 MJ eller 300 kJ", [0.3, 300.0]),
    ],
)
def test_student_numbers_are_read_as_a_danish_or_english_student_writes_them(text, expected):
    assert numbers_in(text) == pytest.approx(expected)


# --- the stream: visible card, private calculator --------------------------------


def _student_stream(events: list[dict]) -> list[dict]:
    begin_renderable_declaration()

    async def _agen():
        for e in events:
            yield e

    async def _collect():
        return [e async for e in redact_student_stream(_agen(), is_student=True)]

    return asyncio.run(_collect())


def test_on_a_student_stream_calculate_is_the_sentinel_and_show_calculation_is_not():
    card = json.dumps(calculation_card("P * t", KETTLE, "kJ"))
    private = json.dumps({"ok": True, "result": {"value": 300.0, "unit": "kJ"}})
    out = _student_stream(
        [
            {"type": "TOOL_CALL_START", "toolCallId": "c1", "toolCallName": TOOL_NAME},
            {"type": "TOOL_CALL_RESULT", "toolCallId": "c1", "content": private},
            {"type": "TOOL_CALL_START", "toolCallId": "c2", "toolCallName": SHOW_TOOL_NAME},
            {"type": "TOOL_CALL_RESULT", "toolCallId": "c2", "content": card},
        ]
    )
    results = {e["toolCallId"]: e["content"] for e in out if e["type"] == "TOOL_CALL_RESULT"}
    assert results["c1"] == REDACTED_CONTENT
    assert results["c2"] == card


def test_a_held_card_reaches_the_student_stream_without_the_value():
    held = json.dumps(calculation_card("P * t", KETTLE, "kJ", mode="hold"), ensure_ascii=False)
    out = _student_stream(
        [
            {"type": "TOOL_CALL_START", "toolCallId": "c2", "toolCallName": SHOW_TOOL_NAME},
            {"type": "TOOL_CALL_RESULT", "toolCallId": "c2", "content": held},
        ]
    )
    assert _answer_forms(json.dumps(out, ensure_ascii=False)) == []


# --- config end to end: template → seed → SkillConfig → agent -------------------


def _agent_for(skill_id: str, calculation_results: str):
    cfg = SkillConfig(
        name=skill_id,
        description="Test skill.",
        instructions="Teach.",
        skillId=skill_id,
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
        calculationResults=calculation_results,
    )
    return create_agent(cfg, User(uid="group:sweet-bison-13", email="", group_id="sweet-bison-13"))


def _tool(agent, name: str):
    return next(t for t in agent.tools if getattr(t, "name", None) == name)


def _instruction(agent) -> str:
    return asyncio.run(agent.instruction(SimpleNamespace(state={})))


def test_problem_set_hints_template_seeds_hold_and_the_others_show():
    parsed = {p.name: _parse_template(p / "SKILL.md") for p in _TEMPLATES.iterdir() if (p / "SKILL.md").exists()}
    assert parsed["problem-set-hints"]["calculationResults"] == "hold"
    assert {n for n, p in parsed.items() if p["calculationResults"] == "hold"} == {"problem-set-hints"}
    # The UPDATE path carries it too, or a re-seed would never reach an existing skill.
    assert _template_updates(parsed["problem-set-hints"])["calculationResults"] == "hold"
    assert _template_updates(parsed["concept-dialogue"])["calculationResults"] == "show"


def test_the_seeded_firestore_shape_round_trips_into_skill_config():
    assert SkillConfig.model_validate({"name": "x", "calculationResults": "hold"}).calculation_results == "hold"
    assert SkillConfig.model_validate({"name": "x"}).calculation_results == "show"


@pytest.mark.parametrize(
    ("skill_id", "stored", "held"),
    [
        # CONFLICTING with the names on purpose: a lookup keyed on "problem-set-hints",
        # or a fallthrough to the default, fails one of these rows.
        ("problem-set-hints", "show", False),
        ("concept-dialogue", "hold", True),
        ("problem-set-hints", "hold", True),
        ("concept-dialogue", "show", False),
    ],
)
def test_the_stored_mode_reaches_the_tool_and_the_prompt(skill_id, stored, held):
    agent = _agent_for(skill_id, stored)
    tool = _tool(agent, SHOW_TOOL_NAME)
    r = asyncio.run(tool.run_async(args={"expression": "P * t", "quantities": KETTLE}, tool_context=_ctx("hvad nu?")))
    assert r["held"] is held
    hold_block = build_calculation_hold_block("hold")
    assert hold_block and (hold_block in _instruction(agent)) is held


def test_a_show_skills_prompt_is_unchanged_by_the_hold_block():
    """Byte-identical on every show skill: the block is '' there, not a weaker variant."""
    assert build_calculation_hold_block("show") == "" and build_calculation_hold_block(None) == ""
