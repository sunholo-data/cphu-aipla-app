"""RUBRIC-1 — /api/research lens routes.

Headline: RESEARCHER-ONLY, R1-quarantined. A plain teacher gets an
enumeration-resistant 404 on every route; prompt edits bump the version so
stored scores stay interpretable.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth.access_context import build_access_context
from auth.firebase_auth import User, get_current_user
from db import firestore as fs_module
from db.firestore import get_document, set_document
from protocols.research_lens_routes import router


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


RESEARCHER = User(uid="r-1", is_researcher=True)
TEACHER = User(uid="t-1")


# --- the gate ---


def test_every_route_404s_for_a_plain_teacher():
    c = _client(TEACHER)
    assert c.get("/api/research/lens-configs").status_code == 404
    assert c.put("/api/research/lens-configs/maps", json={"enabled": False}).status_code == 404
    assert c.post("/api/research/rubric-score", json={"sessionId": "s", "lens": "maps"}).status_code == 404
    assert c.get("/api/research/anchor-packs/act-1/validate").status_code == 404


# --- lens configs (M3 backend) ---


def test_researcher_reads_effective_configs():
    body = _client(RESEARCHER).get("/api/research/lens-configs").json()
    ids = {lens["lens_id"] for lens in body["lenses"]}
    assert {"maps", "saar"} <= ids


def test_put_prompt_override_bumps_version_and_merges():
    c = _client(RESEARCHER)
    res = c.put("/api/research/lens-configs/maps", json={"promptOverride": "Stricter judge."})
    assert res.status_code == 200
    lens = res.json()["lens"]
    assert lens["prompt_override"] == "Stricter judge."
    assert lens["prompt_version"] == "maps-r2"
    # a second prompt edit bumps again; enabled-only edits do NOT bump
    c.put("/api/research/lens-configs/maps", json={"promptOverride": "Even stricter."})
    assert c.get("/api/research/lens-configs").json()["lenses"][0]["prompt_version"] in {"maps-r3"}
    c.put("/api/research/lens-configs/maps", json={"enabled": False})
    lens = next(x for x in c.get("/api/research/lens-configs").json()["lenses"] if x["lens_id"] == "maps")
    assert lens["prompt_version"] == "maps-r3" and lens["enabled"] is False
    assert get_document("analytics_lens_configs", "maps")["updated_by"] == "r-1"


def test_put_null_override_resets_to_default_but_still_bumps():
    c = _client(RESEARCHER)
    c.put("/api/research/lens-configs/maps", json={"promptOverride": "X"})
    res = c.put("/api/research/lens-configs/maps", json={"promptOverride": None})
    lens = res.json()["lens"]
    assert lens["prompt_override"] is None
    assert lens["prompt_version"] == "maps-r3"


def test_put_unknown_lens_is_400():
    assert _client(RESEARCHER).put("/api/research/lens-configs/bogus", json={"enabled": True}).status_code == 400


# --- scoring (M1) ---


def test_rubric_score_returns_the_result(monkeypatch):
    from analytics.session_rubric import RubricResult

    async def _fake(session_id: str, lens: str):
        return RubricResult(
            sessionId=session_id,
            activityId="act-1",
            lensId=lens,
            promptVersion="maps-r1",
            model="gemini-2.5-flash",
            abstained=True,
            abstainReason="uncalibrated: no anchor pack",
            partitionSummary={"student_initiated": 2, "tutor_prompted": 3},
        )

    monkeypatch.setattr("protocols.research_lens_routes.score_session", _fake)
    res = _client(RESEARCHER).post("/api/research/rubric-score", json={"sessionId": "s-9", "lens": "maps"})
    assert res.status_code == 200
    body = res.json()
    assert body["abstained"] is True and body["partitionSummary"]["tutor_prompted"] == 3


def test_rubric_score_unknown_lens_400_and_missing_session_404(monkeypatch):
    async def _none(session_id: str, lens: str):
        return None

    monkeypatch.setattr("protocols.research_lens_routes.score_session", _none)
    c = _client(RESEARCHER)
    assert c.post("/api/research/rubric-score", json={"sessionId": "s", "lens": "bogus"}).status_code == 400
    assert c.post("/api/research/rubric-score", json={"sessionId": "gone", "lens": "maps"}).status_code == 404


# --- anchor lint (M1) ---


def test_anchor_validate_reports_the_calibration_gaps():
    set_document(
        "rubric_anchor_packs",
        "act-1",
        {"anchors": [{"solution": "s", "scores": {"physics_approach": 3}, "rationale": "r"}] * 3},
    )
    body = _client(RESEARCHER).get("/api/research/anchor-packs/act-1/validate").json()
    assert body["ok"] is False
    assert any("floor" in p for p in body["problems"])
    assert any("NA(solver)" in p for p in body["problems"])


def test_anchor_validate_passes_a_complete_pack():
    anchors = [{"solution": f"s{i}", "scores": {"physics_approach": i}, "rationale": "r"} for i in range(5)]
    anchors[0]["scores"] = {"mathematical_procedures": "NA_solver"}
    set_document("rubric_anchor_packs", "act-1", {"anchors": anchors})
    body = _client(RESEARCHER).get("/api/research/anchor-packs/act-1/validate").json()
    assert body == {"activityId": "act-1", "ok": True, "anchors": 5, "problems": []}
