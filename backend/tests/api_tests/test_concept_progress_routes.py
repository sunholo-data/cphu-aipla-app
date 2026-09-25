"""CONCEPT-1 M3 — GET /api/activities/{id}/concept-progress.

Headline: the ADR-001 dual-audience corner. A GROUP token (anonymous student:
empty email/domain, group_id claim) reads its OWN group's states; the OWNING
teacher reads all groups; anyone else 404s (enumeration-resistant).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, get_current_user
from auth.access_context import build_access_context
from db import firestore as fs_module
from db.activities import create_activity
from db.classes import create_class, get_class
from db.concept_progress import get_node_states, record_checkpoint_state, record_concept_evidence
from db.models.activity import Activity
from db.models.activity_config import ConceptMapElement, ConceptNode
from db.models.class_ import Class
from protocols.concept_progress_routes import class_router, router

GROUP = "grp-7b"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.include_router(class_router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _student(group_id: str = GROUP) -> User:
    # The anonymous-group shape: empty email/domain, synthetic uid, group claim.
    return User(uid="student-anon", group_id=group_id, group_tags=frozenset({"class:t-1:cls-1"}))


def _seed_activity(owner: str = "t-1") -> str:
    a = create_activity(Activity(activityId="", skillId="concept", ownerUid=owner, title="A"))
    return a.activity_id


def test_group_token_reads_its_own_states_only():
    aid = _seed_activity()
    record_checkpoint_state(GROUP, aid, "vektorer", "demonstrated", "ok")
    record_checkpoint_state("grp-other", aid, "vektorer", "partial", "x")

    res = _client(_student()).get(f"/api/activities/{aid}/concept-progress")
    assert res.status_code == 200
    body = res.json()
    assert body["nodeStates"]["vektorer"]["status"] == "demonstrated"
    assert "groups" not in body  # a student never sees other groups


def test_group_token_with_no_state_gets_an_empty_map():
    aid = _seed_activity()
    res = _client(_student()).get(f"/api/activities/{aid}/concept-progress")
    assert res.status_code == 200
    assert res.json() == {"nodeStates": {}}


def test_owner_reads_all_groups_coverage():
    aid = _seed_activity(owner="t-1")
    record_checkpoint_state(GROUP, aid, "vektorer", "demonstrated", "ok")
    record_checkpoint_state("grp-other", aid, "vektorer", "partial", "x")

    res = _client(User(uid="t-1")).get(f"/api/activities/{aid}/concept-progress")
    assert res.status_code == 200
    groups = res.json()["groups"]
    assert groups[GROUP]["vektorer"]["status"] == "demonstrated"
    assert groups["grp-other"]["vektorer"]["status"] == "partial"


def test_non_owner_teacher_404s_enumeration_resistant():
    aid = _seed_activity(owner="t-1")
    assert _client(User(uid="t-2")).get(f"/api/activities/{aid}/concept-progress").status_code == 404
    assert _client(User(uid="t-2")).get("/api/activities/act-missing/concept-progress").status_code == 404


# --- CONCEPT-2 M4: the class rollup + activity links ------------------------


def _seed_class(class_id: str = "cls-1", owner: str = "t-1") -> str:
    create_class(
        Class(
            classId=class_id,
            ownerUid=owner,
            name="7B",
            tagNamespace=f"class:{owner}:{class_id}",
            groupCodes=["grp-a", "grp-b"],
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )
    )
    return class_id


def _seed_mapped_activity(activity_id: str, owner: str = "t-1", label: str = "Vektorer") -> str:
    a = create_activity(
        Activity(
            activityId=activity_id,
            skillId="concept",
            ownerUid=owner,
            title="A",
            conceptMap=[ConceptMapElement(id="cm", nodes=[ConceptNode(id="n1", label=label)])],
        )
    )
    return a.activity_id


def test_owner_reads_the_class_rollup_with_the_class_group_codes():
    """The codes travel with the rollup so the caller can tell a group that has
    not SHOWN a concept from one that never met it — two different facts the
    rollup deliberately does not flatten into one."""
    _seed_class()
    aid = _seed_mapped_activity("act-m4")
    record_checkpoint_state("grp-a", aid, "n1", "demonstrated", "ok", class_id="cls-1")

    body = _client(User(uid="t-1", is_teacher=True)).get("/api/classes/cls-1/concept-rollup").json()
    assert body["concepts"][0]["concept"] == "Vektorer"
    assert body["concepts"][0]["byGroup"] == {"grp-a": "demonstrated"}
    assert body["classGroups"] == ["grp-a", "grp-b"]


def test_a_non_owner_gets_404_for_the_class_rollup():
    _seed_class()
    assert _client(User(uid="t-other", is_teacher=True)).get("/api/classes/cls-1/concept-rollup").status_code == 404


def test_link_suggestions_are_scoped_to_the_callers_own_activities():
    """A suggestion naming another teacher's activity would reveal that it
    exists — so candidates come from the caller's own library only."""
    _seed_mapped_activity("act-mine-1")
    _seed_mapped_activity("act-mine-2")
    _seed_mapped_activity("act-theirs", owner="t-other")

    body = _client(User(uid="t-1", is_teacher=True)).get("/api/activities/act-mine-1/link-suggestions").json()
    assert [s["toActivityId"] for s in body["suggestions"]] == ["act-mine-2"]


def test_links_are_saved_on_their_own_endpoint_and_refuse_an_activity_you_do_not_own():
    _seed_mapped_activity("act-mine-1")
    _seed_mapped_activity("act-mine-2")
    _seed_mapped_activity("act-theirs", owner="t-other")
    c = _client(User(uid="t-1", is_teacher=True))

    ok = c.put(
        "/api/activities/act-mine-1/links",
        json={"links": [{"toActivityId": "act-mine-2", "viaConcepts": ["Vektorer"]}]},
    )
    assert ok.status_code == 200
    assert ok.json()["links"][0]["toActivityId"] == "act-mine-2"

    bad = c.put("/api/activities/act-mine-1/links", json={"links": [{"toActivityId": "act-theirs"}]})
    assert bad.status_code == 400


def test_a_suggestion_already_linked_is_not_offered_again():
    _seed_mapped_activity("act-mine-1")
    _seed_mapped_activity("act-mine-2")
    c = _client(User(uid="t-1", is_teacher=True))
    c.put(
        "/api/activities/act-mine-1/links",
        json={"links": [{"toActivityId": "act-mine-2", "viaConcepts": ["Vektorer"]}]},
    )
    assert c.get("/api/activities/act-mine-1/link-suggestions").json()["suggestions"] == []


# --- CONCEPT-2 M6: the teacher's override -----------------------------------


def _class_with_activity(activity_id: str = "act-m6") -> str:
    _seed_class()
    _seed_mapped_activity(activity_id)
    cls = get_class("cls-1")
    assert cls is not None
    cls.activity_ids = [activity_id]
    create_class(cls)
    return activity_id


def test_a_teacher_override_outranks_the_ai_and_survives_a_later_ai_mark():
    """The promise teacher_focus has been making since CONCEPT-1, made true."""
    aid = _class_with_activity()
    record_checkpoint_state("grp-a", aid, "n1", "demonstrated", "bestod", class_id="cls-1")
    c = _client(User(uid="t-1", is_teacher=True))

    res = c.put(
        "/api/classes/cls-1/concept-override",
        json={"concept": "Vektorer", "groupId": "grp-a", "status": "partial", "note": "set det selv i timen"},
    )
    assert res.status_code == 200 and res.json()["activities"] == 1
    assert get_node_states("grp-a", aid)["n1"]["status"] == "partial"

    # a later AI checkpoint cannot take it back
    record_checkpoint_state("grp-a", aid, "n1", "demonstrated", "igen", class_id="cls-1")
    assert get_node_states("grp-a", aid)["n1"]["status"] == "partial"


def test_an_override_reaches_every_activity_in_the_class_that_maps_the_concept():
    """The rollup takes a group's BEST showing across the activities teaching a
    concept, so an override written to one while another still says
    demonstrated reads as having done nothing — the teacher presses the control
    and watches the node not move."""
    _class_with_activity("act-one")
    _seed_mapped_activity("act-two")
    cls = get_class("cls-1")
    assert cls is not None
    cls.activity_ids = ["act-one", "act-two"]
    create_class(cls)
    record_checkpoint_state("grp-a", "act-one", "n1", "demonstrated", "x", class_id="cls-1")
    record_checkpoint_state("grp-a", "act-two", "n1", "demonstrated", "x", class_id="cls-1")

    c = _client(User(uid="t-1", is_teacher=True))
    res = c.put(
        "/api/classes/cls-1/concept-override",
        json={"concept": "vektorer", "groupId": "grp-a", "status": "not_yet"},
    )
    assert res.json()["activities"] == 2
    body = c.get("/api/classes/cls-1/concept-rollup").json()
    assert body["concepts"][0]["byGroup"]["grp-a"] == "not_yet"


def test_an_override_refuses_a_foreign_group_an_unmapped_concept_and_a_non_owner():
    _class_with_activity()
    c = _client(User(uid="t-1", is_teacher=True))
    assert (
        c.put(
            "/api/classes/cls-1/concept-override",
            json={"concept": "Vektorer", "groupId": "grp-elsewhere", "status": "partial"},
        ).status_code
        == 400
    )
    assert (
        c.put(
            "/api/classes/cls-1/concept-override",
            json={"concept": "Kvantemekanik", "groupId": "grp-a", "status": "partial"},
        ).status_code
        == 400
    )
    other = _client(User(uid="t-other", is_teacher=True))
    assert (
        other.put(
            "/api/classes/cls-1/concept-override",
            json={"concept": "Vektorer", "groupId": "grp-a", "status": "partial"},
        ).status_code
        == 404
    )


def test_the_rollup_flags_a_provenance_disagreement_for_the_teacher():
    """A passive mark and a deliberate checkpoint that disagree — surfaced,
    rather than left for a teacher to find among thirty nodes."""
    aid = _class_with_activity()
    record_checkpoint_state("grp-a", aid, "n1", "partial", "usikker", class_id="cls-1")
    record_concept_evidence("grp-a", aid, "n1", "demonstrated", "forklarede det", kind="observed", class_id="cls-1")

    body = _client(User(uid="t-1", is_teacher=True)).get("/api/classes/cls-1/concept-rollup").json()
    assert body["concepts"][0]["flags"] == [{"groupId": "grp-a", "kind": "provenance"}]
