"""1.1.92 M0 (BENCH-1) — every scored result carries the ARM it ran under.

The matrix (tutor x activity) had one axis: every run knew its activity and
none knew its tutor. These tests pin the second axis end to end — chat-turn
stamp -> SessionSummary -> RubricResult -> run store — and the rule that makes
it evidence rather than decoration: **unknown stays unknown**. A session from
before the stamp reads null, never a default tutor.
"""

from __future__ import annotations

import ast
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

import pytest

from analytics import session_rubric as sr
from analytics.rubric_runs import list_rubric_runs, record_rubric_run
from db import firestore as fs_module
from db.firestore import get_document, set_document
from reports.session_summary import SessionSummary, SessionTurn

_BACKEND = Path(__file__).resolve().parents[2]

FAKE_JUDGE_JSON = '{"physics_approach": {"score": 3, "rationale": "ok"}}'


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _summary(**arm) -> SessionSummary:
    return SessionSummary(
        sessionId="s-arm",
        groupCode="crisp-pebble-21",
        activityId="act-1",
        startedAt=datetime.now(UTC),
        durationSeconds=600,
        messageCount=1,
        simRunCount=0,
        conversation=[SessionTurn(timestamp="2026-09-30T10:00:00Z", role="student", content="min løsning: v = 7")],
        **arm,
    )


def _rubric_with_no_anchor_requirement() -> None:
    set_document(
        "rubric_defs",
        "clarity",
        {
            "rubric_id": "clarity",
            "prompt": "Score clarity.",
            "output_keys": ["physics_approach"],
            "model": "gemini-3.8-flash",
            "requires_anchors": False,
        },
    )


# --- summary -> result ---


@pytest.mark.asyncio
async def test_arm_is_populated_from_a_session_that_has_it(monkeypatch):
    _rubric_with_no_anchor_requirement()

    async def _judge(prompt: str, model: str, images=None) -> str:
        return FAKE_JUDGE_JSON

    monkeypatch.setattr(sr, "_call_judge_model", _judge)
    s = _summary(tutorId="sofie-esru", tutorVersion=3, frameworkId="esru", revision="aipla-v01-frontend-00042-abc")
    res = await sr.score_session_summary(s, "clarity")
    assert res.abstained is False
    assert res.tutor_id == "sofie-esru"
    assert res.tutor_version == 3
    assert res.framework_id == "esru"
    assert res.revision == "aipla-v01-frontend-00042-abc"
    assert res.group_id == "crisp-pebble-21"
    dumped = res.model_dump(by_alias=True)
    assert dumped["tutorId"] == "sofie-esru" and dumped["tutorVersion"] == 3 and dumped["groupId"]


@pytest.mark.asyncio
async def test_unknown_arm_stays_null_never_a_default_tutor(monkeypatch):
    _rubric_with_no_anchor_requirement()

    async def _judge(prompt: str, model: str, images=None) -> str:
        return FAKE_JUDGE_JSON

    monkeypatch.setattr(sr, "_call_judge_model", _judge)
    res = await sr.score_session_summary(_summary(), "clarity")
    assert res.tutor_id is None
    assert res.tutor_version is None
    assert res.framework_id is None
    assert res.revision is None


@pytest.mark.asyncio
async def test_abstained_result_still_carries_its_arm():
    # maps requires an anchor pack; none is seeded -> abstain. The arm must ride
    # the abstention too, or "uncalibrated" rows fall out of the matrix.
    res = await sr.score_session_summary(_summary(tutorId="mikkel", tutorVersion=1), "maps")
    assert res.abstained is True
    assert res.tutor_id == "mikkel" and res.tutor_version == 1


# --- result -> run store ---


def _result(**arm) -> sr.RubricResult:
    return sr.RubricResult(
        sessionId="s-arm",
        activityId="act-1",
        lensId="clarity",
        promptVersion="clarity-r1",
        model="gemini-3.8-flash",
        profile={"physics_approach": {"score": 3}},
        **arm,
    )


def test_run_doc_carries_the_arm():
    run_id = record_rubric_run(
        _result(tutorId="sofie-esru", tutorVersion=2, frameworkId="esru", revision="rev-7", groupId="g-1"),
        group_id=None,
        is_live=True,
    )
    doc = get_document("rubric_runs", run_id)
    assert doc["tutor_id"] == "sofie-esru"
    assert doc["tutor_version"] == 2
    assert doc["framework_id"] == "esru"
    assert doc["revision"] == "rev-7"
    assert doc["group_id"] == "g-1"  # the result's own group when the caller passes none


def test_run_doc_records_unknown_as_null():
    run_id = record_rubric_run(_result(), group_id="g-1", is_live=True)
    doc = get_document("rubric_runs", run_id)
    for key in ("tutor_id", "tutor_version", "framework_id", "revision"):
        assert key in doc and doc[key] is None, key


def test_rescoring_the_same_run_updates_the_arm_in_place():
    first = record_rubric_run(_result(), group_id="g-1", is_live=True)
    second = record_rubric_run(_result(tutorId="sofie-esru", tutorVersion=4), group_id="g-1", is_live=True)
    assert first == second
    runs = list_rubric_runs(group_code="g-1")
    assert len(runs) == 1
    assert runs[0]["tutor_id"] == "sofie-esru" and runs[0]["tutor_version"] == 4


def test_bq_mirror_row_carries_the_arm():
    with patch("observability.chat_log.emit_rubric_run") as emit:
        record_rubric_run(
            _result(tutorId="t", tutorVersion=5, frameworkId="poe", revision="rev-1"), group_id="g", is_live=True
        )
    kw = emit.call_args.kwargs
    assert (kw["tutor_id"], kw["tutor_version"], kw["framework_id"], kw["revision"]) == ("t", 5, "poe", "rev-1")


# --- chat turns (BQ) -> summary ---


def _row(i: int, **kw):
    base = {
        "ts": datetime(2026, 9, 30, 10, 0, i, tzinfo=UTC),
        "group_id": "g",
        "skill_id": "act",
        "role": "tutor" if i % 2 else "student",
        "content": f"t{i}",
        "turn_index": i,
        "framework_id": None,
        "tutor_id": None,
        "tutor_version": None,
        "revision": None,
    }
    base.update(kw)
    return base


@pytest.mark.asyncio
async def test_bq_summary_reads_version_from_the_same_row_as_the_tutor():
    from reports.session_summary import summarize_session_bq

    rows = [
        _row(0, revision="rev-a"),
        _row(1, tutor_id="sofie-poe", tutor_version="1", framework_id="poe", revision="rev-a"),
        _row(2, revision="rev-b"),
        _row(3, tutor_id="sofie-esru", tutor_version="3.0", framework_id="esru", revision="rev-b"),
        _row(4),  # a later unstamped row must not blank the arm
    ]

    def _q(sql, params=None):
        return rows if "session_id = @session_id" in sql and "tutor_version" in sql else []

    with patch("db.bigquery.run_query", side_effect=_q):
        s = await summarize_session_bq("s-1")
    assert s is not None
    assert (s.tutor_id, s.tutor_version, s.revision) == ("sofie-esru", 3, "rev-b")


@pytest.mark.asyncio
async def test_bq_summary_pre_stamp_session_reads_unknown():
    from reports.session_summary import summarize_session_bq

    rows = [_row(0), _row(1)]
    with patch("db.bigquery.run_query", side_effect=lambda sql, params=None: rows if "@session_id" in sql else []):
        s = await summarize_session_bq("s-1")
    assert s is not None
    assert s.tutor_id is None and s.tutor_version is None and s.revision is None


def test_bq_query_reads_new_fields_with_json_value_not_struct_members():
    """A struct-member read of a field the sink has never seen 400s the WHOLE
    query (the chat_turns view's documented failure). tutor_version is new, so
    it must be read with JSON_VALUE or every report on an older table breaks."""
    src = (_BACKEND / "reports" / "session_summary.py").read_text()
    assert "jsonPayload.tutor_version" not in src
    assert "jsonPayload.revision" not in src
    assert "'$.tutor_version'" in src and "'$.revision'" in src


# --- emit side: the tutor's version is stamped on the turn ---


def test_teaching_context_stamps_the_tutor_version(monkeypatch):
    from types import SimpleNamespace

    from adk import tutor_resolution as tr

    # Only .id and .version are read here; the full Tutor model is not the subject.
    tutor = SimpleNamespace(id="sofie-esru", version=7)
    resolution = tr.TeachingResolution(
        tutor=tutor, persona_id="sofie", framework_id="esru", interaction_style="socratic"
    )
    monkeypatch.setattr(tr, "_resolve_for_activity", lambda *a, **k: (resolution, "c-1"))
    monkeypatch.setattr("db.framework_overrides.effective_framework", lambda _fid: None)
    ctx = tr.resolve_teaching_context("act-1")
    assert ctx.tutor_id == "sofie-esru" and ctx.tutor_version == 7


def test_teaching_context_without_a_tutor_has_no_version(monkeypatch):
    from adk import tutor_resolution as tr

    resolution = tr.TeachingResolution(tutor=None, persona_id=None, framework_id=None, interaction_style="socratic")
    monkeypatch.setattr(tr, "_resolve_for_activity", lambda *a, **k: (resolution, None))
    assert tr.resolve_teaching_context("act-1").tutor_version is None


# --- scoring never runs in a student-turn code path ---

_STUDENT_PATH = ["adk", "tools", "channels", "app.py", "protocols/agui.py", "protocols/proactive_routes.py"]
_SCORING_MODULES = {"analytics.session_rubric", "analytics.rubric_runs"}


def _imports(py: Path) -> set[str]:
    tree = ast.parse(py.read_text())
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module)
            found.update(f"{node.module}.{a.name}" for a in node.names)
        elif isinstance(node, ast.Import):
            found.update(a.name for a in node.names)
    return found


def test_scoring_is_never_imported_on_the_student_turn_path():
    """1.1.57 rule, re-asserted after the arm was added (1.1.92 Testing):
    scoring is post-hoc only — nothing on the agent/turn path may reach it."""
    offenders = []
    for rel in _STUDENT_PATH:
        target = _BACKEND / rel
        files = [target] if target.is_file() else sorted(target.rglob("*.py"))
        for f in files:
            if "__pycache__" in f.parts:
                continue
            hit = _imports(f) & _SCORING_MODULES
            if hit:
                offenders.append(f"{f.relative_to(_BACKEND)} -> {sorted(hit)}")
    assert not offenders, offenders
