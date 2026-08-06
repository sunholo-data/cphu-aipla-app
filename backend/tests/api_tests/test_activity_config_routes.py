"""API tests for /api/activity-configs endpoints.

Uses ``InMemoryFirestoreClient`` (via LOCAL_MODE) so writes round-trip
without a real GCP project. Auth is overridden to a fixed teacher uid
so we can exercise the ownership-mismatch 403 branch directly.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from protocols.activity_config_routes import router

TEACHER_UID = "teacher-1"
OTHER_TEACHER_UID = "teacher-other"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    """Force the in-memory Firestore client for every test."""
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


@pytest.fixture()
def app():
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=TEACHER_UID, email="teacher@example.test")
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _sample_body(**overrides) -> dict:
    body = {
        "activityId": "boldkast",
        "classId": "7b-physics-a-2026",
        "teachingGoal": "Independence of vx and vy; 45° gives the longest range.",
        "language": "da",
        "difficulty": "standard",
        "pairedWorkbench": "boldkast-simulator-v1",
    }
    body.update(overrides)
    return body


# --- POST ---


def test_post_creates_config(client):
    resp = client.post("/api/activity-configs", json=_sample_body())
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["activityId"] == "boldkast"
    assert data["classId"] == "7b-physics-a-2026"
    assert data["teacherUid"] == TEACHER_UID
    assert data["teachingGoal"].startswith("Independence")
    assert "updatedAt" in data


def test_post_is_idempotent_overwrites_existing(client):
    client.post("/api/activity-configs", json=_sample_body())
    resp = client.post(
        "/api/activity-configs",
        json=_sample_body(teachingGoal="A second teaching goal."),
    )
    assert resp.status_code == 201
    assert resp.json()["teachingGoal"] == "A second teaching goal."


def test_post_rejects_unknown_fields(client):
    body = _sample_body()
    body["evilExtra"] = "nope"
    resp = client.post("/api/activity-configs", json=body)
    assert resp.status_code == 422


# --- Day-0 overwrite guard (ALS-1 M0.5-guard) ---
#
# The create page sends ``createOnly: true`` so a SECOND create of the same
# (teacher, class, activity) is rejected loudly (409) instead of silently
# overwriting the first activity. The edit page sends no flag, so the
# idempotent upsert above is unaffected. Retired once M0 mints distinct ids.


def test_post_create_only_allows_first_create(client):
    resp = client.post("/api/activity-configs", json=_sample_body(createOnly=True))
    assert resp.status_code == 201, resp.text
    assert resp.json()["activityId"] == "boldkast"


def test_post_create_only_rejects_overwrite(client):
    client.post("/api/activity-configs", json=_sample_body(createOnly=True))
    resp = client.post(
        "/api/activity-configs",
        json=_sample_body(createOnly=True, teachingGoal="Would clobber the first."),
    )
    assert resp.status_code == 409, resp.text
    # The first config must be intact — the overwrite was refused, not applied.
    saved = client.get(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert saved.json()["teachingGoal"].startswith("Independence")


def test_post_without_create_only_still_overwrites(client):
    # The edit path (no flag) keeps the idempotent upsert semantics.
    client.post("/api/activity-configs", json=_sample_body(createOnly=True))
    resp = client.post(
        "/api/activity-configs",
        json=_sample_body(teachingGoal="An intentional edit."),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["teachingGoal"] == "An intentional edit."


# --- GET ---


def test_get_returns_404_when_missing(client):
    resp = client.get(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 404


def test_get_returns_the_saved_config(client):
    client.post("/api/activity-configs", json=_sample_body())
    resp = client.get(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 200
    assert resp.json()["teacherUid"] == TEACHER_UID


def test_material_student_visible_round_trips(client):
    # 1.1.33 M2a: the teacher decides, per material, whether it's student-facing.
    # studentVisible must survive POST + GET; default false when omitted.
    body = _sample_body(
        materials=[
            {"docId": "doc-visible", "origin": "A-level kinematics", "studentVisible": True},
            {"docId": "doc-hidden", "origin": "teacher upload"},  # default
        ]
    )
    client.post("/api/activity-configs", json=body)
    resp = client.get(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 200
    mats = {m["docId"]: m for m in resp.json()["materials"]}
    assert mats["doc-visible"]["studentVisible"] is True
    assert mats["doc-hidden"]["studentVisible"] is False


def test_patch_updates_material_student_visible(client):
    # Flipping visibility via PATCH round-trips too.
    client.post(
        "/api/activity-configs",
        json=_sample_body(materials=[{"docId": "d1", "origin": "o", "studentVisible": False}]),
    )
    resp = client.patch(
        f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast",
        json=_sample_body(materials=[{"docId": "d1", "origin": "o", "studentVisible": True}]),
    )
    assert resp.status_code == 200
    assert resp.json()["materials"][0]["studentVisible"] is True


def test_get_blocks_cross_teacher_access(client):
    client.post("/api/activity-configs", json=_sample_body())
    resp = client.get(f"/api/activity-configs/{OTHER_TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 403


# --- PATCH ---


def test_patch_updates_existing(client):
    client.post("/api/activity-configs", json=_sample_body())
    body = _sample_body(teachingGoal="Revised goal copy.")
    resp = client.patch(
        f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast",
        json=body,
    )
    assert resp.status_code == 200
    assert resp.json()["teachingGoal"] == "Revised goal copy."


def test_patch_rejects_url_body_mismatch(client):
    body = _sample_body(classId="some-other-class")
    resp = client.patch(
        f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast",
        json=body,
    )
    assert resp.status_code == 400


# --- DELETE ---


def test_delete_is_idempotent(client):
    # Delete-without-create still returns 204.
    resp = client.delete(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 204

    client.post("/api/activity-configs", json=_sample_body())
    resp = client.delete(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 204

    # After delete, GET 404s.
    resp = client.get(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 404


def test_delete_blocks_cross_teacher(client):
    client.post("/api/activity-configs", json=_sample_body())
    resp = client.delete(f"/api/activity-configs/{OTHER_TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 403


# --- TAA-1 M0.2: teacher-authored activity creation (mint + new fields) ---


def _create_body(**overrides) -> dict:
    """A teacher-authored no-workbench activity body (no activityId -> mint)."""
    body = {
        "classId": "7b-physics-a-2026",
        "title": "Energibevarelse 7B",
        "teachingGoal": "Guide students to discover energy conservation.",
        "language": "da",
        "difficulty": "standard",
        "workbenchType": "none",
    }
    body.update(overrides)
    return body


def test_post_without_activity_id_mints_teacher_namespaced_id(client):
    resp = client.post("/api/activity-configs", json=_create_body())
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["activityId"].startswith("teacher:")
    assert data["teacherUid"] == TEACHER_UID
    assert data["title"] == "Energibevarelse 7B"
    assert data["workbenchType"] == "none"

    # The minted activity is fetchable at its new id.
    got = client.get(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/{data['activityId']}")
    assert got.status_code == 200
    assert got.json()["title"] == "Energibevarelse 7B"


def test_post_mint_is_unique_per_call(client):
    a = client.post("/api/activity-configs", json=_create_body()).json()["activityId"]
    b = client.post("/api/activity-configs", json=_create_body()).json()["activityId"]
    assert a != b


def test_post_accepts_workbench_type(client):
    resp = client.post("/api/activity-configs", json=_create_body(workbenchType="notebook"))
    assert resp.status_code == 201
    assert resp.json()["workbenchType"] == "notebook"


def test_post_rejects_invalid_workbench_type(client):
    resp = client.post("/api/activity-configs", json=_create_body(workbenchType="banana"))
    assert resp.status_code == 422


def test_post_with_explicit_activity_id_still_works(client):
    """Back-compat: existing callers that pass activityId are unchanged."""
    resp = client.post("/api/activity-configs", json=_create_body(activityId="my-fixed-id"))
    assert resp.status_code == 201
    assert resp.json()["activityId"] == "my-fixed-id"


def test_minted_activity_is_owned_by_creating_teacher_only(client):
    minted = client.post("/api/activity-configs", json=_create_body()).json()["activityId"]
    resp = client.get(f"/api/activity-configs/{OTHER_TEACHER_UID}/7b-physics-a-2026/{minted}")
    assert resp.status_code == 403


# --- TAA-1 M0.3: list endpoint (backs `aiplatform activity list`) ---


def test_list_returns_my_activities(client):
    client.post("/api/activity-configs", json=_create_body(title="A"))
    client.post("/api/activity-configs", json=_create_body(title="B"))
    resp = client.get("/api/activity-configs")
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert isinstance(items, list)
    assert sorted(i["title"] for i in items) == ["A", "B"]
    assert all(i["teacherUid"] == TEACHER_UID for i in items)


def test_list_filters_by_class(client):
    client.post("/api/activity-configs", json=_create_body(classId="class-a", title="A"))
    client.post("/api/activity-configs", json=_create_body(classId="class-b", title="B"))
    resp = client.get("/api/activity-configs", params={"classId": "class-a"})
    assert resp.status_code == 200
    assert [i["title"] for i in resp.json()] == ["A"]


def test_list_is_empty_for_teacher_with_no_activities(client):
    resp = client.get("/api/activity-configs")
    assert resp.status_code == 200
    assert resp.json() == []


# --- M1: teacher-authored checklist round-trips through the route ---


def test_post_persists_checklist(client):
    body = _create_body(
        checklist=[
            {"id": "step-1", "label": "Identify the system"},
            {"id": "step-2", "label": "List the energy transformations"},
        ],
    )
    resp = client.post("/api/activity-configs", json=body)
    assert resp.status_code == 201, resp.text
    activity_id = resp.json()["activityId"]
    got = client.get(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/{activity_id}")
    assert [c["label"] for c in got.json()["checklist"]] == [
        "Identify the system",
        "List the energy transformations",
    ]


def test_post_rejects_checklist_item_missing_label(client):
    resp = client.post("/api/activity-configs", json=_create_body(checklist=[{"id": "x"}]))
    assert resp.status_code == 422


# --- M1.2: student-facing resolved checklist via group->class binding ---


def _group_client(group_tags: set[str]):
    """A TestClient authed as a student whose group JWT carries group_tags."""
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid="student-anon", group_id="grp-1", group_tags=frozenset(group_tags))
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def test_active_resolves_checklist_for_bound_student(client):
    # Teacher t-99 saves a checklist for class cls-9 / activity act-1.
    upsert_body = {
        "activityId": "act-1",
        "classId": "cls-9",
        "teachingGoal": "g",
        "checklist": [{"id": "s1", "label": "Step one"}],
    }
    # Save it directly as that teacher via the repo path the route uses.
    from db.activity_configs import upsert_activity_config

    upsert_activity_config(
        teacher_uid="t-99",
        class_id="cls-9",
        activity_id="act-1",
        teaching_goal="g",
        checklist=[{"id": "s1", "label": "Step one"}],  # type: ignore[list-item]
    )
    _ = upsert_body

    student = _group_client({"class:t-99:cls-9"})
    resp = student.get("/api/activity-configs/active/act-1")
    assert resp.status_code == 200, resp.text
    assert [c["label"] for c in resp.json()["checklist"]] == ["Step one"]


def test_active_returns_empty_when_no_config(client):
    student = _group_client({"class:t-1:cls-x"})
    resp = student.get("/api/activity-configs/active/missing-activity")
    assert resp.status_code == 200
    assert resp.json()["checklist"] == []


def test_active_surfaces_all_material_names_with_visibility(client):
    # 1.1.33 M2b: the student-facing active config surfaces ALL of the activity's
    # material NAMES (so "what is this grounded in?" is debuggable) plus a
    # studentVisible flag — names-always; content-open is gated by the flag, not
    # the name. A bound student sees both a shared and a hidden material's name.
    from db.activity_configs import upsert_activity_config
    from db.models.activity_config import MaterialRef

    upsert_activity_config(
        teacher_uid="t-77",
        class_id="cls-7",
        activity_id="act-mats",
        teaching_goal="g",
        materials=[
            MaterialRef(doc_id="d-shared", origin="A-level kinematics", student_visible=True),
            MaterialRef(doc_id="d-hidden", origin="Teacher worksheet"),  # default false
        ],
    )
    student = _group_client({"class:t-77:cls-7"})
    resp = student.get("/api/activity-configs/active/act-mats")
    assert resp.status_code == 200, resp.text
    mats = {m["docId"]: m for m in resp.json()["materials"]}
    # Both names present (debug/transparency) ...
    assert mats["d-shared"]["origin"] == "A-level kinematics"
    assert mats["d-hidden"]["origin"] == "Teacher worksheet"
    # ... each with the visibility flag so the UI can gate content-open.
    assert mats["d-shared"]["studentVisible"] is True
    assert mats["d-hidden"]["studentVisible"] is False


# --- sim artefact reference (1.1.41 M1) ---


def test_post_with_known_artefact_succeeds(client):
    resp = client.post(
        "/api/activity-configs",
        json=_sample_body(activityId="act-sim", artefactId="boldkast", pairedWorkbench=None),
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["artefactId"] == "boldkast"
    assert data["workbenchType"] == "app"  # backfilled from the artefact reference


def test_post_with_unknown_artefact_is_400(client):
    resp = client.post(
        "/api/activity-configs",
        json=_sample_body(activityId="act-bad", artefactId="does-not-exist"),
    )
    assert resp.status_code == 400
    assert "unknown artefact" in resp.text


# --- GET /resolved-focus (1.1.62 M1) ---------------------------------------
#
# The debugging affordance the element-blindness bug argues for: nothing
# rendered the composed prompt, so nobody could see the tutor was never told
# the elements existed.


def test_resolved_focus_shows_the_element_manifest(client):
    client.post(
        "/api/activity-configs",
        json=_sample_body(
            table=[
                {
                    "id": "t1",
                    "title": "Faldforsøg",
                    "columns": [
                        {"id": "h", "label": "højde", "unit": "m", "kind": "number"},
                        {"id": "t", "label": "tid", "unit": "s", "kind": "number"},
                    ],
                    "rows": 5,
                }
            ],
            checklist=[{"id": "a", "label": "Mål faldtiden"}],
        ),
    )
    resp = client.get("/api/activity-configs/resolved-focus/7b-physics-a-2026/boldkast")
    assert resp.status_code == 200
    body = resp.json()

    assert body["elementCounts"] == {"checklist": 1, "table": 1}
    assert "Faldforsøg" in body["manifest"]
    assert "Mål faldtiden" in body["manifest"]
    # The manifest is part of what the tutor actually receives, not a preview
    # computed down a separate path.
    assert body["manifest"] in body["resolvedFocus"]
    assert body["focusChars"] == len(body["resolvedFocus"])


def test_resolved_focus_reports_no_elements_honestly(client):
    client.post("/api/activity-configs", json=_sample_body())
    body = client.get("/api/activity-configs/resolved-focus/7b-physics-a-2026/boldkast").json()
    assert body["elementCounts"] == {}
    assert body["manifest"] == ""


def test_resolved_focus_is_owner_scoped(client):
    """A teacher resolves only their OWN activity — the focus can carry the
    teaching goal and solution task, which are not another teacher's to read."""
    resp = client.get("/api/activity-configs/resolved-focus/7b-physics-a-2026/never-created")
    assert resp.status_code == 404


def test_resolved_focus_surfaces_the_language_directive(client):
    client.post("/api/activity-configs", json=_sample_body(language="en"))
    body = client.get("/api/activity-configs/resolved-focus/7b-physics-a-2026/boldkast").json()
    assert body["language"] == "en"
    assert "English" in body["resolvedFocus"]
