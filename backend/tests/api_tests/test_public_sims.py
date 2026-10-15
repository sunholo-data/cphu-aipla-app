"""The homepage gallery's endpoints, /api/public/sims (no sign-in).

What must hold: anyone sees the library (live built-ins + shared-library teacher
sims) and nothing else; a class-level teacher sim is invisible, its screenshot
included; and no entry carries the tutorBlock or anything a teacher-only view has.
"""

from __future__ import annotations

import base64

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.models.artefact import ArtefactMeta
from protocols.artefact_routes import public_router

_PNG = base64.b64encode(b"\x89PNG teacher shot").decode()


def _teacher(id_: str, scope: str) -> ArtefactMeta:
    return ArtefactMeta(
        id=id_,
        version="v2",
        displayName=f"Sim {id_}",
        description="d",
        tutorBlock="REFERENCE: the answer is 42",
        source="teacher",
        ownerUid="teacher-9",
        scope=scope,
    )


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    import artefacts.loader as loader
    import db.teacher_sims as teacher_sims

    monkeypatch.setattr(
        loader, "_teacher_artefacts", lambda: [_teacher("faelles", "library"), _teacher("klasse", "classes")]
    )
    monkeypatch.setattr(teacher_sims, "get_version_screenshot", lambda _id, _shot: _PNG)
    app = FastAPI()
    app.include_router(public_router)  # no auth dependency to override: there is none
    return TestClient(app)


def test_lists_the_library_and_no_class_sim(client: TestClient) -> None:
    sims = client.get("/api/public/sims").json()["sims"]
    ids = [s["id"] for s in sims]
    assert {"boldkast", "sort-hul", "faelles"} <= set(ids)
    assert "klasse" not in ids


def test_entries_carry_only_what_a_visitor_needs(client: TestClient) -> None:
    for s in client.get("/api/public/sims").json()["sims"]:
        assert set(s) == {"id", "displayName", "description", "topics", "levels", "language", "source"}
    assert "42" not in client.get("/api/public/sims").text


def test_builtin_screenshot_is_public_and_cacheable(client: TestClient) -> None:
    r = client.get("/api/public/sims/boldkast/screenshot/700")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.headers["cache-control"].startswith("public")


def test_library_teacher_sim_screenshot_is_served(client: TestClient) -> None:
    r = client.get("/api/public/sims/faelles/screenshot/700")
    assert r.status_code == 200
    assert r.content == base64.b64decode(_PNG)


def test_class_sim_screenshot_404s_like_a_missing_one(client: TestClient) -> None:
    assert client.get("/api/public/sims/klasse/screenshot/700").status_code == 404
    assert client.get("/api/public/sims/nope/screenshot/700").status_code == 404
    assert client.get("/api/public/sims/boldkast/screenshot/huge").status_code == 404
