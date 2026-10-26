"""Four persona tutors for the 2026-10-19 avatars — kasper, lars, nadia, omar.

Each one is asserted END-TO-END through the read sites a tutor claims to own
(name + avatar the student sees, the spoken voice, the identity block, the
teacher catalogue), not just through the loader: "a resolver ships with one
consumer" is the footgun this repo has already paid for once.

The class fixture deliberately carries a CONFLICTING ``persona: sofie``. A test
that seeded only the tutor would pass against a broken chain, because the
fallback is Sofie too.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.firestore import set_document

NEW_TUTORS = {
    # id: (name, voice)
    "kasper": ("Kasper", "Algenib"),
    "lars": ("Lars", "Sadaltager"),
    "nadia": ("Nadia", "Zephyr"),
    "omar": ("Omar", "Orus"),
}

CLASS_ID = "cls-new-personas"
TEACHER_UID = "teacher-1"
GROUP_ID = "aipla-demo-new-personas"
TAGS = [f"class:{TEACHER_UID}:{CLASS_ID}"]
ACTIVITY = "act-new-personas-1"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _seed_class(tutor_id: str | None) -> None:
    set_document(
        "classes",
        CLASS_ID,
        {
            "classId": CLASS_ID,
            "ownerUid": TEACHER_UID,
            "name": "Fysik B",
            "tagNamespace": f"class:{TEACHER_UID}:{CLASS_ID}",
            "persona": "sofie",
            "tutorId": tutor_id,
            "createdAt": "2026-10-01T00:00:00+00:00",
            "updatedAt": "2026-10-26T00:00:00+00:00",
        },
    )
    set_document("anon_groups", GROUP_ID, {"classId": CLASS_ID})


def _student() -> User:
    return User(
        uid=f"anon:{GROUP_ID}",
        email="",
        domain="",
        group_id=GROUP_ID,
        group_tags=TAGS,
        auth_mode="anonymous_group",
    )


def _client(router, user: User, dep=get_current_user) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[dep] = _override
    return TestClient(app)


@pytest.mark.parametrize("tutor_id", sorted(NEW_TUTORS))
def test_the_student_sees_the_new_tutors_name_and_face(tutor_id):
    from protocols.activity_config_routes import router

    _seed_class(tutor_id)
    resp = _client(router, _student()).get(f"/api/activity-configs/active/{ACTIVITY}")
    assert resp.status_code == 200, resp.text
    persona = resp.json()["persona"]
    assert persona["id"] == tutor_id
    assert persona["name"] == NEW_TUTORS[tutor_id][0]
    assert persona["avatar"] == f"/personas/{tutor_id}.webp"


@pytest.mark.parametrize("tutor_id", sorted(NEW_TUTORS))
def test_the_new_tutor_speaks_in_its_own_voice(tutor_id):
    from protocols.voice_routes import resolve_voice

    _seed_class(tutor_id)
    rv = resolve_voice(_student(), None, None, activity_id=ACTIVITY)
    assert rv.voice == NEW_TUTORS[tutor_id][1]


@pytest.mark.parametrize("tutor_id", sorted(NEW_TUTORS))
def test_the_identity_block_names_the_new_tutor(tutor_id):
    from adk.tutor_identity import build_identity_block

    assert f"Your name is {NEW_TUTORS[tutor_id][0]}" in build_identity_block(tutor_id)


def test_the_teacher_catalogue_offers_all_four_with_no_approach():
    from auth.firebase_auth import get_current_user as firebase_user
    from protocols.tutors_routes import router

    # /api/tutors is a teacher-only route and guards with the Firebase symbol.
    body = _client(router, User(uid="t-1", is_teacher=True), firebase_user).get("/api/tutors").json()
    by_id = {t["id"]: t for t in body["tutors"]}
    for tutor_id, (name, _voice) in NEW_TUTORS.items():
        t = by_id[tutor_id]
        assert t["frameworkId"] is None, f"{tutor_id} ships with an approach nobody signed off"
        assert t["isVariant"] is False
        assert t["persona"]["name"] == name
        assert t["persona"]["avatar"] == f"/personas/{tutor_id}.webp"


def test_every_shipped_persona_speaks_in_a_different_voice():
    """Eleven faces, eleven voices — two tutors sharing one would make a class
    switching between them hear no change."""
    from personas.loader import load_personas

    voices = [p.voice.tts_voice for p in load_personas() if p.voice]
    assert len(voices) == len(load_personas())
    assert len(set(voices)) == len(voices), voices


def test_a_tutor_less_activity_still_composes_from_its_fields():
    """Passthrough (handover rule 1) with one of the new personas on the old
    field path: no tutor id, so nothing about the tutor layer applies."""
    from datetime import UTC, datetime

    from adk.tutor_resolution import resolve_teaching
    from db.models.activity_config import ActivityConfig

    cfg = ActivityConfig(
        activityId="a",
        classId="c",
        teacherUid="t",
        persona="nadia",
        interactionStyle="warm",
        updatedAt=datetime.now(UTC),
    )
    r = resolve_teaching(cfg)
    assert r.tutor is None
    assert (r.persona_id, r.interaction_style, r.framework_id, r.source) == ("nadia", "warm", None, "fields")
