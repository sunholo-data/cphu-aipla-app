"""Custom personas — a tutor's face and voice as data (TUTOR-2 M3/M4/M5).

``Persona.source`` was ``Literal["yaml"]`` from 1.1.12, with its own docstring
recording that the Firestore layer was "a v1.2 follow-up". This is it, and it is
what "give a tutor a face and a voice" needed: the six shipped personas are
files in git with avatars under frontend/public, and a teacher can write
neither.

The property that carries the milestone: **the avatar is CHOSEN, not uploaded**,
and the STORE enforces it. M, 2026-09-28 settled that — a teacher-uploaded image
a 16-year-old sees would be the first user-generated student-facing content in
AIPLA and would need a moderation policy nobody had written. Enforcing it only
in the picker would be one fetch away from being bypassed.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, get_current_user
from auth.access_context import build_access_context
from db import firestore as fs_module
from personas.loader import allowed_avatars, load_persona
from protocols.personas_routes import router

TEACHER = User(uid="t-1", email="t@x.dk", is_teacher=True)
OTHER = User(uid="t-2", email="o@x.dk", is_teacher=True)
RESEARCHER = User(uid="r-1", email="r@x.dk", is_teacher=True, is_researcher=True)
STUDENTISH = User(uid="student", group_id="grp-1")

_BODY = {"name": "Fru Hansen", "title": "Fysiklærer", "avatar": "/personas/frida.webp"}


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


# --- the avatar is chosen, not uploaded ------------------------------------


def test_an_avatar_outside_the_shipped_set_is_refused_by_the_STORE():
    """⚠️ Not by the picker. A UI-only rule is one fetch away from bypass, and
    the thing on the other side is an image a 16-year-old sees."""
    res = _client(TEACHER).post("/api/personas/custom", json={**_BODY, "avatar": "https://evil.example/av.png"})
    assert res.status_code == 400
    assert "avatar" in res.json()["detail"]


def test_every_shipped_avatar_is_accepted():
    for i, avatar in enumerate(sorted(allowed_avatars())):
        res = _client(TEACHER).post("/api/personas/custom", json={**_BODY, "name": f"P{i}", "avatar": avatar})
        assert res.status_code == 200, res.text


def test_the_picker_is_told_which_avatars_it_may_offer():
    """Sent with the list so the client never keeps its own copy of what is
    allowed — the same reason canEdit is computed server-side."""
    body = _client(TEACHER).get("/api/personas/custom/list").json()
    assert body["avatars"] == sorted(allowed_avatars())
    assert len(body["avatars"]) >= 6


# --- it is a persona like any other ----------------------------------------


def test_a_custom_persona_resolves_through_the_SHIPPED_loader():
    """The whole design: a custom persona is just another id `load_persona`
    resolves, not a second resolution path that could disagree with the first.
    Every existing caller — the chat identity, the tutor serializer, the
    activity>class>default chain — gets it for free."""
    created = _client(TEACHER).post("/api/personas/custom", json=_BODY).json()
    resolved = load_persona(created["id"])
    assert resolved is not None
    assert resolved.name == "Fru Hansen"
    assert resolved.source == "firestore"


def test_a_yaml_persona_still_resolves_and_is_never_editable():
    assert load_persona("sofie") is not None
    # A YAML persona has no Firestore row, so there is nothing to edit or share.
    assert _client(TEACHER).put("/api/personas/custom/sofie", json=_BODY).status_code == 404


def test_a_custom_id_can_never_shadow_a_shipped_one():
    created = _client(TEACHER).post("/api/personas/custom", json={**_BODY, "name": "Sofie"}).json()
    assert created["id"].startswith("persona-")
    assert load_persona("sofie").source == "yaml"


# --- ownership and visibility, same rules as everything else ---------------


def test_a_new_persona_is_private_and_sharing_is_its_own_act():
    c = _client(TEACHER)
    created = c.post("/api/personas/custom", json=_BODY).json()
    assert created["visibility"] == "private"
    assert created["id"] not in {p["id"] for p in _client(OTHER).get("/api/personas/custom/list").json()["personas"]}

    c.put(f"/api/personas/custom/{created['id']}/visibility", json={"visibility": "shared"})
    assert created["id"] in {p["id"] for p in _client(OTHER).get("/api/personas/custom/list").json()["personas"]}


def test_an_edit_never_changes_who_can_see_it():
    c = _client(TEACHER)
    created = c.post("/api/personas/custom", json=_BODY).json()
    c.put(f"/api/personas/custom/{created['id']}/visibility", json={"visibility": "shared"})
    c.put(f"/api/personas/custom/{created['id']}", json={**_BODY, "title": "Ny titel"})
    assert c.get("/api/personas/custom/list").json()["personas"][0]["visibility"] == "shared"


def test_a_researcher_sees_everyones_and_a_teacher_does_not():
    created = _client(TEACHER).post("/api/personas/custom", json=_BODY).json()
    assert created["id"] in {p["id"] for p in _client(RESEARCHER).get("/api/personas/custom/list").json()["personas"]}
    assert created["id"] not in {p["id"] for p in _client(OTHER).get("/api/personas/custom/list").json()["personas"]}


def test_only_the_owner_or_a_researcher_may_edit_or_delete():
    created = _client(TEACHER).post("/api/personas/custom", json=_BODY).json()
    pid = created["id"]
    assert _client(OTHER).put(f"/api/personas/custom/{pid}", json=_BODY).status_code in (403, 404)
    assert _client(OTHER).delete(f"/api/personas/custom/{pid}").status_code == 404
    assert _client(RESEARCHER).put(f"/api/personas/custom/{pid}", json=_BODY).status_code == 200
    assert _client(TEACHER).delete(f"/api/personas/custom/{pid}").status_code == 204


def test_a_student_reaches_none_of_it():
    c = _client(STUDENTISH)
    assert c.get("/api/personas/custom/list").status_code == 403
    assert c.post("/api/personas/custom", json=_BODY).status_code == 403


def test_the_custom_list_is_not_swallowed_by_the_id_catch_all():
    """Two segments on purpose — the trap frameworks_routes documents, where a
    single-segment catch-all answered '404 not found' for a live route."""
    assert _client(TEACHER).get("/api/personas/custom/list").status_code == 200


# --- voice (M5) -------------------------------------------------------------


def test_a_persona_carries_a_voice_and_a_delivery_prompt():
    """The curated catalogue had a typed client and no picker since 1.1.11 —
    what was missing was somewhere for the choice to live."""
    body = {
        **_BODY,
        "voice": {"ttsProvider": "gcp_gemini", "ttsVoice": "da-DK-Chirp3-HD-Aoede", "language": "da"},
        "voicePrompt": "Tal roligt og opmuntrende.",
    }
    created = _client(TEACHER).post("/api/personas/custom", json=body).json()
    resolved = load_persona(created["id"])
    assert resolved.voice.tts_voice == "da-DK-Chirp3-HD-Aoede"
    assert resolved.voice_prompt == "Tal roligt og opmuntrende."
