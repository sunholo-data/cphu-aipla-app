"""The review timeline routes (1.1.136 M1).

- ``/api/research/logs/sessions/{id}/timeline`` — researcher-only, like the lens.
- ``/api/research/logs/groups/{code}/sessions/{id}/timeline`` — the teacher group
  report's read: the owner of the group's class or a researcher; everyone else
  (another class's teacher, a student) an enumeration-resistant 404.

Plus the 1.1.131 property: both routes run their synchronous reads (BigQuery,
and the Firestore class lookup) OFF the event loop.
"""

from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import User, get_current_user
from protocols.research_logs_routes import router

OWNER = User(uid="t-owner", email="owner@ku.dk", domain="ku.dk", is_teacher=True)
OTHER_TEACHER = User(uid="t-other", email="other@ku.dk", domain="ku.dk", is_teacher=True)
RESEARCHER = User(uid="r-1", email="r@ku.dk", domain="ku.dk", is_teacher=True, is_researcher=True)
STUDENT = User(uid="anon-boldkazoo87-ab12", email="", domain="", group_id="bold-kazoo-87")

CLASS = SimpleNamespace(class_id="cls-1", owner_uid="t-owner", group_codes=["bold-kazoo-87"])

TIMELINE = {
    "items": [
        {"kind": "turn", "turn_index": 0, "role": "student", "content": "is our slope right?"},
        {"kind": "work", "server": "table", "label": "Data table shared with the tutor (3 cells)"},
    ],
    "workStatus": "ok",
    "turnCount": 1,
    "workCount": 1,
}


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def seeded(monkeypatch):
    calls: list = []

    def fake_timeline(session_id, *, group_id=None):
        calls.append((session_id, group_id))
        return TIMELINE

    monkeypatch.setattr("analytics.research_logs.session_timeline", fake_timeline)
    monkeypatch.setattr("db.classes.get_class_for_group", lambda code: CLASS if code == "bold-kazoo-87" else None)
    monkeypatch.setattr("analytics.auth.get_class", lambda cid: CLASS if cid == "cls-1" else None)
    return calls


GROUP_PATH = "/api/research/logs/groups/bold-kazoo-87/sessions/s-1/timeline"


# ── researcher lens ───────────────────────────────────────────────────────────


def test_lens_timeline_is_researcher_only(seeded):
    assert _client(OWNER).get("/api/research/logs/sessions/s-1/timeline").status_code == 403
    resp = _client(RESEARCHER).get("/api/research/logs/sessions/s-1/timeline")
    assert resp.status_code == 200
    body = resp.json()
    assert [i["kind"] for i in body["items"]] == ["turn", "work"]
    assert body["workStatus"] == "ok"


def test_lens_timeline_unreadable_is_503(monkeypatch):
    def boom(session_id, *, group_id=None):
        raise RuntimeError("bq down")

    monkeypatch.setattr("analytics.research_logs.session_timeline", boom)
    assert _client(RESEARCHER).get("/api/research/logs/sessions/s-1/timeline").status_code == 503


def test_lens_timeline_empty_is_404(monkeypatch):
    monkeypatch.setattr(
        "analytics.research_logs.session_timeline",
        lambda session_id, *, group_id=None: {"items": [], "workStatus": "ok"},
    )
    assert _client(RESEARCHER).get("/api/research/logs/sessions/s-1/timeline").status_code == 404


# ── teacher group report ──────────────────────────────────────────────────────


def test_the_class_owner_reads_their_group(seeded):
    resp = _client(OWNER).get(GROUP_PATH)
    assert resp.status_code == 200, resp.text
    assert resp.json()["items"][1]["label"].startswith("Data table")
    # Narrowed to the group, so a foreign session id cannot be read through it.
    assert seeded == [("s-1", "bold-kazoo-87")]


def test_a_researcher_reads_any_group(seeded):
    assert _client(RESEARCHER).get(GROUP_PATH).status_code == 200


def test_a_teacher_of_another_class_gets_404(seeded):
    resp = _client(OTHER_TEACHER).get(GROUP_PATH)
    assert resp.status_code == 404
    assert seeded == []  # refused before any query ran


def test_a_student_is_refused(seeded):
    """A group token owns no class. 404, same as any non-owner."""
    assert _client(STUDENT).get(GROUP_PATH).status_code == 404
    assert seeded == []


def test_an_unknown_group_is_the_same_404(seeded):
    resp = _client(OWNER).get("/api/research/logs/groups/nope-00/sessions/s-1/timeline")
    assert resp.status_code == 404
    assert resp.json()["detail"] == _client(OTHER_TEACHER).get(GROUP_PATH).json()["detail"]


# ── off the event loop (1.1.131) ──────────────────────────────────────────────

SLOW_S = 0.8
FAST_BUDGET_S = 0.4


async def test_group_timeline_does_not_block_the_loop(monkeypatch):
    def slow_class_lookup(code):
        time.sleep(SLOW_S / 2)
        return CLASS

    def slow_timeline(session_id, *, group_id=None):
        time.sleep(SLOW_S / 2)
        return TIMELINE

    monkeypatch.setattr("db.classes.get_class_for_group", slow_class_lookup)
    monkeypatch.setattr("analytics.auth.get_class", lambda cid: CLASS)
    monkeypatch.setattr("analytics.research_logs.session_timeline", slow_timeline)

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: OWNER

    @app.get("/ping")
    async def ping() -> dict:
        return {"ok": True}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        t0 = time.monotonic()

        async def slow() -> float:
            r = await client.get(GROUP_PATH)
            assert r.status_code == 200, r.text
            return time.monotonic() - t0

        async def fast() -> float:
            await asyncio.sleep(0.1)
            r = await client.get("/ping")
            assert r.status_code == 200
            return time.monotonic() - t0

        slow_s, fast_s = await asyncio.gather(slow(), fast())
    assert slow_s >= SLOW_S * 0.9
    assert fast_s < FAST_BUDGET_S, f"/ping waited {fast_s:.2f}s behind the group timeline"
