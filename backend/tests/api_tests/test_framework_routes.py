"""1.1.91 M1 — /api/research/frameworks.

Headline: researcher-only (an ordinary teacher 403s on EVERY route), the
generated default always travels beside the override so an edit reads as a
delta, and Revert restores the render byte-for-byte.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth.access_context import build_access_context
from auth.firebase_auth import User, get_current_user
from db import firestore as fs_module
from db.framework_overrides import default_framework_instruction
from protocols.frameworks_routes import router

RESEARCHER = User(uid="r-1", is_teacher=True, is_researcher=True)
TEACHER = User(uid="t-1", is_teacher=True)


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


def test_every_route_is_researcher_only():
    """An ordinary teacher must 403, not receive a narrowed view. A researcher
    surface that silently degrades is worse than one that refuses."""
    c = _client(TEACHER)
    assert c.get("/api/research/frameworks").status_code == 403
    assert c.get("/api/research/frameworks/esru").status_code == 403
    assert c.put("/api/research/frameworks/esru/instruction", json={"instruction": "x"}).status_code == 403
    assert c.delete("/api/research/frameworks/esru/instruction").status_code == 403


def test_catalogue_lists_all_seven_with_instructions():
    body = _client(RESEARCHER).get("/api/research/frameworks").json()
    ids = [f["id"] for f in body["frameworks"]]
    assert set(ids) == {"5e", "accountable-talk", "authentic-dialogue", "cer", "esru", "poe", "toulmin"}
    esru = next(f for f in body["frameworks"] if f["id"] == "esru")
    assert esru["isOverridden"] is False
    # The four verified ESRU moves reach the instruction a tutor would receive.
    for move in ("Elicit", "Student response", "Recognise", "Use"):
        assert move in esru["instruction"]


def test_placeholder_frameworks_render_no_instruction(monkeypatch):
    """A framework with no drafted constructs must say nothing rather than
    manufacture a plausible-looking one.

    Synthetic, not a real id: the catalogue has had no placeholder since
    2026-09-10, and pointing this at `poe` meant it silently started asserting
    that a WRITTEN framework renders nothing the moment poe was drafted.
    """
    from db.models.teaching_framework import TeachingFramework

    empty = TeachingFramework(id="slot-only", label="Slot only", status="placeholder")
    monkeypatch.setattr(
        "protocols.frameworks_routes.load_framework",
        lambda fid: empty if fid == "slot-only" else None,
    )
    body = _client(RESEARCHER).get("/api/research/frameworks/slot-only").json()
    assert body["status"] == "placeholder"
    assert body["instruction"] == ""


def test_edit_then_revert_round_trips():
    c = _client(RESEARCHER)
    generated = default_framework_instruction("esru")
    assert generated

    saved = c.put("/api/research/frameworks/esru/instruction", json={"instruction": "Ask, then act."}).json()
    assert saved["instruction"] == "Ask, then act."
    assert saved["isOverridden"] is True
    assert saved["overriddenBy"] == "r-1"
    assert saved["overrideVersion"] == 1
    # The generated text still travels, so the editor can always show the delta
    # and offer a truthful Revert.
    assert saved["defaultInstruction"] == generated

    # It persists across requests (it is the thing a live turn will read).
    assert c.get("/api/research/frameworks/esru").json()["instruction"] == "Ask, then act."

    reverted = c.delete("/api/research/frameworks/esru/instruction").json()
    assert reverted["isOverridden"] is False
    assert reverted["instruction"] == generated


def test_version_increments_so_sessions_stay_attributable():
    """1.1.92 attributes a scored session to what actually ran; an instruction
    edited in place with no version would orphan earlier sessions."""
    c = _client(RESEARCHER)
    for expected in (1, 2, 3):
        body = c.put("/api/research/frameworks/esru/instruction", json={"instruction": f"v{expected}"}).json()
        assert body["overrideVersion"] == expected


def test_provenance_comes_from_the_token_not_the_body():
    c = _client(RESEARCHER)
    body = c.put(
        "/api/research/frameworks/esru/instruction",
        json={"instruction": "x", "updatedBy": "somebody-else"},
    ).json()
    assert body["overriddenBy"] == "r-1"


def test_unknown_framework_404s_and_empty_instruction_rejected():
    c = _client(RESEARCHER)
    assert c.get("/api/research/frameworks/no-such").status_code == 404
    assert c.put("/api/research/frameworks/esru/instruction", json={"instruction": ""}).status_code == 422
