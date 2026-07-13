"""RUBRIC-2 M3 — the rubric run store (provenance for every score)."""

from __future__ import annotations

import pytest

from analytics.rubric_runs import list_rubric_runs, record_rubric_run
from analytics.session_rubric import RubricResult
from db import firestore as fs_module


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _result(session_id="s-1", lens="maps", version="maps-r1", abstained=False) -> RubricResult:
    return RubricResult(
        sessionId=session_id,
        activityId="act-1",
        lensId=lens,
        promptVersion=version,
        model="gemini-2.5-flash",
        abstained=abstained,
        profile={} if abstained else {"physics_approach": {"score": 3}},
        partitionSummary={"student_initiated": 2, "tutor_prompted": 1},
        evidenceRefs=["doc:d1"],
    )


def test_record_and_read_a_run():
    run_id = record_rubric_run(_result(), group_id="crisp-pebble-21", is_live=True)
    assert run_id == "s-1__maps__maps-r1"  # deterministic
    runs = list_rubric_runs(group_code="crisp-pebble-21")
    assert len(runs) == 1
    assert runs[0]["rubric_id"] == "maps" and runs[0]["is_live"] is True
    assert runs[0]["evidence_refs"] == ["doc:d1"]


def test_rerunning_the_same_version_is_idempotent():
    record_rubric_run(_result(), group_id="g", is_live=True)
    record_rubric_run(_result(), group_id="g", is_live=True)
    assert len(list_rubric_runs(group_code="g")) == 1  # same run_id → one doc


def test_list_filters_by_rubric():
    record_rubric_run(_result(lens="maps", version="maps-r1"), group_id="g", is_live=True)
    record_rubric_run(_result(lens="saar", version="saar-r1"), group_id="g", is_live=True)
    assert {r["rubric_id"] for r in list_rubric_runs(rubric_id="saar")} == {"saar"}
    assert len(list_rubric_runs(group_code="g")) == 2


def test_abstained_runs_are_recorded_too():
    record_rubric_run(_result(abstained=True), group_id="g", is_live=False)
    runs = list_rubric_runs(group_code="g")
    assert runs[0]["abstained"] is True and runs[0]["is_live"] is False
