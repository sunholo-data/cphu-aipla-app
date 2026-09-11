"""1.1.91 M1 — /api/tutors and /api/research/tutors.

Headline: teachers READ the catalogue, only researchers author; a dangling
persona/framework reference is a 400 at author time rather than a silently
inert tutor in a classroom; and no framework is ever offered to a teacher as a
bare acronym.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth.access_context import build_access_context
from auth.firebase_auth import User, get_current_user
from db import firestore as fs_module
from protocols.tutors_routes import router

RESEARCHER = User(uid="r-1", is_teacher=True, is_researcher=True)

#: The persona-backed base tutors, spelled out on purpose. Deriving this from
#: the loader the route itself reads would make the assertions tautological —
#: their job is to notice a tutor appearing or disappearing, which only an
#: independent list can do. Adding a persona is one edit here.
BASE_TUTOR_IDS = {"amina", "astrid", "frida", "henrik", "jonas", "mikkel", "sofie"}
TEACHER = User(uid="t-1", is_teacher=True)
STUDENT = User(uid="grp-1", is_teacher=False)


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


def test_a_teacher_reads_the_catalogue_but_cannot_author():
    c = _client(TEACHER)
    assert c.get("/api/tutors").status_code == 200
    assert c.post("/api/research/tutors", json={"id": "x-1", "displayName": "X"}).status_code == 403
    assert (
        c.post("/api/research/tutors/variant", json={"parentId": "sofie", "id": "x-1", "displayName": "X"}).status_code
        == 403
    )


def test_a_student_reaches_none_of_it():
    c = _client(STUDENT)
    assert c.get("/api/tutors").status_code == 403


def test_catalogue_ships_every_base_tutor_with_no_framework():
    """The safety property, asserted at the API boundary: picking a base tutor
    cannot change how an activity teaches."""
    body = _client(TEACHER).get("/api/tutors").json()
    assert {t["id"] for t in body["tutors"]} == BASE_TUTOR_IDS
    for t in body["tutors"]:
        assert t["frameworkId"] is None
        assert t["isVariant"] is False
        assert t["persona"]["avatar"], "a picker card needs an avatar"


def test_frameworks_are_never_offered_as_a_bare_acronym():
    """A teacher should not have to know what ESRU stands for."""
    body = _client(TEACHER).get("/api/tutors").json()
    esru = next(f for f in body["frameworks"] if f["id"] == "esru")
    assert esru["name"] == "Question-and-use cycle (ESRU)"
    dysthe = next(f for f in body["frameworks"] if f["id"] == "authentic-dialogue")
    assert dysthe["name"].startswith("Open dialogue (")
    # Every framework in the catalogue has been drafted from its source since
    # 2026-09-10, so nothing is greyed out any more. The flag still has to be
    # SERVED — the picker greys out on it, and a future slot would need it.
    assert all("isPlaceholder" in f for f in body["frameworks"])
    assert sum(1 for f in body["frameworks"] if f["isPlaceholder"]) == 0
    # The real point of this test, applied to all seven rather than the two that
    # happened to be written when it was authored: nothing is offered to a
    # teacher as a bare acronym, and nothing says its own name twice.
    for f in body["frameworks"]:
        assert f["name"] and f["name"] != f["id"].upper(), f
        assert f["name"].count("(") <= 1, f"{f['id']} nests brackets: {f['name']}"


def test_researcher_creates_a_variant_that_carries_persona_and_framework():
    c = _client(RESEARCHER)
    r = c.post(
        "/api/research/tutors/variant",
        json={
            "parentId": "sofie",
            "id": "sofie-esru",
            "displayName": "Sofie — lab coach",
            "frameworkId": "esru",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["frameworkId"] == "esru"
    assert body["frameworkName"] == "Question-and-use cycle (ESRU)"
    assert body["persona"]["id"] == "sofie"
    assert body["lineage"]["parentTutorId"] == "sofie"
    assert body["isVariant"] is True

    # The parent is untouched and still framework-free.
    assert _client(TEACHER).get("/api/tutors/sofie").json()["frameworkId"] is None


def test_a_dangling_reference_is_rejected_at_author_time():
    """A tutor pointing at a framework that does not exist would resolve to "no
    framework" and teach as though it had none — inert, with nothing to see."""
    c = _client(RESEARCHER)
    bad_fw = c.post(
        "/api/research/tutors/variant",
        json={"parentId": "sofie", "id": "v-1", "displayName": "V", "frameworkId": "no-such"},
    )
    assert bad_fw.status_code == 400 and "framework" in bad_fw.json()["detail"]
    bad_persona = c.post("/api/research/tutors", json={"id": "v-2", "displayName": "V", "personaId": "no-such"})
    assert bad_persona.status_code == 400 and "persona" in bad_persona.json()["detail"]


def test_unknown_parent_404s_and_duplicate_id_409s():
    c = _client(RESEARCHER)
    assert (
        c.post("/api/research/tutors/variant", json={"parentId": "ghost", "id": "v-3", "displayName": "V"}).status_code
        == 404
    )
    assert (
        c.post(
            "/api/research/tutors/variant", json={"parentId": "sofie", "id": "sofie", "displayName": "V"}
        ).status_code
        == 409
    )


def test_ids_are_slug_shaped():
    c = _client(RESEARCHER)
    assert c.post("/api/research/tutors", json={"id": "Not A Slug", "displayName": "X"}).status_code == 400


def test_deleting_an_authored_tutor_falls_back_to_the_yaml_base():
    """The YAML catalogue is the floor — deleting can never empty the list."""
    c = _client(RESEARCHER)
    c.post("/api/research/tutors", json={"id": "sofie", "displayName": "Sofie (overridden)"})
    assert _client(TEACHER).get("/api/tutors/sofie").json()["displayName"] == "Sofie (overridden)"
    c.delete("/api/research/tutors/sofie")
    assert _client(TEACHER).get("/api/tutors/sofie").json()["displayName"].startswith("Sofie —")


# ── M7: the migrated SKILL.md tutors ─────────────────────────────────────────


def _seed_tutors():
    from admin.platform_seed import seed

    return seed().tutors_synced


def test_only_the_four_student_facing_skills_become_tutors():
    """manage-class, analytics-chat, activity-authoring-assistant and
    aipla-help are TEACHER TOOLS on the same SKILL.md mechanism. Migrating one
    would put a class-management assistant in the tutor catalogue and, worse,
    into the 1.1.92 matrix as an arm."""
    assert set(_seed_tutors()) == {
        "concept-dialogue",
        "kinebot-kinematics-tutor",
        "led-planck-tutor",
        "problem-set-hints",
    }


def test_migrated_tutors_carry_no_framework():
    """None of the four operationalises a named theory. Back-filling one would
    make an unfounded claim look founded — and null IS the finding: they are the
    baseline the framework tutors are measured against (1.1.107)."""
    _seed_tutors()
    body = _client(TEACHER).get("/api/tutors").json()
    assert body["skillBoundTutors"], "the migrated four should be addressable"
    for t in body["skillBoundTutors"]:
        assert t["frameworkId"] is None
        assert t["interactionStyle"] == "socratic", "socratic is the passthrough — no prompt change"
        assert t["skillName"] == t["id"]


def test_skill_bound_tutors_are_not_offered_as_a_class_identity():
    """Choosing "KineBot" for a class whose activity runs concept-dialogue is
    incoherent, so they are excluded from the pickable list — but still
    reachable by id."""
    _seed_tutors()
    body = _client(TEACHER).get("/api/tutors").json()
    assert all(not t["isSkillBound"] for t in body["tutors"])
    assert {t["id"] for t in body["tutors"]} == BASE_TUTOR_IDS
    assert _client(TEACHER).get("/api/tutors/kinebot-kinematics-tutor").status_code == 200


def test_reseeding_is_idempotent_and_does_not_revert_a_human_edit():
    """The seed owns the git baseline; it must not silently undo a researcher's
    change on the next deploy."""
    from db.tutors import get_authored_tutor, save_tutor

    _seed_tutors()
    edited = get_authored_tutor("led-planck-tutor")
    assert edited is not None
    save_tutor(edited.model_copy(update={"display_name": "Edited by a human"}), updated_by="r-1")

    _seed_tutors()
    after = get_authored_tutor("led-planck-tutor")
    assert after is not None and after.display_name == "Edited by a human"
    # An untouched one still tracks the template.
    assert get_authored_tutor("concept-dialogue").display_name.startswith("Begrebsdialog")


# ── researcher assigns a teaching approach to a tutor (TUTOR-4) ──────────────
#
# Base tutors ship with frameworkId: null because "Sofie teaches with ESRU" is a
# pedagogical claim and the catalogue does not make claims nobody signed off.
# Assignment is where a named researcher makes that claim, in the app, on the
# record — so the YAML stays null and the claim lives with its author.


def test_researcher_assigns_a_framework_to_a_default_tutor():
    c = _client(RESEARCHER)
    before = c.get("/api/tutors/sofie").json()
    assert before["frameworkId"] is None, "a base tutor must ship with no framework"

    r = c.put("/api/research/tutors/sofie/framework", json={"frameworkId": "esru"})
    assert r.status_code == 200, r.text
    assert r.json()["tutor"]["frameworkId"] == "esru"
    assert r.json()["assignment"]["updatedBy"] == "r-1", "provenance is not optional"

    # It reaches the resolver, so it is what actually teaches.
    from db.tutors import resolve_tutor

    assert resolve_tutor("sofie").framework_id == "esru"
    # …and the teacher's picker agrees with the resolver.
    listed = next(t for t in c.get("/api/tutors").json()["tutors"] if t["id"] == "sofie")
    assert listed["frameworkId"] == "esru"


def test_clearing_the_assignment_restores_the_catalogue_default():
    c = _client(RESEARCHER)
    c.put("/api/research/tutors/astrid/framework", json={"frameworkId": "cer"})
    assert c.get("/api/tutors/astrid").json()["frameworkId"] == "cer"

    assert c.delete("/api/research/tutors/astrid/framework").status_code == 200
    assert c.get("/api/tutors/astrid").json()["frameworkId"] is None


def test_an_explicit_none_is_not_the_same_as_no_assignment():
    """A researcher must be able to say "this one teaches with no framework" and
    have it override a framework the tutor itself carries. Testing the ROW
    rather than the truthiness of the id is what makes that possible."""
    from db.tutor_assignments import get_assignment

    c = _client(RESEARCHER)
    c.put("/api/research/tutors/frida/framework", json={"frameworkId": None})
    assert get_assignment("frida") is not None
    assert get_assignment("frida")["frameworkId"] is None


def test_a_placeholder_framework_cannot_be_assigned(monkeypatch):
    """Assigning one would produce a tutor announcing an approach it cannot
    teach with. The variant dialog already refuses; the server has to as well,
    so it holds for every caller."""
    from db.models.teaching_framework import TeachingFramework

    empty = TeachingFramework(id="slot-only", label="Slot only", status="placeholder")
    monkeypatch.setattr(
        "protocols.tutors_routes.effective_framework",
        lambda fid: empty if fid == "slot-only" else None,
    )
    c = _client(RESEARCHER)
    r = c.put("/api/research/tutors/sofie/framework", json={"frameworkId": "slot-only"})
    assert r.status_code == 400
    assert "no drafted teaching moves" in r.text


def test_unknown_tutor_and_framework_are_refused():
    c = _client(RESEARCHER)
    assert c.put("/api/research/tutors/nope/framework", json={"frameworkId": "esru"}).status_code == 404
    assert c.put("/api/research/tutors/sofie/framework", json={"frameworkId": "nope"}).status_code == 400


def test_assignment_is_researcher_only():
    r = _client(TEACHER).put("/api/research/tutors/sofie/framework", json={"frameworkId": "esru"})
    assert r.status_code == 403


def test_assigning_to_a_skill_md_tutor_does_not_freeze_it_against_the_seed():
    """THE reason this is a separate store rather than a field on the tutor.

    ``admin.tutor_migration`` deliberately skips any tutor a human has edited, so
    writing the assignment into the tutor document would have cut a SKILL.md
    tutor off from every future template change — silently, with the failure only
    surfacing later as "my SKILL.md edit didn't ship".
    """
    from admin.tutor_migration import sync_tutor_for_template
    from db.tutors import get_authored_tutor, resolve_tutor

    parsed = {
        "isTutor": True,
        "name": "led-planck-tutor",
        "displayName": "LED Planck tutor",
        "description": "Original description.",
    }
    assert sync_tutor_for_template(parsed) == "led-planck-tutor"

    c = _client(RESEARCHER)
    assert c.put("/api/research/tutors/led-planck-tutor/framework", json={"frameworkId": "poe"}).status_code == 200
    assert resolve_tutor("led-planck-tutor").framework_id == "poe"

    # The tutor document is untouched, so the seed still owns it…
    assert get_authored_tutor("led-planck-tutor").author_uid == "platform-seed"
    # …and a later SKILL.md change still lands.
    parsed["description"] = "Edited in the template."
    assert sync_tutor_for_template(parsed) == "led-planck-tutor"
    assert get_authored_tutor("led-planck-tutor").summary == "Edited in the template."
    # The researcher's assignment survives the seed run.
    assert resolve_tutor("led-planck-tutor").framework_id == "poe"
