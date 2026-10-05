"""1.1.146 — revoking a join code must not orphan the evidence.

The bug this witnesses, from prod (teacher seminar 2026-10-05): a teacher tidied
up her class's join codes the morning after a lesson, and a researcher could no
longer review the sessions those codes produced. The conversations were intact
in BigQuery. ``revoke_group_code`` had removed the code from ``groupCodes`` and
hard-deleted ``anon_groups/<code>`` — the only code → class binding — so every
class-anchored review surface (class page, recent sessions, insights, the
owner's group timeline) silently lost the group. M's requirement: *"we want to
analyse sessions even after they are revoked."*

The fixed contract — **Revoke ends access; it never touches evidence**:

  (i)   the revoked code's outstanding token is refused at its next request
        (401), including on an instance that never saw the revoke;
  (ii)  the class still carries the code, for the owner AND for a researcher,
        and ``recent-sessions`` still returns the group's session;
  (iii) the owner's group timeline is 200, not 404 (the binding survives);
  (iv)  insights ``class_kpis`` still counts the group.

Real tokens through the REAL dispatcher (CLAUDE.md, dual-auth row): the student
token is minted by ``join_group`` exactly as ``POST /api/auth/group/join`` does,
and the teacher/researcher is the LOCAL_MODE stub token — no
``dependency_overrides`` of ``get_current_user`` anywhere in this file. The one
stub is the BigQuery read, at the ``analytics`` boundary, serving the turn this
test emitted (the ``test_research_logs_routes.py`` pattern).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth.group_id_auth import AnonymousGroupAuth, _synthesize_uid, join_group
from auth.local_mode_stub import STUB_TOKEN, WORKSHOP_USER_UID
from db import firestore as fs_module

ACTIVITY = "act-energi"
SESSION_ID = "sess-revoked-1"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    monkeypatch.delenv("LOCAL_MODE_RESEARCHER", raising=False)
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


@pytest.fixture()
def client() -> TestClient:
    from protocols.activity_config_routes import router as activity_config_router
    from protocols.classes_routes import router as classes_router
    from protocols.research_logs_routes import router as research_logs_router

    app = FastAPI()
    app.include_router(classes_router)
    app.include_router(activity_config_router)
    app.include_router(research_logs_router)
    return TestClient(app)


STAFF = {"Authorization": f"Bearer {STUB_TOKEN}"}


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_class(owner_uid: str) -> str:
    from db.classes import create_class
    from db.models.class_ import Class

    cls = Class.create_for_teacher(owner_uid=owner_uid, name="Fysik C - Energi")
    create_class(cls)
    return cls.class_id


def _emit_turn(code: str) -> list[dict]:
    """What a student turn leaves behind: the Firestore session index (read by
    recent-sessions) and a BigQuery chat-turn row (read by the timeline and the
    insights queries — served by the stubs below)."""
    from db.chat_sessions import create_session_index
    from db.models.access import AccessControl

    create_session_index(
        session_id=SESSION_ID,
        skill_id="concept-dialogue",
        owner_uid=_synthesize_uid(code),
        access_control=AccessControl(type="private"),
        group_code=code,
    )
    return [
        {
            "kind": "turn",
            "session_id": SESSION_ID,
            "group_id": code,
            "role": "student",
            "text": "Hvorfor bevares energien?",
            "ts": datetime.now(UTC).isoformat(),
        }
    ]


def _stub_bigquery(monkeypatch, rows: list[dict]) -> None:
    """Serve the emitted rows through the two read paths under test."""
    from analytics import queries, research_logs

    def _timeline(session_id: str, *, group_id: str | None = None) -> dict:
        items = [r for r in rows if r["session_id"] == session_id and (group_id is None or r["group_id"] == group_id)]
        return {"items": items, "workStatus": "ok"}

    monkeypatch.setattr(research_logs, "session_timeline", _timeline)

    def _scoped(class_group_codes, allowed_group_codes):
        return [r for r in rows if r["group_id"] in class_group_codes and r["group_id"] in allowed_group_codes]

    def _count(*, class_group_codes, allowed_group_codes, **_):
        hit = _scoped(class_group_codes, allowed_group_codes)
        groups = sorted({r["group_id"] for r in hit})
        return {
            "total": len(hit),
            "per_group": [{"group_code": g, "count": sum(r["group_id"] == g for r in hit)} for g in groups],
        }

    monkeypatch.setattr(queries, "count_messages", _count)
    monkeypatch.setattr(queries, "time_on_task", lambda **_: {"per_group": []})
    monkeypatch.setattr(queries, "sim_runs_per_skill", lambda **_: {"per_skill": [], "total": 0})
    monkeypatch.setattr(queries, "most_active_groups", lambda **_: {"groups": []})


def _mint_and_join(client: TestClient, class_id: str) -> tuple[str, str]:
    resp = client.post(f"/api/classes/{class_id}/groups", json={"count": 1}, headers=STAFF)
    assert resp.status_code == 201, resp.text
    code = resp.json()["codes"][0]
    token = join_group(code, client_ip="203.0.113.7").token
    # The token works before the revoke — so the 401 below is the revoke.
    ok = client.get(f"/api/activity-configs/active/{ACTIVITY}", headers=_bearer(token))
    assert ok.status_code == 200, ok.text
    return code, token


def test_owner_keeps_every_route_to_a_revoked_codes_sessions(client, monkeypatch):
    class_id = _create_class(WORKSHOP_USER_UID)
    code, token = _mint_and_join(client, class_id)
    rows = _emit_turn(code)
    _stub_bigquery(monkeypatch, rows)

    resp = client.delete(f"/api/classes/{class_id}/groups/{code}", headers=STAFF)
    assert resp.status_code == 200, resp.text

    # (i) the outstanding token is refused at its next request …
    after = client.get(f"/api/activity-configs/active/{ACTIVITY}", headers=_bearer(token))
    assert after.status_code == 401
    # … and on an instance that never saw the revoke (only the tombstone).
    AnonymousGroupAuth.reset_for_tests()
    elsewhere = client.get(f"/api/activity-configs/active/{ACTIVITY}", headers=_bearer(token))
    assert elsewhere.status_code == 401

    # (ii) the class still carries the code, marked revoked …
    cls = client.get(f"/api/classes/{class_id}", headers=STAFF).json()
    assert code in cls["groupCodes"]
    assert cls["revokedGroupCodes"] == [code]
    # … and its session is still on the class page.
    recent = client.get(f"/api/classes/{class_id}/recent-sessions", headers=STAFF).json()["sessions"]
    assert [s["sessionId"] for s in recent] == [SESSION_ID]

    # (iii) the owner's timeline: 200, not the 404 a deleted binding produced.
    tl = client.get(f"/api/research/logs/groups/{code}/sessions/{SESSION_ID}/timeline", headers=STAFF)
    assert tl.status_code == 200, tl.text
    assert tl.json()["items"][0]["text"] == "Hvorfor bevares energien?"

    # (iv) insights still counts the group — not a smaller, plausible number.
    from auth.local_mode_stub import build_workshop_user
    from insights.aggregates import class_kpis

    until = datetime.now(UTC) + timedelta(minutes=1)
    kpis = class_kpis(user=build_workshop_user(), class_id=class_id, since=until - timedelta(days=7), until=until)
    assert kpis["kpis"]["active_groups"] == 1
    assert kpis["kpis"]["total_messages"] == 1


def test_researcher_still_reviews_another_teachers_revoked_code(client, monkeypatch):
    """The reported case: the researcher is not the owner."""
    from db.classes import mint_group_codes_under_class, revoke_group_code

    class_id = _create_class("teacher-ar")
    code = mint_group_codes_under_class(class_id, count=1)[0]
    rows = _emit_turn(code)
    _stub_bigquery(monkeypatch, rows)
    revoke_group_code(class_id, code, revoked_by="teacher-ar")

    # Not the owner: a plain teacher sees nothing (enumeration-resistant 404).
    assert client.get(f"/api/classes/{class_id}", headers=STAFF).status_code == 404

    monkeypatch.setenv("LOCAL_MODE_RESEARCHER", "1")
    cls = client.get(f"/api/classes/{class_id}", headers=STAFF).json()
    assert code in cls["groupCodes"]
    assert cls["revokedGroupCodes"] == [code]
    recent = client.get(f"/api/classes/{class_id}/recent-sessions", headers=STAFF).json()["sessions"]
    assert [s["sessionId"] for s in recent] == [SESSION_ID]
    tl = client.get(f"/api/research/logs/groups/{code}/sessions/{SESSION_ID}/timeline", headers=STAFF)
    assert tl.status_code == 200, tl.text


def test_live_signals_skip_a_revoked_code(client, monkeypatch):
    """The live dashboard is the one class view that SHOULD drop it."""
    seen: list[list[str]] = []

    def _signals(codes):
        seen.append(list(codes))
        return []

    import analytics.live_class as live_class

    monkeypatch.setattr(live_class, "compute_group_signals", _signals)

    class_id = _create_class(WORKSHOP_USER_UID)
    codes = client.post(f"/api/classes/{class_id}/groups", json={"count": 2}, headers=STAFF).json()["codes"]
    client.delete(f"/api/classes/{class_id}/groups/{codes[0]}", headers=STAFF)

    resp = client.get(f"/api/classes/{class_id}/live", headers=STAFF)
    assert resp.status_code == 200, resp.text
    assert seen == [[codes[1]]]


def test_researcher_class_list_keeps_a_class_its_teacher_deleted(client, monkeypatch):
    """M4 — a deleted class is still evidence; it stays listed, marked."""
    from db.classes import revoke_class

    class_id = _create_class("teacher-ar")
    revoke_class(class_id)

    monkeypatch.setenv("LOCAL_MODE_RESEARCHER", "1")
    rows = client.get("/api/classes?scope=all", headers=STAFF).json()["classes"]
    deleted = [r for r in rows if r["classId"] == class_id]
    assert len(deleted) == 1 and deleted[0]["revoked"] is True
    # The owner path is unchanged: a deleted class is not in its own list.
    monkeypatch.delenv("LOCAL_MODE_RESEARCHER")
    own = client.get("/api/classes", headers=STAFF).json()["classes"]
    assert class_id not in {r["classId"] for r in own}
