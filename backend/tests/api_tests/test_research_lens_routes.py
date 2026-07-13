"""RUBRIC-1 — /api/research lens routes.

Headline: RESEARCHER-ONLY, R1-quarantined. A plain teacher gets an
enumeration-resistant 404 on every route; prompt edits bump the version so
stored scores stay interpretable.
"""

from __future__ import annotations

from datetime import UTC, datetime

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

    async def _fake(target: str, lens: str):
        return RubricResult(
            sessionId=target,
            activityId="act-1",
            lensId=lens,
            promptVersion="maps-r1",
            model="gemini-2.5-flash",
            abstained=True,
            abstainReason="uncalibrated: no anchor pack",
            partitionSummary={"student_initiated": 2, "tutor_prompted": 3},
        )

    monkeypatch.setattr("protocols.research_lens_routes.score_target", _fake)
    res = _client(RESEARCHER).post("/api/research/rubric-score", json={"sessionId": "s-9", "lens": "maps"})
    assert res.status_code == 200
    body = res.json()
    assert body["abstained"] is True and body["partitionSummary"]["tutor_prompted"] == 3


def test_rubric_score_accepts_a_group_code(monkeypatch):
    """Researchers address by group code; the route resolves it to a session."""
    from analytics.session_rubric import RubricResult

    seen: dict = {}

    async def _fake(target: str, lens: str):
        seen["target"] = target
        return RubricResult(
            sessionId="resolved-uuid", activityId="act-1", lensId=lens, promptVersion="maps-r1", model="m"
        )

    monkeypatch.setattr("protocols.research_lens_routes.score_target", _fake)
    res = _client(RESEARCHER).post("/api/research/rubric-score", json={"groupCode": "crisp-pebble-21", "lens": "maps"})
    assert res.status_code == 200
    assert seen["target"] == "crisp-pebble-21"
    assert res.json()["sessionId"] == "resolved-uuid"


def test_rubric_score_unknown_lens_400_and_missing_target_404(monkeypatch):
    async def _none(target: str, lens: str):
        return None

    monkeypatch.setattr("protocols.research_lens_routes.score_target", _none)
    c = _client(RESEARCHER)
    assert c.post("/api/research/rubric-score", json={"sessionId": "s", "lens": "bogus"}).status_code == 400
    # a session id that won't resolve → generic "session not found"
    assert c.post("/api/research/rubric-score", json={"sessionId": "gone", "lens": "maps"}).status_code == 404
    # neither target nor session id → 400
    assert c.post("/api/research/rubric-score", json={"lens": "maps"}).status_code == 400


def test_rubric_score_group_with_no_sessions_404s_with_a_clear_reason(monkeypatch):
    async def _none(target: str, lens: str):
        return None

    # a group-code-shaped target that resolves to zero sessions
    monkeypatch.setattr("protocols.research_lens_routes.score_target", _none)
    monkeypatch.setattr("protocols.research_lens_routes.resolve_target", lambda t: [])
    res = _client(RESEARCHER).post("/api/research/rubric-score", json={"groupCode": "crisp-pebble-99", "lens": "maps"})
    assert res.status_code == 404
    assert "no sessions found for group" in res.json()["detail"]


# --- free-form rubrics (RUBRIC-2 M1) ---


def test_rubrics_crud_is_researcher_gated():
    c = _client(TEACHER)
    assert c.get("/api/research/rubrics").status_code == 404
    assert (
        c.put("/api/research/rubrics/clarity", json={"label": "x", "prompt": "p", "outputKeys": ["a"]}).status_code
        == 404
    )


def test_create_and_list_a_free_form_rubric():
    c = _client(RESEARCHER)
    res = c.put(
        "/api/research/rubrics/clarity",
        json={
            "label": "Clarity",
            "prompt": "Judge clarity.",
            "outputKeys": ["clarity", "precision"],
            "scoreScale": "0-4",
        },
    )
    assert res.status_code == 200
    rub = res.json()["rubric"]
    assert rub["lens_id"] == "clarity" and rub["is_seed"] is False
    assert rub["output_keys"] == ["clarity", "precision"]
    assert rub["prompt_version"] == "clarity-r1"
    # it now shows up in the union list alongside the seeds
    ids = {r["lens_id"] for r in c.get("/api/research/rubrics").json()["rubrics"]}
    assert {"maps", "saar", "clarity"} <= ids


def test_editing_a_rubric_prompt_bumps_the_version():
    c = _client(RESEARCHER)
    c.put("/api/research/rubrics/clarity", json={"label": "C", "prompt": "P1", "outputKeys": ["a"]})
    res = c.put("/api/research/rubrics/clarity", json={"label": "C", "prompt": "P2-edited", "outputKeys": ["a"]})
    assert res.json()["rubric"]["prompt_version"] == "clarity-r2"


def test_cannot_create_a_rubric_shadowing_a_seed_lens():
    res = _client(RESEARCHER).put("/api/research/rubrics/maps", json={"label": "x", "prompt": "p", "outputKeys": ["a"]})
    assert res.status_code == 400
    assert "seed lens" in res.json()["detail"]


def test_get_unknown_rubric_404s():
    assert _client(RESEARCHER).get("/api/research/rubrics/nope").status_code == 404


def test_score_a_free_form_rubric_end_to_end(monkeypatch):
    """A rubric created via the API is scoreable via rubric-score with no code change."""
    c = _client(RESEARCHER)
    c.put("/api/research/rubrics/clarity", json={"label": "C", "prompt": "Judge clarity.", "outputKeys": ["clarity"]})

    async def _fake_judge(prompt: str, model: str) -> str:
        return '{"clarity": {"score": 4, "rationale": "crisp"}}'

    # score through the real score_target → score_session_summary path, stubbing
    # only the model call and the session resolution.
    from reports.session_summary import SessionSummary, SessionTurn

    async def _resolve(session_id: str):
        return SessionSummary(
            sessionId=session_id,
            groupCode="grp",
            activityId="act-1",
            startedAt=datetime.now(UTC),
            durationSeconds=1,
            messageCount=1,
            simRunCount=0,
            conversation=[SessionTurn(timestamp="2026-07-13T10:00:00Z", role="student", content="min forklaring")],
        )

    monkeypatch.setattr("analytics.session_rubric._call_judge_model", _fake_judge)
    monkeypatch.setattr("reports.session_summary.resolve_session_summary", _resolve)
    res = c.post("/api/research/rubric-score", json={"sessionId": "s-1", "rubric": "clarity"})
    assert res.status_code == 200
    body = res.json()
    assert body["abstained"] is False and body["profile"]["clarity"]["score"] == 4


# --- versioning + run store (RUBRIC-2 M3) ---


def test_promote_endpoint_sets_the_live_version():
    c = _client(RESEARCHER)
    c.put("/api/research/rubrics/clarity", json={"label": "C", "prompt": "P1", "outputKeys": ["a"]})
    c.put("/api/research/rubrics/clarity", json={"label": "C", "prompt": "P2", "outputKeys": ["a"]})
    res = c.post("/api/research/rubrics/clarity/promote", json={"version": "2"})
    assert res.status_code == 200
    assert res.json()["rubric"]["prompt_version"] == "clarity-r2"


def test_promote_seed_lens_is_400():
    assert _client(RESEARCHER).post("/api/research/rubrics/maps/promote", json={"version": "1"}).status_code == 400


def test_promote_unknown_rubric_is_404():
    assert _client(RESEARCHER).post("/api/research/rubrics/ghost/promote", json={"version": "1"}).status_code == 404


def test_rubric_runs_endpoint_lists_records():
    from analytics.rubric_runs import record_rubric_run
    from analytics.session_rubric import RubricResult

    record_rubric_run(
        RubricResult(sessionId="s-1", activityId="a", lensId="maps", promptVersion="maps-r1", model="m"),
        group_id="crisp-pebble-21",
        is_live=True,
    )
    body = _client(RESEARCHER).get("/api/research/rubric-runs", params={"groupCode": "crisp-pebble-21"}).json()
    assert len(body["runs"]) == 1 and body["runs"][0]["rubric_id"] == "maps"


def test_rubric_runs_endpoint_is_researcher_gated():
    assert _client(TEACHER).get("/api/research/rubric-runs").status_code == 404


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
