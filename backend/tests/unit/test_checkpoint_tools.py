"""CONCEPT-1 M3 — chat-native checkpoints.

Headline: IDENTITY IS CLOSED OVER, not model-controlled. The tools are built per
session from the resolved ActivityConfig + the VERIFIED group identity, so the
model can never name another group/activity. Teachers (no group) and mapless
activities get NO checkpoint tools at all.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from adk.checkpoint_tools import build_checkpoint_tools, checkpoint_state_summary
from auth.firebase_auth import User
from db import firestore as fs_module
from db.concept_progress import get_node_states, record_checkpoint_state
from db.models.activity_config import ActivityConfig, CheckQuestion, ConceptEdge, ConceptMapElement, ConceptNode

GROUP = "grp-7b"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _student(group_id: str = GROUP) -> User:
    return User(uid="student-anon", group_id=group_id, group_tags=frozenset({"class:t-1:cls-1"}))


def _teacher() -> User:
    return User(uid="t-1")


def _cfg(with_questions: bool = True) -> ActivityConfig:
    questions = (
        [CheckQuestion(id="q1", prompt="Hvorfor er banen en parabel?", expected_answer="konstant lodret acceleration")]
        if with_questions
        else []
    )
    return ActivityConfig(
        activityId="act-1",
        classId="cls-1",
        teacherUid="t-1",
        updatedAt=datetime.now(UTC),
        concept_map=[
            ConceptMapElement(
                id="concept-map-1",
                nodes=[
                    ConceptNode(id="vektorer", label="Vektorer"),
                    ConceptNode(id="projektil", label="Projektil", check_questions=questions),
                ],
                edges=[ConceptEdge.model_validate({"from": "vektorer", "to": "projektil"})],
            )
        ],
    )


def _tools(cfg: ActivityConfig, user: User) -> dict:
    return {t.func.__name__: t.func for t in build_checkpoint_tools(cfg, user)}


# --- gating ---


def test_no_tools_without_map_or_group():
    bare = ActivityConfig(activityId="a", classId="c", teacherUid="t-1", updatedAt=datetime.now(UTC))
    assert build_checkpoint_tools(bare, _student()) == []
    assert build_checkpoint_tools(_cfg(), _teacher()) == []  # teacher: no group to record against
    assert build_checkpoint_tools(None, _student()) == []


def test_student_with_map_gets_both_tools():
    tools = _tools(_cfg(), _student())
    assert set(tools) == {"run_checkpoint", "record_checkpoint"}


# --- run_checkpoint ---


def test_run_checkpoint_returns_questions_with_judging_rubric():
    run = _tools(_cfg(), _student())["run_checkpoint"]
    res = run("projektil")
    assert res["ok"] is True
    assert res["questions"][0]["expectedAnswer"] == "konstant lodret acceleration"
    assert "one at a time" in res["guidance"].lower()


def test_run_checkpoint_self_corrects_on_unknown_or_questionless_node():
    run = _tools(_cfg(), _student())["run_checkpoint"]
    unknown = run("bogus")
    assert unknown["ok"] is False
    assert {n["id"] for n in unknown["nodes"]} == {"vektorer", "projektil"}
    no_q = run("vektorer")
    assert no_q["ok"] is False and "no check questions" in no_q["error"]


# --- record_checkpoint ---


def test_record_checkpoint_persists_keyed_by_the_verified_group():
    record = _tools(_cfg(), _student())["record_checkpoint"]
    res = record("projektil", True, "Forklarede parablen via konstant acceleration.")
    assert res["ok"] is True and res["status"] == "demonstrated"
    stored = get_node_states(GROUP, "act-1")
    assert stored["projektil"]["status"] == "demonstrated"
    assert stored["projektil"]["evidence"]["kind"] == "checkpoint"
    # another group's record is untouched (keying really is per group)
    assert get_node_states("grp-other", "act-1") == {}


def test_record_checkpoint_failed_is_partial_never_failed():
    record = _tools(_cfg(), _student())["record_checkpoint"]
    res = record("projektil", False, "Blandede vx og vy sammen.")
    assert res["status"] == "partial"
    assert get_node_states(GROUP, "act-1")["projektil"]["status"] == "partial"


def test_record_checkpoint_merges_per_node():
    record = _tools(_cfg(), _student())["record_checkpoint"]
    record("vektorer", True, "ok")
    record("projektil", False, "på vej")
    states = get_node_states(GROUP, "act-1")
    assert states["vektorer"]["status"] == "demonstrated"
    assert states["projektil"]["status"] == "partial"


# --- context summary + focus block ---


def test_checkpoint_state_summary_reads_the_group_state():
    assert checkpoint_state_summary(_cfg(), _student()) == ""  # nothing recorded yet
    record_checkpoint_state(GROUP, "act-1", "vektorer", "demonstrated", "ok")
    assert "vektorer=demonstrated" in checkpoint_state_summary(_cfg(), _student())


def test_compose_teacher_focus_includes_the_map_and_the_contract():
    from adk.teacher_focus import compose_teacher_focus

    focus = compose_teacher_focus(_cfg())
    assert "concept map" in focus
    assert "- projektil: Projektil (builds on: vektorer) [1 check questions]" in focus
    assert "run_checkpoint" in focus and "record_checkpoint" in focus
    # statuses are NOT baked into the once-per-session instruction
    assert "demonstrated" not in focus.split("record_checkpoint")[0].split("concept map")[1]
