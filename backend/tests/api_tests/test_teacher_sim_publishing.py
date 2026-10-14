"""Teacher-published sims, end to end (in-app-sim-authoring M6).

One store, the real routes: a teacher publishes a checked draft version; it
joins THEIR catalogue and nobody else's; another teacher cannot attach it; a
student's frame can fetch its page; a researcher's sign-off puts it in every
teacher's catalogue; withdrawing takes it out. The draft is a real sim
(otto-engine, renamed) so the stamping and every gate run for real.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import auth
from auth.access_context import build_access_context
from auth.firebase_auth import User
from db import firestore as fs_module
from db import sim_drafts, teacher_sims
from protocols.artefact_routes import router as artefact_router
from protocols.teacher_sim_routes import router as teacher_sim_router

REPO = Path(__file__).resolve().parents[3]
OWNER = User(uid="t-1", email="t1@example.dk", is_teacher=True)
OTHER = User(uid="t-2", email="t2@example.dk", is_teacher=True)
RESEARCHER = User(uid="r-1", email="r1@example.dk", is_teacher=True, is_researcher=True)
STUDENT = User(uid="group:abc", is_teacher=False, group_id="abc")


def _draft_files(sim_id: str = "otto-mine") -> tuple[str, str]:
    html = (REPO / "infrastructure/mcp-sandbox/artefacts/otto-engine/v1/index.html").read_text()
    yml = (REPO / "backend/artefacts/otto-engine.yaml").read_text()
    html = re.sub(
        r"(<!--\s*@aipla-bridge:start[^>]*-->\n)[\s\S]*?(\n[ \t]*<!--\s*@aipla-bridge:end)",
        r"\1<script>/* AIPLA_BRIDGE placeholder */</script>\2",
        html,
    )
    return html.replace("otto-engine", sim_id), yml.replace("otto-engine", sim_id)


PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def _add(
    level: int = 3,
    html: str | None = None,
    yml: str | None = None,
    draft_id: str = "sess-1",
    screenshots: dict[str, str] | None = None,
) -> int:
    h, y = _draft_files()
    return sim_drafts.add_version(
        draft_id=draft_id,
        owner_uid="t-1",
        index_html=html or h,
        catalogue_yaml=yml or y,
        level=level,
        reasons=[],
        screenshots=screenshots or {},
        artefact_id="otto-mine",
    )


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    teacher_sims.invalidate()
    from db.teacher_access import grant_access, set_feature

    for email, uid in (("t1@example.dk", "t-1"), ("t2@example.dk", "t-2")):
        grant_access(email, uid=uid)
        set_feature(email, "simWorkshop", True)
    yield
    teacher_sims.invalidate()
    fs_module._reset_client_for_testing()


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(teacher_sim_router)
    app.include_router(artefact_router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[auth.get_current_user] = _override
    return TestClient(app)


def _catalogue_ids(user: User) -> set[str]:
    return {a["id"] for a in _client(user).get("/api/artefacts?status=live").json()["artefacts"]}


def _publish(n: int = 1, approve: bool = True):
    return _client(OWNER).post(f"/api/sim-drafts/sess-1/versions/{n}/publish", json={"approve": approve})


def test_publish_needs_the_teachers_approval():
    _add()
    assert _publish(approve=False).status_code == 400


def test_published_sim_joins_the_owners_catalogue_only():
    _add()
    r = _publish()
    assert r.status_code == 200, r.text
    assert r.json()["published"]["scope"] == "classes" and r.json()["published"]["approvedBy"] == "t1@example.dk"
    teacher_sims.invalidate()
    assert "otto-mine" in _catalogue_ids(OWNER)
    assert "otto-mine" not in _catalogue_ids(OTHER)
    entry = next(a for a in _client(OWNER).get("/api/artefacts").json()["artefacts"] if a["id"] == "otto-mine")
    assert entry["source"] == "teacher" and entry["artefactPath"] == "teacher-sims/otto-mine/v1"
    assert "tutorBlock" not in entry


def test_another_teacher_cannot_attach_a_class_sim():
    from artefacts.loader import can_attach

    _add()
    _publish()
    teacher_sims.invalidate()
    assert can_attach("otto-mine", "t-1") and not can_attach("otto-mine", "t-2")
    assert can_attach("otto-mine", "r-1", is_researcher=True)


def test_the_page_students_get_is_stamped_and_cannot_render_on_the_app_origin():
    _add()
    _publish()
    r = _client(STUDENT).get("/api/teacher-sims/otto-mine/v1/index.html")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain") and r.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in r.headers["content-security-policy"]
    assert "AIPLA_BRIDGE placeholder" not in r.text and "window.AIPLA_BRIDGE" in r.text
    assert _client(STUDENT).get("/api/teacher-sims/otto-mine/v2/index.html").status_code == 404


def test_a_version_below_level_three_or_with_a_network_call_is_refused():
    _add(level=2)
    r = _publish()
    assert r.status_code == 422 and "level 3" in r.json()["detail"]["reasons"][0]
    h, y = _draft_files()
    _add(html=h.replace("</body>", "<script>fetch('https://x.example/')</script></body>", 1), yml=y)
    r = _publish(2)
    assert r.status_code == 422 and any("A.no_external_fetch" in x for x in r.json()["detail"]["reasons"])


def test_a_builtin_id_is_refused():
    h, y = _draft_files("boldkast")
    _add(html=h, yml=y)
    r = _publish()
    assert r.status_code == 422 and "built-in" in r.json()["detail"]["reasons"][0]


def test_library_signoff_shares_it_and_withdraw_removes_it():
    _add()
    _publish()
    assert _client(OTHER).post("/api/teacher-sims/otto-mine/library-request", json={}).status_code == 404
    assert (
        _client(OWNER).post("/api/teacher-sims/otto-mine/library-request", json={"note": "used it twice"}).status_code
        == 200
    )
    assert _client(OWNER).get("/api/teacher-sims/review").status_code == 403
    reqs = _client(RESEARCHER).get("/api/teacher-sims/review").json()["requests"]
    assert [x["id"] for x in reqs] == ["otto-mine"] and reqs[0]["request"]["note"] == "used it twice"
    r = _client(RESEARCHER).post(
        "/api/teacher-sims/otto-mine/library-decision", json={"approve": True, "note": "physics ok"}
    )
    assert r.status_code == 200 and r.json()["sim"]["scope"] == "library"
    assert "otto-mine" in _catalogue_ids(OTHER)

    assert _client(OTHER).post("/api/teacher-sims/otto-mine/withdraw").status_code == 404
    assert _client(OWNER).post("/api/teacher-sims/otto-mine/withdraw").status_code == 200
    assert "otto-mine" not in _catalogue_ids(OWNER) and "otto-mine" not in _catalogue_ids(OTHER)
    assert _client(STUDENT).get("/api/teacher-sims/otto-mine/v1/index.html").status_code == 404


def test_republishing_a_library_sim_returns_it_to_classes_until_signed_off_again():
    _add()
    _publish()
    _client(OWNER).post("/api/teacher-sims/otto-mine/library-request", json={})
    _client(RESEARCHER).post("/api/teacher-sims/otto-mine/library-decision", json={"approve": True})
    _add()
    r = _publish(2)
    assert (
        r.status_code == 200 and r.json()["published"]["version"] == 2 and r.json()["published"]["scope"] == "classes"
    )
    assert "otto-mine" not in _catalogue_ids(OTHER)


def test_another_teacher_cannot_take_a_published_id():
    _add()
    _publish()
    h, y = _draft_files()
    sim_drafts.add_version(
        draft_id="sess-9",
        owner_uid="t-2",
        index_html=h,
        catalogue_yaml=y,
        level=3,
        reasons=[],
        screenshots={},
        artefact_id="x",
    )
    r = _client(OTHER).post("/api/sim-drafts/sess-9/versions/1/publish", json={"approve": True})
    assert r.status_code == 409


def test_a_teacher_without_the_workshop_cannot_publish():
    from db.teacher_access import set_feature

    _add()
    set_feature("t1@example.dk", "simWorkshop", False)
    assert _publish().status_code == 403


def test_the_tutor_and_the_state_channel_see_a_published_sim():
    """The two read sites a student turn depends on: the tutor block (teacher_focus)
    and catalogue membership, which authorises the sim's iframe-context writes."""
    from artefacts.loader import is_known_artefact, load_artefact

    _add()
    _publish()
    teacher_sims.invalidate()
    meta = load_artefact("otto-mine")
    assert meta is not None and meta.tutor_block.strip() and is_known_artefact("otto-mine")
    _client(OWNER).post("/api/teacher-sims/otto-mine/withdraw")
    assert load_artefact("otto-mine") is None


def test_a_published_sim_shows_its_checked_screenshot_as_thumbnail():
    """The version's screenshots are frozen at publish: the picker's thumbnail and
    what the activity co-pilot looks at. Editing the draft later changes neither."""
    import base64

    _add(screenshots={"700": PNG_B64, "driven": PNG_B64, "390": PNG_B64})
    assert _publish().status_code == 200
    teacher_sims.invalidate()
    entry = next(a for a in _client(OWNER).get("/api/artefacts").json()["artefacts"] if a["id"] == "otto-mine")
    assert entry["thumbnail"] == "/api/proxy/api/artefacts/otto-mine/screenshot/700"
    r = _client(OTHER).get("/api/artefacts/otto-mine/screenshot/700")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.content == base64.b64decode(PNG_B64)
    stored = fs_module.get_document("teacher_sim_versions", "otto-mine__v1")
    assert set(stored["screenshots"]) == {"700", "driven"}


def test_no_screenshot_is_a_404_not_an_error():
    _add()
    assert _publish().status_code == 200
    teacher_sims.invalidate()
    assert _client(OWNER).get("/api/artefacts/otto-mine/screenshot/700").status_code == 404
    assert _client(OWNER).get("/api/artefacts/otto-mine/screenshot/9000").status_code == 404
    assert _client(OWNER).get("/api/artefacts/no-such-sim/screenshot/700").status_code == 404
