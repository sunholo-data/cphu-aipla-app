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
    """1.1.110: the edit is structural — there is no hand-written path left."""
    c = _client(RESEARCHER)
    generated = default_framework_instruction("esru")
    assert generated

    body = _structure(c.get("/api/research/frameworks/esru").json())
    body["constructs"] = [{"name": "elicit", "behaviours": [{"text": "Ask, then act."}], "avoid": []}]
    saved = c.put("/api/research/frameworks/esru/structure", json=body).json()
    assert saved["isOverridden"] is True
    assert saved["overriddenBy"] == "r-1"
    assert saved["overrideVersion"] == 1
    assert saved["overrideMode"] == "structured"
    # The generated text still travels, so the editor can always show the delta
    # and offer a truthful Revert.
    assert saved["defaultInstruction"] == generated

    # It persists across requests (it is the thing a live turn will read).
    live = c.get("/api/research/frameworks/esru").json()["instruction"]
    assert "Ask, then act." in live
    assert live != generated

    reverted = c.delete("/api/research/frameworks/esru/instruction").json()
    assert reverted["isOverridden"] is False
    assert reverted["instruction"] == generated


def test_version_increments_so_sessions_stay_attributable():
    """1.1.92 attributes a scored session to what actually ran; a framework
    edited in place with no version would orphan earlier sessions."""
    c = _client(RESEARCHER)
    base = _structure(c.get("/api/research/frameworks/esru").json())
    for expected in (1, 2, 3):
        base["summary"] = f"v{expected}"
        body = c.put("/api/research/frameworks/esru/structure", json=base).json()
        assert body["overrideVersion"] == expected


def test_there_is_no_route_that_hand_writes_an_instruction():
    """The removal, pinned.

    Free-text instruction editing was the only path capable of producing a
    tutor prompt that no reader could check against a source. Re-adding the
    route would restore that hole silently, and the override collections were
    empty on all three environments when it was removed, so nothing depends on
    it.
    """
    c = _client(RESEARCHER)
    resp = c.put("/api/research/frameworks/esru/instruction", json={"instruction": "anything"})
    assert resp.status_code == 405, "PUT .../instruction must not exist"


def test_provenance_comes_from_the_token_not_the_body():
    """Who edited a research instrument is never a client-supplied field."""
    c = _client(RESEARCHER)
    body = _structure(c.get("/api/research/frameworks/esru").json())
    body["updatedBy"] = "somebody-else"
    saved = c.put("/api/research/frameworks/esru/structure", json=body).json()
    # The body's claim is not rejected — it is simply never consulted. The route
    # passes the VERIFIED uid, so what gets stored is who actually called.
    assert saved["overriddenBy"] == "r-1"


def test_unknown_framework_404s():
    c = _client(RESEARCHER)
    assert c.get("/api/research/frameworks/no-such").status_code == 404


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


def test_a_legacy_text_row_is_still_honoured_by_the_read_path():
    """No route writes one; a row could still exist from before 1.1.110.

    Honouring it is right — a researcher's saved work must not silently stop
    being used — and the catalogue must report it as an override so it is
    visible rather than looking like a published framework.
    """
    from db.firestore import set_document

    set_document(
        "framework_overrides",
        "cer",
        {"instruction": "Hand written, long ago.", "mode": "text", "version": 1},
        merge=False,
    )
    c = _client(RESEARCHER)
    live = c.get("/api/research/frameworks/cer").json()
    assert live["instruction"] == "Hand written, long ago."
    assert live["isOverridden"] is True
    assert live["overrideMode"] == "text"
    # And it is revertible, which is the only edit action left for such a row.
    assert c.delete("/api/research/frameworks/cer/instruction").json()["isOverridden"] is False


# ── custom approaches (1.1.110) ──────────────────────────────────────────────
#
# The tier rules, which are the part most likely to be got wrong by a later
# change: the published frameworks stay researcher-only, and custom approaches
# are the one thing on this screen a teacher may edit.

OTHER_TEACHER = User(uid="t-2", is_teacher=True)
STUDENTISH = User(uid="s-1", is_teacher=False)

_BODY = {"label": "Warm coach", "summary": "Encouraging.", "instructionText": "Be kind. Ask first."}


def _create(user: User, **over) -> dict:
    return _client(user).post("/api/research/frameworks/custom", json={**_BODY, **over}).json()


def test_a_teacher_can_create_and_edit_their_own_approach():
    c = _client(TEACHER)
    created = c.post("/api/research/frameworks/custom", json=_BODY)
    assert created.status_code == 200
    body = created.json()
    assert body["id"] == "custom-warm-coach"
    assert body["layer"] == "custom"
    assert body["authorUid"] == "t-1"
    assert body["authorRole"] == "teacher"
    assert body["canEdit"] is True
    # Usable immediately — nobody owes a teacher's own approach a sign-off.
    assert body["status"] == "ready"

    edited = c.put(
        "/api/research/frameworks/custom/custom-warm-coach",
        json={**_BODY, "instructionText": "Be kind. Always ask first."},
    ).json()
    assert edited["instructionText"] == "Be kind. Always ask first."


def test_a_teacher_cannot_edit_another_teachers_approach():
    _create(TEACHER)
    c = _client(OTHER_TEACHER)
    assert c.put("/api/research/frameworks/custom/custom-warm-coach", json=_BODY).status_code == 403
    assert c.delete("/api/research/frameworks/custom/custom-warm-coach").status_code == 403


def test_a_researcher_may_edit_anyones_approach_without_stealing_it():
    """A researcher can fix a teacher's approach; doing so must not quietly
    reassign authorship, or the register of who wrote what stops being true."""
    _create(TEACHER)
    edited = (
        _client(RESEARCHER)
        .put(
            "/api/research/frameworks/custom/custom-warm-coach",
            json={**_BODY, "summary": "Tidied."},
        )
        .json()
    )
    assert edited["summary"] == "Tidied."
    assert edited["authorUid"] == "t-1"
    assert edited["authorRole"] == "teacher"


def test_a_teacher_still_cannot_touch_the_published_frameworks():
    """The whole point of the split. A teacher may author their own pedagogy and
    may not edit ESRU."""
    c = _client(TEACHER)
    assert c.put("/api/research/frameworks/esru/structure", json={"summary": "x"}).status_code == 403
    assert c.delete("/api/research/frameworks/esru/instruction").status_code == 403
    assert c.get("/api/research/frameworks").status_code == 403


def test_a_non_teacher_gets_nothing():
    c = _client(STUDENTISH)
    assert c.post("/api/research/frameworks/custom", json=_BODY).status_code == 403
    assert c.get("/api/research/frameworks/custom/list").status_code == 403


def test_can_edit_is_computed_server_side_per_row():
    """Sent per row rather than left to the client to derive. A UI deriving it
    would be a second copy of the rule, and the two would disagree the first
    time one changed."""
    _create(TEACHER)
    _client(OTHER_TEACHER).post("/api/research/frameworks/custom", json={**_BODY, "label": "Strict coach"})

    rows = _client(TEACHER).get("/api/research/frameworks/custom/list").json()["approaches"]
    by_id = {r["id"]: r for r in rows}
    assert by_id["custom-warm-coach"]["canEdit"] is True
    assert by_id["custom-strict-coach"]["canEdit"] is False

    rows_r = _client(RESEARCHER).get("/api/research/frameworks/custom/list").json()["approaches"]
    assert all(r["canEdit"] for r in rows_r)


def test_duplicate_label_is_refused_rather_than_silently_overwriting():
    _create(TEACHER)
    assert _client(OTHER_TEACHER).post("/api/research/frameworks/custom", json=_BODY).status_code == 409


def test_a_custom_approach_reaches_a_tutor_prompt():
    """The end of the chain — an approach nobody can edit into the tutor's
    prompt would be a settings screen, not a feature."""
    from db.framework_overrides import resolve_framework_instruction

    _create(TEACHER)
    out = resolve_framework_instruction("custom-warm-coach")
    assert "Be kind. Ask first." in out
    # Rendered as an APPROACH, not as a framework from the literature, and
    # without the "work through its moves in order" preface — there are no moves
    # and telling a model to follow a structure that is not there invites it to
    # invent one.
    assert out.startswith("## Teaching approach: Warm coach")
    assert "moves in order" not in out


def test_a_custom_approach_has_no_revert_target():
    """There is no published version to go back to, and offering a Revert that
    silently does nothing is worse than offering none."""
    from db.framework_overrides import default_framework_instruction as dfi

    _create(TEACHER)
    assert dfi("custom-warm-coach") == ""


# ── source passages (1.1.110) ────────────────────────────────────────────────


def test_passage_search_is_researcher_only():
    """Verbatim extracts from copyrighted journal articles. A teacher authoring
    their own approach has no business in them, and no student surface can
    reach the corpus at all (check-literature-corpus-isolation.sh)."""
    assert (
        _client(TEACHER).post("/api/research/frameworks/esru/sources/search", json={"query": "wait time"}).status_code
        == 403
    )


def test_an_unconfigured_corpus_is_REPORTED_not_rendered_as_no_passages(monkeypatch):
    """ "No corpus" and "the paper does not support this" must not look alike.

    The second is a finding about the literature; producing it from an
    unprovisioned environment would be the deploy-status footgun applied to a
    citation.
    """
    import db.literature_corpus as lit

    monkeypatch.setattr(lit, "get_literature_corpus_name", lambda: None)
    body = _client(RESEARCHER).post("/api/research/frameworks/esru/sources/search", json={"query": "wait time"}).json()
    assert body["configured"] is False
    assert body["passages"] == []


def test_passages_come_back_with_the_frameworks_own_citations(monkeypatch):
    """The citation is resolved from the framework's provenance, not stored in
    the corpus beside the text — one source of truth for what a paper is called.
    """
    import db.literature_corpus as lit

    async def fake_query(query, *, top_k=5, framework_id=None):
        return [
            {"text": "the dimensions ... are used only in the eliciting phase", "frameworkId": "esru", "score": 0.3}
        ]

    monkeypatch.setattr(lit, "get_literature_corpus_name", lambda: "projects/p/locations/europe-north1/ragCorpora/1")
    monkeypatch.setattr(lit, "query_literature", fake_query)

    body = (
        _client(RESEARCHER)
        .post("/api/research/frameworks/esru/sources/search", json={"query": "eliciting phase"})
        .json()
    )
    assert body["configured"] is True
    assert "eliciting phase" in body["passages"][0]["text"]
    assert any("Ruiz-Primo" in c["citation"] for c in body["citations"])
    assert all(c["vouchedBy"] for c in body["citations"])


def test_a_custom_approach_has_no_literature_to_search():
    """It was written, not drafted from a paper. Returning an empty list would
    imply the search ran and found nothing in a corpus it never had."""
    _create(TEACHER)
    resp = _client(RESEARCHER).post(
        "/api/research/frameworks/custom-warm-coach/sources/search", json={"query": "kindness"}
    )
    assert resp.status_code == 400
    assert "authored, not drafted" in resp.json()["detail"]
