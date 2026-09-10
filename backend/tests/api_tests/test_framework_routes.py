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


# ── structural editing (TUTOR-4) ─────────────────────────────────────────────
#
# The point of this surface: a researcher edits the THEORY, and the instruction
# is regenerated from it. Editing the rendered text can say anything at all;
# editing constructs keeps the prompt checkable against its own sources, which
# is the property the whole framework layer exists for.


def _structure(fw: dict) -> dict:
    """The editable body of a framework, as the editor would send it back."""
    return {
        "summary": fw["summary"],
        "constructs": fw["constructs"],
        "provenance": fw["provenance"],
    }


def test_structural_edit_regenerates_the_instruction():
    """A construct edit must reach the tutor through the generator, not as text."""
    c = _client(RESEARCHER)
    fw = c.get("/api/research/frameworks/cer").json()
    body = _structure(fw)
    body["constructs"][0]["behaviours"].append({"text": "Ask them to name the missing component."})

    saved = c.put("/api/research/frameworks/cer/structure", json=body)
    assert saved.status_code == 200, saved.text

    live = c.get("/api/research/frameworks/cer").json()
    assert "Ask them to name the missing component." in live["instruction"]
    assert live["isOverridden"] is True
    assert live["overrideMode"] == "structured"
    # The git render still travels beside it, so Revert can tell the truth.
    assert "Ask them to name the missing component." not in live["defaultInstruction"]
    assert live["defaultInstruction"] == default_framework_instruction("cer")


def test_structural_edit_is_reverted_by_deleting_the_override():
    c = _client(RESEARCHER)
    before = c.get("/api/research/frameworks/poe").json()["instruction"]
    body = _structure(c.get("/api/research/frameworks/poe").json())
    body["summary"] = "Edited summary."
    c.put("/api/research/frameworks/poe/structure", json=body)
    assert c.get("/api/research/frameworks/poe").json()["instruction"] != before

    c.delete("/api/research/frameworks/poe/instruction")
    after = c.get("/api/research/frameworks/poe").json()
    assert after["instruction"] == before
    assert after["isOverridden"] is False
    assert after["overrideMode"] is None


def test_a_citation_cannot_be_saved_without_a_human_voucher():
    """The never-invent-a-citation rule, enforced by the type system.

    ``Provenance.vouched_by`` has no default and no empty value, so an unvouched
    source is unconstructable. This is the guard that has to still be standing
    when the M2 co-pilot is the thing filling the field in.
    """
    c = _client(RESEARCHER)
    body = _structure(c.get("/api/research/frameworks/toulmin").json())
    body["provenance"].append({"citation": "Invented, A. (2031). A paper that does not exist."})
    assert c.put("/api/research/frameworks/toulmin/structure", json=body).status_code == 422

    body["provenance"][-1]["vouchedBy"] = ""
    assert c.put("/api/research/frameworks/toulmin/structure", json=body).status_code == 422


def test_structure_cannot_be_emptied_into_a_silent_no_op():
    """A framework with no constructs renders nothing, which would turn the
    tutor's teaching off while still showing it as configured. Revert is DELETE;
    this is not that."""
    c = _client(RESEARCHER)
    body = _structure(c.get("/api/research/frameworks/5e").json())
    body["constructs"] = []
    r = c.put("/api/research/frameworks/5e/structure", json=body)
    assert r.status_code == 422
    assert "at least one construct" in r.text


def test_preview_renders_without_saving():
    """The live preview has to come from the real generator — a client-side
    approximation would drift from what the tutor is actually told."""
    c = _client(RESEARCHER)
    fw = c.get("/api/research/frameworks/esru").json()
    body = _structure(fw)
    body["constructs"][0]["behaviours"].append({"text": "A previewed behaviour."})

    preview = c.post("/api/research/frameworks/esru/structure/preview", json=body).json()
    assert "A previewed behaviour." in preview["instruction"]
    # …and nothing was written.
    assert c.get("/api/research/frameworks/esru").json()["isOverridden"] is False


def test_structure_routes_are_researcher_only():
    c = _client(TEACHER)
    assert c.put("/api/research/frameworks/cer/structure", json={"constructs": []}).status_code == 403
    assert c.post("/api/research/frameworks/cer/structure/preview", json={}).status_code == 403


def test_a_text_edit_drops_a_previous_structure():
    """The two are alternative answers to "what is this framework", not layers.
    A structure left underneath a hand-written instruction is a trap for whoever
    opens the structural editor next."""
    c = _client(RESEARCHER)
    body = _structure(c.get("/api/research/frameworks/cer").json())
    body["summary"] = "Structured edit."
    c.put("/api/research/frameworks/cer/structure", json=body)

    c.put("/api/research/frameworks/cer/instruction", json={"instruction": "Hand written."})
    live = c.get("/api/research/frameworks/cer").json()
    assert live["instruction"] == "Hand written."
    assert live["overrideMode"] == "text"
    # The structure is gone, so the editor reopens on the git default.
    assert live["summary"] == live["defaultSummary"]
