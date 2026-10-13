"""/api/sim-drafts — a teacher's sim drafts (in-app-sim-authoring M4).

Pinned: teacher-only; owner-only, answering 404 (not 403) for someone else's
draft; screenshots served as PNG; draft HTML downloaded as an attachment that a
browser will not render on the app origin.
"""

from __future__ import annotations

import base64

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import auth
from auth.access_context import build_access_context
from auth.firebase_auth import User
from db import firestore as fs_module
from db import sim_drafts
from protocols.sim_draft_routes import router

PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    from db.teacher_access import grant_access, set_feature

    for email, uid in (("t1@example.dk", "t-1"), ("t2@example.dk", "t-2"), ("t3@example.dk", "t-3")):
        grant_access(email, uid=uid)
    set_feature("t1@example.dk", "simWorkshop", True)
    set_feature("t2@example.dk", "simWorkshop", True)
    sim_drafts.add_version(
        draft_id="sess-1",
        owner_uid="t-1",
        index_html="<!doctype html><script>alert(1)</script>",
        catalogue_yaml="id: demo\ndisplayName: Demo pendulum\n",
        level=3,
        reasons=[],
        screenshots={"700": PNG_B64, "driven": PNG_B64},
        artefact_id="demo",
    )
    yield
    fs_module._reset_client_for_testing()


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    # The route imports the DISPATCHER (auth.get_current_user), so that is the symbol overridden.
    app.dependency_overrides[auth.get_current_user] = _override
    return TestClient(app)


OWNER = User(uid="t-1", is_teacher=True)
OTHER = User(uid="t-2", is_teacher=True)
NO_FEATURE = User(uid="t-3", is_teacher=True)


def test_a_teacher_without_the_feature_is_refused_with_a_reason():
    r = _client(NO_FEATURE).get("/api/sim-drafts")
    assert r.status_code == 403 and r.json()["detail"]["error"] == "feature_not_enabled"


def test_a_researcher_has_the_feature_without_a_switch():
    researcher = User(uid="r-1", is_teacher=True, is_researcher=True)
    assert _client(researcher).get("/api/sim-drafts").status_code == 200


def test_owner_lists_and_reads_their_draft():
    c = _client(OWNER)
    drafts = c.get("/api/sim-drafts").json()["drafts"]
    assert [d["id"] for d in drafts] == ["sess-1"] and drafts[0]["title"] == "Demo pendulum"
    body = c.get("/api/sim-drafts/sess-1").json()
    assert body["versions"][0]["version"] == 1 and body["versions"][0]["screenshots"] == ["700", "driven"]
    assert "html" not in body["versions"][0]


def test_another_teacher_gets_404_everywhere():
    c = _client(OTHER)
    assert c.get("/api/sim-drafts").json()["drafts"] == []
    assert c.get("/api/sim-drafts/sess-1").status_code == 404
    assert c.get("/api/sim-drafts/sess-1/versions/1/screenshot/700").status_code == 404
    assert c.get("/api/sim-drafts/sess-1/versions/1/files/index.html").status_code == 404


def test_a_student_is_refused():
    student = User(uid="group:abc", is_teacher=False, group_id="abc")
    assert _client(student).get("/api/sim-drafts").status_code in (401, 403)


def test_screenshot_is_a_png():
    r = _client(OWNER).get("/api/sim-drafts/sess-1/versions/1/screenshot/700")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.content == base64.b64decode(PNG_B64)
    assert _client(OWNER).get("/api/sim-drafts/sess-1/versions/1/screenshot/../../x").status_code == 404


def test_html_download_cannot_render_on_the_app_origin():
    r = _client(OWNER).get("/api/sim-drafts/sess-1/versions/1/files/index.html")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.headers["content-disposition"].startswith("attachment;")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in r.headers["content-security-policy"]
    assert b"<script>" in r.content  # the file itself is intact for download


def test_unknown_file_names_and_bad_ids_are_404():
    c = _client(OWNER)
    assert c.get("/api/sim-drafts/sess-1/versions/1/files/secrets.txt").status_code == 404
    assert c.get("/api/sim-drafts/bad id!").status_code == 404
