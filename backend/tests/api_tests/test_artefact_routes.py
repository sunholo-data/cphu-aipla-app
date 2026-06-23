"""API tests for /api/artefacts (1.1.41 M0).

The critical property: the public catalogue NEVER leaks the artefact
``tutorBlock`` (server-side only).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from protocols.artefact_routes import router


@pytest.fixture()
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid="teacher-1", email="teacher@example.test")
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def test_list_artefacts_returns_the_catalogue(client: TestClient) -> None:
    r = client.get("/api/artefacts")
    assert r.status_code == 200
    ids = {a["id"] for a in r.json()["artefacts"]}
    assert {"boldkast", "led-planck", "kinebot"} <= ids


def test_list_never_leaks_the_tutor_block(client: TestClient) -> None:
    r = client.get("/api/artefacts")
    for a in r.json()["artefacts"]:
        assert "tutorBlock" not in a
        assert "tutor_block" not in a
        assert a["artefactPath"]  # the picker + frame need this


def test_status_filter(client: TestClient) -> None:
    assert client.get("/api/artefacts?status=deprecated").json()["artefacts"] == []
    assert len(client.get("/api/artefacts?status=live").json()["artefacts"]) >= 3


def test_get_one_artefact(client: TestClient) -> None:
    r = client.get("/api/artefacts/boldkast")
    assert r.status_code == 200
    assert r.json()["artefactPath"] == "boldkast/v1"
    assert "tutorBlock" not in r.json()


def test_get_unknown_artefact_404(client: TestClient) -> None:
    assert client.get("/api/artefacts/nope").status_code == 404
