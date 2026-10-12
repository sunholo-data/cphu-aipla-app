"""Researcher corrections → a calibration set for the judge (1.1.148, M 2026-10-08).

Shared + calibration set: every researcher's current review becomes a labelled
example, with agreement stats. Read-only — a review still changes no judgement.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from analytics import calibration_set as cs
from auth import User, get_current_user
from db import firestore as fs_module
from db import rubric_reviews as rr
from db.firestore import get_document, set_document
from protocols.rubric_review_routes import router

RUN_ID = "s-1__fidelity:toulmin__fidelity-r3_fw2"

RESEARCHER = User(uid="r-1", email="r@ku.dk", domain="ku.dk", is_teacher=True, is_researcher=True)
RESEARCHER_2 = User(uid="r-2", email="r2@ku.dk", domain="ku.dk", is_teacher=True, is_researcher=True)
TEACHER = User(uid="t-1", email="t@ku.dk", domain="ku.dk", is_teacher=True)


def _run() -> dict[str, Any]:
    return {
        "run_id": RUN_ID,
        "rubric_id": "fidelity:toulmin",
        "rubric_version": "fidelity-r3+fw2",
        "session_id": "s-1",
        "group_id": "woody-beetle-71",
        "model": "gemini-2.5-pro",
        "framework_id": "toulmin",
        "profile": {
            "frameworkId": "toulmin",
            "promptVersion": "fidelity-r3",
            "criteriaVersion": "2",
            "model": "gemini-2.5-pro",
            "overallBand": "partial",
            "summary": "Asked for data, never for a warrant.",
            "drift": [],
            "scoredAt": "2026-10-05T09:47:00+00:00",
            "constructs": {
                "data": {
                    "band": "partial",
                    "rationale": "Asked for the measurements once.",
                    "evidence": [{"turn": 98, "quote": "skarp observation", "verified": True}],
                    "moves": ["data.ask"],
                },
                "warrant": {"band": "absent", "rationale": "", "evidence": [], "moves": []},
            },
        },
    }


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    set_document("rubric_runs", RUN_ID, _run())
    yield
    fs_module._reset_client_for_testing()


def _review(**over):
    kw = {
        "construct_key": "data",
        "band": "strong",
        "evidence": [98, 106],
        "reason": "The tutor asked for the bounce heights twice.",
        "reviewer_uid": "r-1",
        "reviewer_email": "r@ku.dk",
    }
    kw.update(over)
    return rr.create_review(RUN_ID, **kw)


# ── the snapshot now carries the judge's provenance ──────────────────────────


def test_a_review_snapshots_which_judge_it_corrected():
    judged = _review()["judged"]
    assert judged["model"] == "gemini-2.5-pro"
    assert judged["promptVersion"] == "fidelity-r3"
    assert judged["criteriaVersion"] == "2"
    assert judged["frameworkId"] == "toulmin"


# ── rows ─────────────────────────────────────────────────────────────────────


def test_one_row_per_reviewed_construct_with_everything_a_calibration_needs():
    review = _review()
    out = cs.load_calibration_set()
    assert len(out["rows"]) == 1
    row = out["rows"][0]
    assert row["reviewId"] == review["review_id"]
    assert row["sessionId"] == "s-1"
    assert row["frameworkId"] == "toulmin"
    assert row["construct"] == "data"
    assert row["aiBand"] == "partial" and row["researcherBand"] == "strong"
    assert row["agrees"] is False and row["direction"] == "researcher_higher"
    assert row["aiCitations"] == [{"turn": 98, "quote": "skarp observation", "verified": True}]
    assert row["aiRationale"] == "Asked for the measurements once."
    assert row["researcherEvidence"] == [98, 106]
    assert row["researcherRationale"] == "The tutor asked for the bounce heights twice."
    assert (row["promptVersion"], row["criteriaVersion"], row["model"]) == ("fidelity-r3", "2", "gemini-2.5-pro")
    assert row["modelSource"] == "judged-snapshot"
    assert row["reviewerUid"] == "r-1"
    assert "reviewer_email" not in row and "reviewerEmail" not in row  # uid only, as in BigQuery


def test_the_ai_band_is_the_one_the_reviewer_saw_not_the_rescored_run():
    _review()
    rescored = _run()
    rescored["profile"]["constructs"]["data"]["band"] = "strong"
    set_document("rubric_runs", RUN_ID, rescored)
    row = cs.load_calibration_set()["rows"][0]
    assert row["aiBand"] == "partial"  # the snapshot, not the run as it stands now


def test_a_superseded_review_is_dropped_but_a_second_reviewer_is_kept():
    first = _review(band="strong")
    _review(band="absent", reason="Re-read: no data was asked for.", supersedes=first["review_id"])
    _review(band="partial", reason="I agree with the judge here.", reviewer_uid="r-2", reviewer_email="r2@ku.dk")
    rows = cs.load_calibration_set()["rows"]
    assert {(r["reviewerUid"], r["researcherBand"]) for r in rows} == {("r-1", "absent"), ("r-2", "partial")}
    stats = cs.load_calibration_set()["stats"]
    assert stats["multiRated"] == 1 and stats["reviewers"] == 2


def test_an_older_review_without_a_model_in_its_snapshot_falls_back_to_the_run_and_says_so():
    review = _review()
    old = {**review, "judged": {k: v for k, v in review["judged"].items() if k != "model"}}
    out = cs.build_calibration_set([old], {RUN_ID: _run()})
    assert out["rows"][0]["model"] == "gemini-2.5-pro"
    assert out["rows"][0]["modelSource"] == "run-current"
    gone = cs.build_calibration_set([old], {RUN_ID: None})
    assert gone["rows"][0]["model"] is None and gone["rows"][0]["modelSource"] is None


def test_r2_bare_id_citations_and_version_strings():
    assert cs.split_rubric_version("fidelity-r3+fw2") == ("fidelity-r3", "2")
    assert cs.split_rubric_version("fidelity-r3+fwyaml") == ("fidelity-r3", "yaml")
    assert cs.split_rubric_version("fidelity-r2") == ("fidelity-r2", None)
    assert cs.split_rubric_version("") == (None, None)
    assert cs.framework_of("fidelity:toulmin") == "toulmin"
    assert cs.framework_of("framework_fit") is None
    row = cs.calibration_row(
        {
            "review_id": "x",
            "rubric_id": "fidelity:esru",
            "rubric_version": "fidelity-r2",
            "construct_key": "elicit",
            "band": "partial",
            "judged": {"band": "partial", "evidence": [4, 7]},
        },
        None,
    )
    assert row["aiCitations"] == [
        {"turn": 4, "quote": None, "verified": None},
        {"turn": 7, "quote": None, "verified": None},
    ]
    assert row["agrees"] is True and row["frameworkId"] == "esru"


# ── stats ────────────────────────────────────────────────────────────────────


def _row(fw: str, construct: str, ai: str | None, human: str, uid: str = "r-1") -> dict[str, Any]:
    return cs.calibration_row(
        {
            "review_id": f"{fw}{construct}{ai}{human}{uid}",
            "run_id": f"run-{fw}",
            "rubric_id": f"fidelity:{fw}",
            "construct_key": construct,
            "band": human,
            "judged": {"band": ai},
            "reviewer_uid": uid,
        },
        None,
    )


def test_agreement_is_computed_per_construct_and_per_framework():
    rows = [
        _row("toulmin", "data", "partial", "partial"),
        _row("toulmin", "data", "partial", "strong", uid="r-2"),
        _row("toulmin", "warrant", "strong", "absent"),
        _row("esru", "elicit", "absent", "absent"),
        _row("esru", "overall", None, "partial"),  # an abstained judge: not comparable
    ]
    stats = cs.agreement_stats(rows)
    data = stats["byConstruct"]["toulmin"]["data"]
    assert (data["n"], data["agree"], data["agreement"]) == (2, 1, 0.5)
    assert data["researcherHigher"] == 1 and data["confusion"] == {"partial->partial": 1, "partial->strong": 1}
    assert stats["byConstruct"]["toulmin"]["warrant"]["researcherLower"] == 1
    assert stats["byFramework"]["toulmin"]["agreement"] == pytest.approx(0.333, abs=1e-3)
    esru = stats["byFramework"]["esru"]
    assert (esru["n"], esru["unknown"], esru["agreement"]) == (2, 1, 1.0)
    assert stats["byConstruct"]["esru"]["overall"]["agreement"] is None  # nothing comparable is not 0%
    assert stats["overall"]["n"] == 5


def test_an_empty_set_has_no_agreement_rather_than_zero():
    out = cs.build_calibration_set([], {})
    assert out["rows"] == [] and out["stats"]["overall"]["agreement"] is None


def test_the_framework_filter():
    _review()
    assert len(cs.load_calibration_set("toulmin")["rows"]) == 1
    assert cs.load_calibration_set("esru")["rows"] == []


def test_an_unreadable_store_raises_instead_of_reading_as_no_corrections():
    def boom() -> list[dict[str, Any]]:
        raise RuntimeError("PERMISSION_DENIED")

    with pytest.raises(RuntimeError):
        cs.load_calibration_set(read_reviews=boom)


def test_building_the_set_changes_no_judgement():
    _review()
    before = get_document("rubric_runs", RUN_ID)
    cs.load_calibration_set()
    assert get_document("rubric_runs", RUN_ID) == before
    assert len(rr.list_reviews(RUN_ID)) == 1


# ── the route: researcher-only ───────────────────────────────────────────────


def _client(user: User | None) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_a_researcher_reads_the_calibration_set():
    _review()
    body = _client(RESEARCHER_2).get("/api/research/calibration-set").json()
    assert body["format"] == cs.CALIBRATION_FORMAT
    assert len(body["rows"]) == 1  # shared: r-2 sees r-1's correction
    assert body["stats"]["byConstruct"]["toulmin"]["data"]["n"] == 1
    filtered = _client(RESEARCHER).get("/api/research/calibration-set", params={"framework": "esru"}).json()
    assert filtered["rows"] == [] and filtered["frameworkId"] == "esru"


def test_a_teacher_is_refused_the_calibration_set():
    _review()
    assert _client(TEACHER).get("/api/research/calibration-set").status_code == 403


def test_a_real_group_token_through_the_real_dispatcher_is_refused_the_calibration_set():
    """No dependency override: a REAL minted student token goes through the real
    ``auth`` dispatcher, is accepted as a valid student, and is refused by the
    researcher gate before any read."""
    from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group

    _review()
    AnonymousGroupAuth.reset_for_tests()
    try:
        record = create_group(title="T3 class", skill_ids=["concept-dialogue"], creator_uid="t-1")
        token = join_group(record.group_id, client_ip="203.0.113.7").token
        resp = _client(None).get("/api/research/calibration-set", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403, resp.text
        assert "rows" not in resp.text
    finally:
        AnonymousGroupAuth.reset_for_tests()


# ── the script: read-only, writes a local JSONL ──────────────────────────────

_SPEC = importlib.util.spec_from_file_location(
    "export_calibration_set",
    Path(__file__).resolve().parents[2] / "scripts" / "export_calibration_set.py",
)
script = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = script
_SPEC.loader.exec_module(script)  # type: ignore[union-attr]


class _Snap:
    def __init__(self, data: dict[str, Any] | None):
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return self._data


class _Doc:
    def __init__(self, data: dict[str, Any] | None):
        self._data = data

    def get(self) -> _Snap:
        return _Snap(self._data)

    def set(self, *_a: Any, **_k: Any) -> None:  # pragma: no cover - must never be called
        raise AssertionError("the export must not write")


class _Coll:
    def __init__(self, docs: dict[str, dict[str, Any]]):
        self._docs = docs

    def stream(self) -> list[_Snap]:
        return [_Snap(d) for d in self._docs.values()]

    def document(self, doc_id: str) -> _Doc:
        return _Doc(self._docs.get(doc_id))


class _FakeClient:
    def __init__(self, data: dict[str, dict[str, dict[str, Any]]]):
        self._data = data

    def collection(self, name: str) -> _Coll:
        return _Coll(self._data.get(name, {}))


def test_the_script_writes_one_jsonl_line_per_row(tmp_path, capsys):
    review = _review()
    client = _FakeClient({"rubric_reviews": {review["review_id"]: review}, "rubric_runs": {RUN_ID: _run()}})
    out = tmp_path / "cal.jsonl"
    assert script.main(["--env", "dev", "--out", str(out)], client=client) == 0
    lines = out.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["researcherBand"] == "strong"
    printed = capsys.readouterr().out
    assert "1 rows" in printed and "toulmin" in printed and "data: n=1 agreement=0%" in printed
