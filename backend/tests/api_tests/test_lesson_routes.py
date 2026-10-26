"""API tests for the 1.1.139 M1 lesson routes. BigQuery and the model are mocked."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from analytics.framework_fidelity import FidelityResult
from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.classes import create_class
from db.models.class_ import Class
from insights import lessons
from insights.cache import CACHE
from protocols.lesson_routes import router
from reports.narrative import CONCEPTS_VERSION

TEACHER = "teacher-alice"


@pytest.fixture(autouse=True)
def _local(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    CACHE.clear()
    yield
    fs_module._reset_client_for_testing()
    CACHE.clear()


def _row(sid, group):
    ts = datetime.fromisoformat("2026-10-20T08:00:00+00:00")
    return {
        "sessionId": sid,
        "groupCode": group,
        "skillId": "skill-x",
        "activityId": "act-1",
        "frameworkId": "esru",
        "startedAt": ts,
        "lastAt": ts,
        "turns": 8,
    }


@pytest.fixture()
def class_id(monkeypatch):
    cls = Class.create_for_teacher(owner_uid=TEACHER, name="2.g fysik")
    cls.group_codes = ["g1", "g2"]
    create_class(cls)
    monkeypatch.setattr(lessons, "class_sessions", lambda codes, since: [_row("s1", "g1"), _row("s2", "g2")])
    monkeypatch.setattr(lessons, "activity_title", lambda key: "Bølger")
    idx = {
        "s1": SimpleNamespace(
            summary_text="**Next time** Revisit frequency.",
            concepts=[{"key": "frekvens", "label": "Frekvens", "status": "struggled"}],
            concepts_version=CONCEPTS_VERSION,
        ),
        "s2": SimpleNamespace(summary_text="", concepts=None, concepts_version=None),
    }
    monkeypatch.setattr(lessons, "_session_index", lambda sid: idx.get(sid))
    monkeypatch.setattr(
        lessons,
        "_fidelity",
        lambda sid, fw: (
            FidelityResult(
                sessionId=sid,
                frameworkId="esru",
                frameworkLabel="ESRU",
                summary="Elicited first.",
                overallBand="partial",
                constructs={"elicit": {"band": "partial"}},
            )
            if sid == "s1"
            else None
        ),
    )
    return cls.class_id


def _client(*, uid=TEACHER, teacher=True, researcher=False) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", is_teacher=teacher, is_researcher=researcher)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


NO_MODEL = patch("reports.narrative._call_model", new=AsyncMock(side_effect=AssertionError("model called")))


def test_lessons_list(class_id) -> None:
    resp = _client().get(f"/api/insights/classes/{class_id}/lessons")
    assert resp.status_code == 200
    (lesson,) = resp.json()["lessons"]
    assert lesson == {
        "activityId": "act-1",
        "activityTitle": "Bølger",
        "date": "2026-10-20",
        "groups": 2,
        "sessions": 2,
        "turns": 16,
        "startedAt": "2026-10-20T08:00:00+00:00",
        "lastAt": "2026-10-20T08:00:00+00:00",
    }


def test_other_teacher_gets_the_same_404_as_missing(class_id) -> None:
    other = _client(uid="teacher-bob").get(f"/api/insights/classes/{class_id}/lessons")
    missing = _client(uid="teacher-bob").get("/api/insights/classes/nope/lessons")
    assert other.status_code == missing.status_code == 404
    assert other.json() == missing.json()


def test_student_is_refused(class_id) -> None:
    assert _client(uid="anon-g1", teacher=False).get(f"/api/insights/classes/{class_id}/lessons").status_code == 403


def test_cached_synthesis_page_load_makes_no_model_call(class_id) -> None:
    with NO_MODEL:
        resp = _client().get(f"/api/insights/classes/{class_id}/lessons/act-1?date=2026-10-20&synthesis=cached")
    assert resp.status_code == 200
    body = resp.json()
    assert body["synthesis"] is None
    assert body["concepts"][0]["label"] == "Frekvens"
    assert body["coverage"]["pendingSessions"] == 1
    # Teacher view: prose, coverage — no bands (1.1.65 R1).
    assert "bands" not in body["approach"]
    assert body["approach"]["coverage"]["assessed"] == 1


def test_researcher_sees_bands(class_id) -> None:
    with NO_MODEL:
        body = (
            _client(uid="researcher-rae", researcher=True)
            .get(f"/api/insights/classes/{class_id}/lessons/act-1?date=2026-10-20&synthesis=cached")
            .json()
        )
    assert body["approach"]["bands"] == {"elicit": {"partial": 1}}


def test_default_read_synthesises_once(class_id) -> None:
    llm = AsyncMock(return_value='{"approach": "Mostly elicited.", "nextTime": "Revisit frequency."}')
    with patch("reports.narrative._call_model", new=llm):
        c = _client()
        a = c.get(f"/api/insights/classes/{class_id}/lessons/act-1?date=2026-10-20").json()
        b = c.get(f"/api/insights/classes/{class_id}/lessons/act-1?date=2026-10-20").json()
    assert a["synthesis"]["nextTime"] == b["synthesis"]["nextTime"] == "Revisit frequency."
    llm.assert_awaited_once()


def test_unknown_lesson_is_404(class_id) -> None:
    with NO_MODEL:
        assert _client().get(f"/api/insights/classes/{class_id}/lessons/act-9?date=2026-10-20").status_code == 404
    assert _client().get(f"/api/insights/classes/{class_id}/lessons/act-1?date=yesterday").status_code == 422


def test_summarise_runs_only_the_pending_sessions(class_id, monkeypatch) -> None:
    seen: list[list[str]] = []

    async def fake(ids, **_kw):
        seen.append(ids)
        return {"requested": len(ids), "summarised": len(ids), "failed": 0, "remaining": 0}

    monkeypatch.setattr(lessons, "summarise_sessions", fake)
    resp = _client().post(f"/api/insights/classes/{class_id}/lessons/act-1/summarise?date=2026-10-20")
    assert resp.status_code == 200
    assert seen == [["s2"]]


def test_summarise_refused_for_another_teacher(class_id) -> None:
    resp = _client(uid="teacher-bob").post(f"/api/insights/classes/{class_id}/lessons/act-1/summarise?date=2026-10-20")
    assert resp.status_code == 404
