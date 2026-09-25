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


def test_student_with_map_gets_the_checkpoint_and_marking_tools():
    tools = _tools(_cfg(), _student())
    assert set(tools) == {"run_checkpoint", "record_checkpoint", "mark_concept"}


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
    assert no_q["ok"] is False and "neither check questions nor a definition of done" in no_q["error"]


def test_a_node_with_only_a_definition_of_done_is_checkpointable():
    """CONCEPT-2 M1. Before, a node the teacher described but wrote no questions
    for was a dead end — the tutor was told to "assess it conversationally",
    which is a checkpoint that happens and leaves no evidence. The definition of
    done is a bar, so it is enough to run one against."""
    cfg = _cfg(with_questions=False)
    cfg.concept_map[0].nodes[0].done_when = "kan opdele en fart i vx og vy uden hjælp"
    out = _tools(cfg, _student())["run_checkpoint"]("vektorer")
    assert out["ok"] is True
    assert out["questions"] == []
    assert out["node"]["doneWhen"] == "kan opdele en fart i vx og vy uden hjælp"
    assert "Ask one" in out["guidance"]


def test_the_definition_of_done_reaches_the_judge_alongside_the_questions():
    """A node with BOTH: the questions are the probe, doneWhen is the bar, and
    the guidance must say which is which — an expected answer the student
    matches verbatim is not the same as having got the concept."""
    cfg = _cfg()
    cfg.concept_map[0].nodes[1].done_when = "kan begrunde parablen med konstant lodret acceleration"
    out = _tools(cfg, _student())["run_checkpoint"]("projektil")
    assert out["ok"] is True
    assert out["node"]["doneWhen"] == "kan begrunde parablen med konstant lodret acceleration"
    assert "doneWhen" in out["guidance"] and "that sentence is the bar" in out["guidance"]


# --- record_checkpoint ---


def test_record_checkpoint_persists_keyed_by_the_verified_group():
    record = _tools(_cfg(), _student())["record_checkpoint"]
    res = record("projektil", True, "Forklarede parablen via konstant acceleration.")
    assert res["ok"] is True and res["status"] == "demonstrated"
    stored = get_node_states(GROUP, "act-1")
    assert stored["projektil"]["status"] == "demonstrated"
    assert [r["kind"] for r in stored["projektil"]["evidence"]] == ["checkpoint"]
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


# --- mark_concept (CONCEPT-2 M2) ---


def test_mark_concept_records_observed_evidence():
    mark = _tools(_cfg(), _student())["mark_concept"]
    res = mark("vektorer", "demonstrated", "Dekomponerede 30°-kastet uden hjælp.")
    assert res["ok"] is True and res["status"] == "demonstrated" and res["kind"] == "observed"
    stored = get_node_states(GROUP, "act-1")["vektorer"]
    assert [r["kind"] for r in stored["evidence"]] == ["observed"]


def test_mark_concept_reports_the_status_that_actually_stands_not_the_one_asked_for():
    """The tutor must not be told its mark landed when the reduction refused
    it — it would then talk to the student about a concept as settled while the
    map shows otherwise. Same class of bug as the tutor believing progress it
    could not see (1.1.70)."""
    record_checkpoint_state(GROUP, "act-1", "vektorer", "demonstrated", "bestod tjek")
    res = _tools(_cfg(), _student())["mark_concept"]("vektorer", "partial", "virkede usikker igen")
    assert res["ok"] is True
    assert res["status"] == "demonstrated"  # the checkpoint still stands


def test_mark_concept_refuses_an_unknown_node_a_bad_status_and_empty_evidence():
    mark = _tools(_cfg(), _student())["mark_concept"]
    assert mark("bogus", "demonstrated", "x")["ok"] is False
    bad = mark("vektorer", "not_yet", "x")
    assert bad["ok"] is False and "demonstrated" in bad["error"]
    assert mark("vektorer", "partial", "   ")["ok"] is False
    # none of the three wrote anything
    assert get_node_states(GROUP, "act-1") == {}


def test_mark_concept_is_not_offered_to_a_teacher_or_a_mapless_activity():
    """Same gate as the checkpoint tools: identity is closed over, and there is
    no group to record against."""
    assert build_checkpoint_tools(_cfg(), _teacher()) == []


# --- context summary + focus block ---


def test_checkpoint_state_summary_reads_the_group_state():
    assert checkpoint_state_summary(_cfg(), _student()) == ""  # nothing recorded yet
    record_checkpoint_state(GROUP, "act-1", "vektorer", "demonstrated", "ok")
    summary = checkpoint_state_summary(_cfg(), _student())
    assert "demonstrated" in summary
    # 1.1.70 M1: the teacher's LABEL, not the raw node id the old one-line form
    # emitted — an id the model has to cross-reference to say anything useful.
    assert "Vektorer" in summary or "vektorer" in summary


def test_the_focus_block_carries_the_definition_of_done_and_names_it_as_the_bar():
    """CONCEPT-2 M1. The bar has to reach the tutor on an ORDINARY turn, not
    only inside a run_checkpoint result — a mark the tutor makes without opening
    a checkpoint (M2) is judged against whatever it has in front of it."""
    from adk.teacher_focus import compose_teacher_focus

    cfg = _cfg()
    cfg.concept_map[0].nodes[1].done_when = "kan begrunde parablen med konstant lodret acceleration"
    focus = compose_teacher_focus(cfg)
    assert "done when: kan begrunde parablen med konstant lodret acceleration" in focus
    assert "not against your own sense of a good answer" in focus


def test_the_focus_block_is_unchanged_for_a_map_with_no_definitions_of_done():
    """The 56 maps on prod on 2026-09-25 carry none. They must compose exactly
    as they did before the field existed."""
    from adk.teacher_focus import compose_teacher_focus

    focus = compose_teacher_focus(_cfg())
    assert "done when:" not in focus


def test_compose_teacher_focus_includes_the_map_and_the_contract():
    from adk.teacher_focus import compose_teacher_focus

    focus = compose_teacher_focus(_cfg())
    assert "concept map" in focus
    assert "- projektil: Projektil (builds on: vektorer) [1 check questions]" in focus
    assert "run_checkpoint" in focus and "record_checkpoint" in focus
    # statuses are NOT baked into the once-per-session instruction
    assert "demonstrated" not in focus.split("record_checkpoint")[0].split("concept map")[1]
