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
    # TUTOR-2 M0: a new approach is PRIVATE, so the other teacher's has to be
    # shared before it is in this teacher's list at all. That is the behaviour
    # change from 1.1.110, which listed every approach to every caller.
    _client(OTHER_TEACHER).put(
        "/api/research/frameworks/custom/custom-strict-coach/visibility", json={"visibility": "shared"}
    )

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


# ── the register (1.1.111) ───────────────────────────────────────────────────
#
# Tone stopped being a separate axis. These pin the reason it moved rather than
# the fact that it did.


def test_an_approach_with_no_register_says_nothing_about_voice():
    """The common case and the safe one: an approach that declares no register
    cannot contradict its own moves."""
    from db.framework_overrides import resolve_framework_instruction

    out = resolve_framework_instruction("esru")
    assert "Interaction style" not in out
    assert out  # and it still renders its moves


def test_a_register_is_rendered_after_the_moves_it_must_live_with():
    """Last position is the strong one on the "later instruction wins"
    convention this chain runs on — which is only correct because the register
    is now PART of the approach: whoever set it saw these moves beside it."""
    c = _client(RESEARCHER)
    body = _structure(c.get("/api/research/frameworks/esru").json())
    body["register"] = "rigorous"
    live = c.put("/api/research/frameworks/esru/structure", json=body).json()

    assert "Elicit" in live["instruction"]
    assert live["instruction"].rstrip().endswith("rigorous step.")


def test_the_register_travels_with_a_custom_approach():
    c = _client(TEACHER)
    created = c.post("/api/research/frameworks/custom", json={**_BODY, "register": "warm"}).json()
    assert created["register"] == "warm"

    from db.framework_overrides import resolve_framework_instruction

    out = resolve_framework_instruction(created["id"])
    assert "Be kind. Ask first." in out
    assert "Interaction style: Warm" in out


def test_an_unknown_register_is_refused_rather_than_ignored():
    c = _client(RESEARCHER)
    body = _structure(c.get("/api/research/frameworks/esru").json())
    body["register"] = "sarcastic"
    assert c.put("/api/research/frameworks/esru/structure", json=body).status_code == 422


def test_the_chat_log_records_the_approachs_register_not_a_retired_axis(monkeypatch):
    """The researcher lens shows this column. After 1.1.111 the standalone style
    reaches no prompt, so logging it would put an inert value where evidence
    goes — a finding manufactured from a dead field."""
    from adk import tutor_resolution
    from db.models.activity_config import ActivityConfig

    c = _client(RESEARCHER)
    body = _structure(c.get("/api/research/frameworks/esru").json())
    body["register"] = "rigorous"
    c.put("/api/research/frameworks/esru/structure", json=body)

    from datetime import UTC, datetime

    cfg = ActivityConfig(
        activityId="act-1",
        classId="c-1",
        teacherUid="t-1",
        updatedAt=datetime.now(UTC),
        frameworkId="esru",
        interactionStyle="concise",
    )
    monkeypatch.setattr(tutor_resolution, "resolve_active_config", lambda *a, **k: cfg, raising=False)
    ctx = tutor_resolution.resolve_teaching_context("act-1", cfg=cfg)

    # NOT "concise", which is what the retired axis said and what no longer
    # reaches the prompt.
    assert ctx.interaction_style == "rigorous"


# ── researcher cross-view (1.1.91 M4) ────────────────────────────────────────


def test_crossview_is_not_shadowed_by_the_framework_id_route():
    """FastAPI matches in DECLARATION order, so a catch-all `/{framework_id}`
    declared earlier swallows every literal path after it.

    This is pinned because the failure is plausible-looking rather than loud:
    `/crossview` resolved to `framework_id="crossview"` and answered
    **404 framework not found**, which reads like a missing framework rather
    than a missing route.
    """
    resp = _client(RESEARCHER).get("/api/research/frameworks/crossview")
    assert resp.status_code == 200
    assert "publishedApproaches" in resp.json()


def test_crossview_is_researcher_only():
    assert _client(TEACHER).get("/api/research/frameworks/crossview").status_code == 403


def test_crossview_shows_authored_approaches_with_their_author():
    """The point of M4: a researcher sees what TEACHERS built, and who built it."""
    _create(TEACHER)
    body = _client(RESEARCHER).get("/api/research/frameworks/crossview").json()

    authored = {a["id"]: a for a in body["authoredApproaches"]}
    assert "custom-warm-coach" in authored
    assert authored["custom-warm-coach"]["authorUid"] == "t-1"
    assert authored["custom-warm-coach"]["authorRole"] == "teacher"
    assert authored["custom-warm-coach"]["authored"] is True

    # The seven published ones come back too, marked as NOT authored — the
    # comparison is the point, not the teacher list alone.
    assert any(a["id"] == "esru" and a["authored"] is False for a in body["publishedApproaches"])


def test_unreadable_usage_reports_null_rather_than_zero(monkeypatch):
    """ "Never used" and "could not read the chat log" must not look alike.

    Zero is a finding about an approach; None is a fact about the query. The
    deploy-status footgun, applied to a usage column."""
    import analytics.tutor_crossview as cv

    monkeypatch.setattr(cv, "_approach_usage", lambda: {})
    body = _client(RESEARCHER).get("/api/research/frameworks/crossview").json()

    assert body["usageAvailable"] is False
    assert all(a["turns"] is None for a in body["publishedApproaches"])


def test_intent_and_use_are_reported_separately(monkeypatch):
    """A framework assigned once and never run is not busy. `tutorsAssigned`
    counts intent; `turns` counts what actually happened."""
    import analytics.tutor_crossview as cv

    monkeypatch.setattr(cv, "_approach_usage", lambda: {"esru": {"turns": 48, "sessions": 8}})
    body = _client(RESEARCHER).get("/api/research/frameworks/crossview").json()

    esru = next(a for a in body["publishedApproaches"] if a["id"] == "esru")
    assert esru["turns"] == 48
    assert "tutorsAssigned" in esru  # separate field, not folded into turns


def test_variants_are_reported_even_at_zero():
    """Built-and-unused is a different fact from not-built, and an absent
    category would read as the latter."""
    body = _client(RESEARCHER).get("/api/research/frameworks/crossview").json()
    assert "variantCount" in body


def test_zero_usage_is_zero_when_the_store_answered(monkeypatch):
    """The inverse of the previous test, and the one that was wrong first.

    A missing row in a READABLE chat log means the approach has taught nothing —
    a finding, and a real one: on prod only Authentic Dialogue has ever taught a
    turn. Reporting those as None ("could not read") inverts the distinction the
    field exists to make.
    """
    import analytics.tutor_crossview as cv

    monkeypatch.setattr(cv, "_approach_usage", lambda: {"esru": {"turns": 48, "sessions": 8}})
    body = _client(RESEARCHER).get("/api/research/frameworks/crossview").json()

    esru = next(a for a in body["publishedApproaches"] if a["id"] == "esru")
    others = [a for a in body["publishedApproaches"] if a["id"] != "esru"]
    assert esru["turns"] == 48
    assert others, "fixture would be vacuous with only one approach"
    assert all(a["turns"] == 0 for a in others)
    assert body["usageAvailable"] is True


def test_another_teachers_unshared_approach_is_not_in_your_list():
    """The 1.1.110 change, pinned. One teacher's half-drafted approach in
    everyone's list is the noise this removes."""
    _create(TEACHER)
    _client(OTHER_TEACHER).post("/api/research/frameworks/custom", json={**_BODY, "label": "Strict coach"})

    mine = {r["id"] for r in _client(TEACHER).get("/api/research/frameworks/custom/list").json()["approaches"]}
    assert "custom-warm-coach" in mine
    assert "custom-strict-coach" not in mine

    # ...and a researcher sees both, because researchers always see all.
    theirs = {r["id"] for r in _client(RESEARCHER).get("/api/research/frameworks/custom/list").json()["approaches"]}
    assert {"custom-warm-coach", "custom-strict-coach"} <= theirs


def test_sharing_an_approach_is_its_own_act_and_an_edit_never_does_it():
    """An edit that could change who sees a thing is an edit that shares it by
    accident — so the edit body has no visibility field at all."""
    _create(TEACHER)
    c = _client(TEACHER)
    c.put("/api/research/frameworks/custom/custom-warm-coach/visibility", json={"visibility": "shared"})
    assert "custom-warm-coach" in {
        r["id"] for r in _client(OTHER_TEACHER).get("/api/research/frameworks/custom/list").json()["approaches"]
    }

    c.put("/api/research/frameworks/custom/custom-warm-coach", json={**_BODY, "summary": "edited"})
    assert "custom-warm-coach" in {
        r["id"] for r in _client(OTHER_TEACHER).get("/api/research/frameworks/custom/list").json()["approaches"]
    }

    # A body that smuggles `visibility` is not rejected — CustomApproachBody
    # documents that extra fields are ignored, the same contract authorUid has —
    # but it must not take effect. Asserting the GUARANTEE (it stays shared),
    # not the mechanism (a 422 that would contradict that documented decision).
    c.put("/api/research/frameworks/custom/custom-warm-coach", json={**_BODY, "visibility": "private"})
    assert "custom-warm-coach" in {
        r["id"] for r in _client(OTHER_TEACHER).get("/api/research/frameworks/custom/list").json()["approaches"]
    }


# --- TUTOR-2 M1: the teacher's read of the published approaches --------------


def test_a_teacher_can_read_the_published_approaches():
    """1.1.135's premise: a teacher authoring a tutor must pick an approach
    somebody can read. Invisible approaches make that impossible."""
    body = _client(TEACHER).get("/api/research/frameworks/catalogue").json()
    ids = {a["id"] for a in body["approaches"]}
    assert ids == {"5e", "accountable-talk", "authentic-dialogue", "cer", "esru", "poe", "toulmin"}

    esru = next(a for a in body["approaches"] if a["id"] == "esru")
    # What the tutor is actually told — the reviewability principle TutorPicker
    # already states, honoured on this screen too.
    assert esru["instruction"]
    assert esru["constructs"]


def test_the_teacher_catalogue_is_a_different_shape_not_a_narrowed_one():
    """⚠️ The decision this route exists to respect. `GET /frameworks`'s own test
    says a teacher must 403 rather than receive a degraded researcher payload —
    so this carries reading material and NONE of the editor machinery (override
    state, the git default, the revert delta)."""
    esru = next(
        a for a in _client(TEACHER).get("/api/research/frameworks/catalogue").json()["approaches"] if a["id"] == "esru"
    )
    for editor_only in ("isOverridden", "defaultInstruction", "defaultConstructs", "overrideMode", "overrideVersion"):
        assert editor_only not in esru


def test_the_catalogue_route_is_not_swallowed_by_the_id_catch_all():
    """The trap `/crossview` documents: a single-segment catch-all declared
    earlier answers 404 framework not found for every literal after it."""
    res = _client(TEACHER).get("/api/research/frameworks/catalogue")
    assert res.status_code == 200
    assert "approaches" in res.json()


def test_reading_the_catalogue_still_does_not_let_a_teacher_edit():
    c = _client(TEACHER)
    assert c.get("/api/research/frameworks/catalogue").status_code == 200
    assert c.put("/api/research/frameworks/esru/structure", json={"summary": "x"}).status_code == 403
    assert c.get("/api/research/frameworks").status_code == 403


def test_a_student_gets_no_catalogue():
    assert _client(STUDENTISH).get("/api/research/frameworks/catalogue").status_code == 403


# ── 1.1.150 — sources on a custom approach, and who wrote it ─────────────────
#
# A source is what an approach is DERIVED from, as its author states it. It is
# metadata for the people who author and study approaches: never a vouched
# citation (that is `provenance`), never in the tutor's prompt, never on a
# student's wire.

_SOURCE = {"citation": "Brousseau (1997). Theory of Didactical Situations.", "url": "https://example.org/tds"}


def test_sources_rejected_on_a_published_framework():
    """The seven keep `provenance`, which is vouched. A published framework that
    could carry `sources` would be unvouched citations past review."""
    from db.models.teaching_framework import TeachingFramework

    with pytest.raises(ValueError, match="only a custom approach"):
        TeachingFramework(id="esru-2", label="ESRU", sources=[{"citation": "x"}])
    # Not even one whose YAML claims layer: custom — it is still not in Firestore.
    with pytest.raises(ValueError, match="only a custom approach"):
        TeachingFramework(id="x", label="X", layer="custom", source="yaml", sources=[{"citation": "x"}])
    # And every published framework, as loaded, carries none.
    from frameworks.loader import load_frameworks

    assert all(fw.sources == [] for fw in load_frameworks())


def test_source_fields_server_stamped(monkeypatch):
    """`addedBy` comes from the token, never the body — and survives a re-save
    by someone else, so a researcher's edit does not make a teacher's sources
    the researcher's."""
    forged = {**_SOURCE, "addedBy": "someone-else", "addedAt": "2001-01-01T00:00:00Z"}
    created = _create(TEACHER, sources=[forged])
    assert created["sources"][0]["addedBy"] == "t-1"
    assert created["sources"][0]["addedAt"] != "2001-01-01T00:00:00Z"
    first_added_at = created["sources"][0]["addedAt"]

    # A researcher re-saves it with the same source and one new one.
    second = {"citation": "Artigue (2009). Didactical design in mathematics education."}
    edited = (
        _client(RESEARCHER)
        .put(
            "/api/research/frameworks/custom/custom-warm-coach",
            json={**_BODY, "sources": [created["sources"][0], second]},
        )
        .json()
    )
    by_citation = {s["citation"]: s for s in edited["sources"]}
    assert by_citation[_SOURCE["citation"]]["addedBy"] == "t-1"
    assert by_citation[_SOURCE["citation"]]["addedAt"] == first_added_at
    assert by_citation[second["citation"]]["addedBy"] == "r-1"


def test_sources_round_trip_and_an_old_client_cannot_wipe_them():
    _create(TEACHER, sources=[_SOURCE])
    c = _client(TEACHER)
    # A save that predates the field (no `sources` key) keeps them.
    c.put("/api/research/frameworks/custom/custom-warm-coach", json={**_BODY, "summary": "Changed."})
    row = next(a for a in c.get("/api/research/frameworks/custom/list").json()["approaches"])
    assert [s["citation"] for s in row["sources"]] == [_SOURCE["citation"]]
    assert row["summary"] == "Changed."
    # An explicit empty list clears them.
    c.put("/api/research/frameworks/custom/custom-warm-coach", json={**_BODY, "sources": []})
    row = next(a for a in c.get("/api/research/frameworks/custom/list").json()["approaches"])
    assert row["sources"] == []


def test_sources_are_bounded_and_links_are_https_only():
    c = _client(TEACHER)
    too_many = [{"citation": f"Paper {i}"} for i in range(11)]
    assert c.post("/api/research/frameworks/custom", json={**_BODY, "sources": too_many}).status_code == 422
    for bad in ("http://example.org/x", "javascript:alert(1)"):
        r = c.post("/api/research/frameworks/custom", json={**_BODY, "sources": [{"citation": "x", "url": bad}]})
        assert r.status_code == 422, bad
    assert c.post("/api/research/frameworks/custom", json={**_BODY, "sources": [{"citation": "  "}]}).status_code == 422


def test_a_corpus_ref_is_a_researcher_act():
    """`corpusRef` points into the LITERATURE corpus, which is researcher-only.
    A teacher may not set one — but may re-save an approach a researcher
    annotated without being refused for it."""
    linked = {**_SOURCE, "corpusRef": "esru"}
    assert (
        _client(TEACHER).post("/api/research/frameworks/custom", json={**_BODY, "sources": [linked]}).status_code == 403
    )

    _create(TEACHER, sources=[_SOURCE])
    r = _client(RESEARCHER).put(
        "/api/research/frameworks/custom/custom-warm-coach", json={**_BODY, "sources": [linked]}
    )
    assert r.status_code == 200, r.text
    assert r.json()["sources"][0]["corpusRef"] == "esru"
    bogus = _client(RESEARCHER).put(
        "/api/research/frameworks/custom/custom-warm-coach",
        json={**_BODY, "sources": [{**_SOURCE, "corpusRef": "not-ingested"}]},
    )
    assert bogus.status_code == 400

    again = _client(TEACHER).put(
        "/api/research/frameworks/custom/custom-warm-coach", json={**_BODY, "sources": [linked]}
    )
    assert again.status_code == 200, again.text
    other = {**linked, "corpusRef": "cer"}
    assert (
        _client(TEACHER)
        .put("/api/research/frameworks/custom/custom-warm-coach", json={**_BODY, "sources": [other]})
        .status_code
        == 403
    )


def test_researcher_sees_others_approaches_as_not_own(monkeypatch):
    """The row that confused the seminar was an APPROACH. A researcher may edit
    it; it is not theirs; the row says whose it is."""
    monkeypatch.setattr(
        "protocols.authorship.resolve_owner_emails",
        lambda uids: {u: f"{u}@example.dk" for u in uids},
    )
    _create(TEACHER, label="Didaktisk Tutor")
    row = _client(RESEARCHER).get("/api/research/frameworks/custom/list").json()["approaches"][0]
    assert (row["canEdit"], row["isOwn"], row["authorRole"]) == (True, False, "teacher")
    assert row["authorEmail"] == "t-1@example.dk"

    own = _client(TEACHER).get("/api/research/frameworks/custom/list").json()["approaches"][0]
    assert own["isOwn"] is True
    assert "authorEmail" not in own


def test_approach_provenance_is_stamped_on_create_and_never_rewritten():
    created = _create(TEACHER)
    assert (created["createdBy"], created["createdVia"]) == ("t-1", "ui")
    assert created["createdAt"]
    copilot = _create(RESEARCHER, label="From the copilot", createdVia="copilot")
    assert copilot["createdVia"] == "copilot"

    c = _client(RESEARCHER)
    c.put("/api/research/frameworks/custom/custom-warm-coach", json={**_BODY, "summary": "x"})
    c.put("/api/research/frameworks/custom/custom-warm-coach/visibility", json={"visibility": "shared"})
    row = next(
        a for a in c.get("/api/research/frameworks/custom/list").json()["approaches"] if a["id"] == "custom-warm-coach"
    )
    assert (row["createdBy"], row["createdVia"], row["createdAt"]) == ("t-1", "ui", created["createdAt"])
    assert row["authorUid"] == "t-1"

    for via in ("seed", "sync", "adopt"):
        r = _client(TEACHER).post(
            "/api/research/frameworks/custom", json={**_BODY, "label": f"x {via}", "createdVia": via}
        )
        assert r.status_code == 422, via


# ── THE isolation test (1.1.150 acceptance criterion 5) ──────────────────────

_SENTINEL_CITATION = "ZZ-SOURCE-CITATION-7f3a"
_SENTINEL_URL = "https://example.org/ZZ-SOURCE-URL-9c1e"
_SENTINEL_NOTE = "ZZ-SOURCE-NOTE-4b2d"
_SENTINELS = (_SENTINEL_CITATION, "ZZ-SOURCE-URL-9c1e", _SENTINEL_NOTE)


def test_approach_sources_never_reach_the_student_turn(monkeypatch):
    """No source text, URL or note in the composed student instruction, and none
    on any response a real group token can obtain.

    Through the REAL agent path — ``create_agent`` and its instruction provider,
    for a class whose tutor teaches with the approach — not through
    ``resolve_framework_instruction`` alone: that would pass even if a callback
    later appended the sources. "Ask first." is asserted present so the test
    cannot pass by the approach simply not being wired.
    """
    import asyncio
    from types import SimpleNamespace

    from adk.agent import create_agent
    from auth import get_current_user as dispatcher_get_current_user
    from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group
    from db.firestore import get_document, set_document
    from db.models import SkillConfig, SkillMetadata
    from protocols.activity_config_routes import router as activity_config_router
    from protocols.personas_routes import router as personas_router
    from protocols.tutors_routes import router as tutors_router

    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    AnonymousGroupAuth.reset_for_tests()

    teacher_uid, class_id, activity = TEACHER.uid, "cls-sources", "act-sources"
    tag = f"class:{teacher_uid}:{class_id}"

    # 1. The teacher writes the approach, with sources carrying sentinels.
    teacher_app = FastAPI()
    teacher_app.include_router(router)
    teacher_app.include_router(tutors_router)

    async def _as_teacher(request: Request) -> User:
        request.state.access = build_access_context(TEACHER)
        return TEACHER

    teacher_app.dependency_overrides[get_current_user] = _as_teacher
    tc = TestClient(teacher_app)
    approach = tc.post(
        "/api/research/frameworks/custom",
        json={
            "label": "Didaktisk Tutor",
            "summary": "",
            "instructionText": "Ask first.",
            "sources": [{"citation": _SENTINEL_CITATION, "url": _SENTINEL_URL, "note": _SENTINEL_NOTE}],
        },
    )
    assert approach.status_code == 200, approach.text
    assert approach.json()["sources"][0]["citation"] == _SENTINEL_CITATION, "fixture did not store the source"

    # 2. A tutor teaching with it, on the teacher's class.
    tutor = tc.post(
        "/api/research/tutors",
        json={"id": "didaktisk", "displayName": "Didaktisk", "frameworkId": approach.json()["id"]},
    )
    assert tutor.status_code == 200, tutor.text
    set_document(
        "classes",
        class_id,
        {
            "classId": class_id,
            "ownerUid": teacher_uid,
            "name": "Fysik B",
            "tagNamespace": tag,
            "tutorId": "didaktisk",
            "createdAt": "2026-10-01T00:00:00+00:00",
            "updatedAt": "2026-10-05T00:00:00+00:00",
        },
    )

    # 3. A REAL group token, minted the way production does, bound to the class.
    record = create_group(title="Fysik B", skill_ids=["concept-dialogue"], creator_uid=teacher_uid)
    set_document(
        "anon_groups", record.group_id, {**(get_document("anon_groups", record.group_id) or {}), "classId": class_id}
    )
    token = join_group(record.group_id, client_ip="203.0.113.7").token

    student_app = FastAPI()
    for r in (activity_config_router, tutors_router, router, personas_router):
        student_app.include_router(r)
    sc = TestClient(student_app)
    headers = {"Authorization": f"Bearer {token}"}

    # The student surface accepts the token — so what follows is about content,
    # not about a token that was never valid.
    active = sc.get(f"/api/activity-configs/active/{activity}", headers=headers)
    assert active.status_code == 200, active.text

    # 4. The full student instruction, through the real agent build.
    from fastapi import Depends

    probe = FastAPI()

    @probe.get("/whoami")
    async def _whoami(user: User = Depends(dispatcher_get_current_user)) -> dict:  # noqa: B008
        return {"uid": user.uid, "group_id": user.group_id, "tags": sorted(user.group_tags or [])}

    who = TestClient(probe).get("/whoami", headers=headers).json()
    assert tag in who["tags"], "the minted token is not bound to the class"
    student = User(
        uid=who["uid"],
        email="",
        domain="",
        group_id=who["group_id"],
        group_tags=who["tags"],
        auth_mode="anonymous_group",
    )
    skill = SkillConfig(
        name="concept-dialogue",
        description="t",
        instructions="You are a tutor.",
        skillId="22222222-2222-2222-2222-222222222222",
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
    )
    agent = create_agent(skill, student, activity_id=activity)
    ctx = SimpleNamespace(state={}, user_content=None, session=SimpleNamespace(events=[], id="s"), user_id="u")
    instruction = asyncio.run(agent.instruction(ctx))

    assert "Ask first." in instruction, "the approach is not wired into the student turn — the test proves nothing"
    for sentinel in _SENTINELS:
        assert sentinel not in instruction, f"a source reached the student's instruction: {sentinel}"

    # 5. Every student-reachable response for this token, and the staff routes it
    #    must be refused — none may carry a source.
    bodies = [active.text]
    for path in (
        f"/api/activity-configs/active/{activity}",
        "/api/tutors",
        "/api/tutors/didaktisk",
        "/api/personas",
        "/api/research/frameworks/custom/list",
        "/api/research/frameworks/catalogue",
        f"/api/research/frameworks/{approach.json()['id']}",
    ):
        resp = sc.get(path, headers=headers)
        bodies.append(resp.text)
        if path.startswith(("/api/tutors", "/api/research")):
            assert resp.status_code in (401, 403), f"{path} answered a student token with {resp.status_code}"
    for body in bodies:
        for sentinel in _SENTINELS:
            assert sentinel not in body, f"a source reached a group-token response: {sentinel}"

    AnonymousGroupAuth.reset_for_tests()
