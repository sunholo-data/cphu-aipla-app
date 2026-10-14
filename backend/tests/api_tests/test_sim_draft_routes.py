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


def test_preview_has_the_real_bridge_stamped_and_cannot_render_on_the_app_origin():
    sim_drafts.add_version(
        draft_id="sess-1",
        owner_uid="t-1",
        index_html="<!doctype html><head>\n  <!-- @aipla-bridge:start -->\n<script>/* placeholder */</script>\n  <!-- @aipla-bridge:end -->\n</head>",
        catalogue_yaml="id: demo\ndisplayName: Demo pendulum\n",
        level=3,
        reasons=[],
        screenshots={},
        artefact_id="demo",
    )
    r = _client(OWNER).get("/api/sim-drafts/sess-1/versions/2/preview")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    assert "sandbox" in r.headers["content-security-policy"] and "placeholder" not in r.text
    assert "AIPLA_BRIDGE" in r.text
    assert _client(OTHER).get("/api/sim-drafts/sess-1/versions/2/preview").status_code == 404


def test_each_draft_names_the_conversation_it_was_built_in():
    """The workshop reopens a draft's chat from ``sessionId``. A draft stored before
    it was recorded falls back to its id (the sanitised session id)."""
    sim_drafts.add_usage(
        draft_id="sess_2",
        owner_uid="t-1",
        tokens_in=10,
        tokens_out=5,
        tokens_thinking=0,
        cost_usd=0.001,
        session_id="sess:2",
    )
    sim_drafts.add_version(
        draft_id="sess_2",
        owner_uid="t-1",
        index_html="<!doctype html>",
        catalogue_yaml="displayName: Carts\n",
        level=1,
        reasons=[],
        screenshots={},
        artefact_id="carts",
        session_id="other",  # never overwrites the first record
    )
    rows = {d["id"]: d for d in _client(OWNER).get("/api/sim-drafts").json()["drafts"]}
    assert rows["sess_2"]["sessionId"] == "sess:2"
    assert rows["sess-1"]["sessionId"] == "sess-1"
    assert _client(OWNER).get("/api/sim-drafts/sess_2").json()["sessionId"] == "sess:2"


# --- Portable files: download one, import one (sim_authoring/portable.py) ---


def test_portable_download_is_one_file_with_its_catalogue(monkeypatch):
    monkeypatch.setattr("sim_gates.load_bridge", lambda: None)
    resp = _client(OWNER).get("/api/sim-drafts/sess-1/versions/1/files/portable.html")
    assert resp.status_code == 200
    assert 'filename="demo-v1.html"' in resp.headers["content-disposition"]
    assert "aipla-portable: v1" in resp.text
    assert "displayName: Demo pendulum" in resp.text


def test_import_takes_a_page_and_its_catalogue_and_starts_a_new_draft(monkeypatch):
    seen = {}

    async def fake_import(page, catalogue, *, owner):
        seen.update(page=page, catalogue=catalogue, owner=owner)
        return {"draftId": "new-1", "version": 1, "level": 3, "reasons": []}

    monkeypatch.setattr("adk.sim_author.import_draft", fake_import)
    from sim_authoring.portable import bundle

    portable = bundle(
        "<!doctype html><html><head></head><body><script>1</script></body></html>", "id: x\n", bridge=None
    )
    resp = _client(OWNER).post("/api/sim-drafts/import", json={"html": portable})
    assert resp.status_code == 200, resp.text
    assert resp.json()["draftId"] == "new-1"
    assert seen["owner"] == "t-1"
    assert seen["catalogue"].strip() == "id: x"
    assert "aipla-portable" not in seen["page"]
    # A separate catalogue file wins over an embedded one.
    resp = _client(OWNER).post("/api/sim-drafts/import", json={"html": portable, "yaml": "id: y\n"})
    assert seen["catalogue"].strip() == "id: y"


def test_import_refuses_what_is_not_a_page_and_teachers_without_the_workshop():
    assert _client(OWNER).post("/api/sim-drafts/import", json={"html": "just text"}).status_code == 422
    assert _client(NO_FEATURE).post("/api/sim-drafts/import", json={"html": "<html></html>"}).status_code == 403
