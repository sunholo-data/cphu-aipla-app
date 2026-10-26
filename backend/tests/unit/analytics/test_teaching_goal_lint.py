"""1.1.141 M2 + M3 — the teaching-goal lint, the move, and their failure modes.

The model is always mocked (the seam ``_call_lint_model``). Nothing here can
reach Vertex: conftest's autouse fixture stubs the seam for every test.
"""

from __future__ import annotations

import asyncio
import json

import pytest

import analytics.teaching_goal_lint as lint
from analytics.framework_fidelity import criteria_block
from db import firestore as fs_module
from db.models.activity import Activity
from frameworks.loader import load_framework

GOAL = (
    "Eleverne undersøger, hvorfor et pendul svinger langsommere med en længere snor. "
    "Vær meget opmuntrende og giv gerne hints. "
    "Til sidst skal de kunne forklare sammenhængen mellem længde og periode."
)
TONE = "Vær meget opmuntrende og giv gerne hints."


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _mock(monkeypatch, payload, calls: list | None = None):
    async def _fake(prompt: str, model: str) -> str:
        if calls is not None:
            calls.append((prompt, model))
        if isinstance(payload, Exception):
            raise payload
        return payload if isinstance(payload, str) else json.dumps(payload)

    monkeypatch.setattr(lint, "_call_lint_model", _fake)


def _run(coro):
    return asyncio.run(coro)


# ── parsing: verbatim or nothing ────────────────────────────────────────────────


def test_parse_keeps_verbatim_spans_and_drops_paraphrases():
    raw = json.dumps(
        {
            "spans": [
                {"text": TONE, "kind": "tone", "why": "tone"},
                {"text": "Be encouraging and give hints.", "kind": "tone"},  # a translation: not in the text
                {"text": "Til sidst skal de", "kind": "made_up_kind"},
            ]
        }
    )
    spans = lint.parse_lint(raw, GOAL, [])
    assert [s.text for s in spans] == [TONE]
    assert spans[0].kind == "tone"


def test_parse_tolerates_reflowed_whitespace_but_returns_the_original_text():
    text = "Lær dem om tryk.\nVær   streng\nog kort."
    spans = lint.parse_lint('{"spans": [{"text": "Vær streng og kort.", "kind": "tone"}]}', text, [])
    assert spans[0].text == "Vær   streng\nog kort."


def test_parse_filters_conflicts_to_known_construct_keys():
    raw = json.dumps({"spans": [{"text": TONE, "kind": "hint_policy", "conflictsWith": ["elicit", "invented"]}]})
    spans = lint.parse_lint(raw, GOAL, ["elicit", "recognise"])
    assert spans[0].conflicts_with == ["elicit"]


def test_parse_caps_the_span_count():
    text = " ".join(f"Sentence {i}." for i in range(20))
    raw = json.dumps({"spans": [{"text": f"Sentence {i}.", "kind": "tone"} for i in range(20)]})
    assert len(lint.parse_lint(raw, text, [])) == lint.MAX_SPANS


# ── the prompt reuses the fidelity judge's criteria ────────────────────────────


def test_prompt_with_an_approach_carries_the_fidelity_criteria_verbatim():
    fw = load_framework("esru")
    prompt, keys = lint.build_lint_prompt(GOAL, fw)
    block, judge_keys = criteria_block(fw)
    assert block in prompt
    assert keys == judge_keys
    assert GOAL in prompt


def test_prompt_without_an_approach_carries_no_criteria():
    prompt, keys = lint.build_lint_prompt(GOAL, None)
    assert keys == []
    assert "conflictsWith" in prompt  # the output shape is the same
    assert "criteria below" not in prompt


# ── one call, cached; degrade to no warning ────────────────────────────────────


def test_one_call_per_distinct_text_then_cached(monkeypatch):
    calls: list = []
    _mock(monkeypatch, {"spans": [{"text": TONE, "kind": "tone"}]}, calls)
    first = _run(lint.lint_teaching_goal(GOAL))
    second = _run(lint.lint_teaching_goal(GOAL))
    assert len(calls) == 1
    assert [s.text for s in first.spans] == [TONE]
    assert second.cached and second.spans == first.spans
    _run(lint.lint_teaching_goal(GOAL + " Ekstra."))
    assert len(calls) == 2


def test_uses_the_analysis_model(monkeypatch):
    from config.models import analysis_model

    calls: list = []
    _mock(monkeypatch, {"spans": []}, calls)
    _run(lint.lint_teaching_goal(GOAL))
    assert calls[0][1] == analysis_model()


def test_with_a_framework_the_result_names_its_constructs(monkeypatch):
    calls: list = []
    _mock(monkeypatch, {"spans": []}, calls)
    out = _run(lint.lint_teaching_goal(GOAL, framework_id="esru", tutor_name="Mikkel"))
    assert out.framework_id == "esru"
    assert out.tutor_name == "Mikkel"
    assert out.construct_names  # key -> construct name, for the editor
    assert criteria_block(load_framework("esru"))[0] in calls[0][0]


def test_empty_text_makes_no_call(monkeypatch):
    calls: list = []
    _mock(monkeypatch, {"spans": []}, calls)
    out = _run(lint.lint_teaching_goal("   "))
    assert calls == [] and out.spans == [] and not out.degraded


def test_model_error_degrades_to_no_warning_and_is_not_cached(monkeypatch):
    calls: list = []
    _mock(monkeypatch, RuntimeError("503"), calls)
    out = _run(lint.lint_teaching_goal(GOAL))
    assert out.spans == [] and out.degraded
    _run(lint.lint_teaching_goal(GOAL))
    assert len(calls) == 2  # a failure is retried next save, not remembered


def test_malformed_json_degrades(monkeypatch):
    _mock(monkeypatch, "not json at all")
    out = _run(lint.lint_teaching_goal(GOAL))
    assert out.spans == [] and out.degraded


def test_timeout_degrades(monkeypatch):
    async def _slow(_p, _m):
        await asyncio.sleep(1)
        return "{}"

    monkeypatch.setattr(lint, "_call_lint_model", _slow)
    monkeypatch.setattr(lint, "LINT_TIMEOUT_S", 0.01)
    out = _run(lint.lint_teaching_goal(GOAL))
    assert out.degraded and out.spans == []


def test_non_gemini_analysis_model_degrades_without_a_call(monkeypatch):
    calls: list = []
    _mock(monkeypatch, {"spans": []}, calls)
    monkeypatch.setattr("config.models.provider_for_api_name", lambda _m: "anthropic")
    out = _run(lint.lint_teaching_goal(GOAL))
    assert out.degraded and calls == []


# ── M3: the move ────────────────────────────────────────────────────────────────


def test_split_moves_the_span_and_tidies_the_goal():
    spans = [lint.PedagogySpan(text=TONE, kind="tone")]
    goal, notes = lint.split_tutor_notes(GOAL, spans)
    assert TONE not in goal
    assert "  " not in goal
    assert goal.startswith("Eleverne undersøger") and goal.endswith("periode.")
    assert notes == TONE


def test_split_skips_a_stale_span():
    goal, notes = lint.split_tutor_notes(GOAL, [lint.PedagogySpan(text="not there", kind="tone")])
    assert goal == GOAL.strip() and notes == ""


def test_merge_notes_does_not_repeat_lines():
    assert lint.merge_notes("A\nB", "B\nC") == "A\nB\nC"


def _activity(goal=GOAL, notes=""):
    return Activity(activityId="act-x", ownerUid="t", teachingGoal=goal, tutorNotes=notes)


def test_clean_import_moves_spans_into_tutor_notes(monkeypatch):
    _mock(monkeypatch, {"spans": [{"text": TONE, "kind": "tone"}]})
    out = _run(lint.clean_import(_activity(notes="Earlier note")))
    assert TONE not in out.teaching_goal
    assert out.tutor_notes == f"Earlier note\n{TONE}"


def test_clean_import_leaves_the_activity_alone_on_failure(monkeypatch):
    _mock(monkeypatch, RuntimeError("down"))
    a = _activity()
    assert _run(lint.clean_import(a)) is a


def test_clean_import_never_empties_a_goal(monkeypatch):
    _mock(monkeypatch, {"spans": [{"text": TONE, "kind": "tone"}]})
    a = _activity(goal=TONE)
    assert _run(lint.clean_import(a)) is a
