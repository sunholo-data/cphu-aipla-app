"""T3 — real-group-JWT rejection integration test.

Characterization test. Pins the CURRENT behaviour of the dual-auth dispatch
(``auth.get_current_user``) when a REAL anonymous-group student token (NOT a
hand-built ``is_teacher=False`` mock) hits teacher-only and student-legitimate
endpoints.

Why this exists
---------------
``tests/api_tests/test_classes_route.py`` and ``test_activity_routes.py`` prove
the role gate by OVERRIDING ``get_current_user`` with a fake
``User(is_teacher=False)``. That bypasses the real token-shape dispatcher in
``auth.__init__._resolve_user`` entirely — it never verifies a signature, never
builds the ``User`` from real JWT claims, never sets ``request.state.access``
the way production does. The shared-ownership-guard refactor will touch that
dispatch, so we pin the end-to-end path here:

  1. Mint a REAL group JWT the way production does — ``create_group`` then
     ``join_group`` (the same helpers ``POST /api/auth/group/join`` calls).
  2. Send it through the REAL ``get_current_user`` dependency (NOT overridden)
     to ``POST /api/classes`` and ``POST /api/activities`` → assert REJECTED.
  3. Send the SAME token to a student-legitimate endpoint
     (``GET /api/activity-configs/active/{id}``) → assert ACCEPTED. This proves
     the token is valid and the rejection above is role-based, not
     token-invalid.

LOCAL_MODE=1 is required: it makes ``_resolve_user`` accept the anonymous-group
JWT branch (and uses the in-memory Firestore so group state round-trips without
GCP). The signing secret env var is required by ``group_id_auth._signing_secret``
at mint/verify time.

OBSERVED current behaviour (the thing this test pins):
  * ``POST /api/classes``    with a real student token → ``403``
    (``_assert_teacher`` in ``protocols.classes_routes``).
  * ``POST /api/activities`` with a real student token → ``403``
    (``_assert_teacher`` in ``protocols.activity_routes``).
  * ``GET /api/activity-configs/active/{id}`` with the SAME token → ``200``
    (the student surface; unbound group falls back to an empty config).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group
from db import firestore as fs_module
from protocols.activity_config_routes import router as activity_config_router
from protocols.activity_routes import router as activity_router
from protocols.checklist_progress_routes import router as checklist_progress_router
from protocols.classes_routes import router as classes_router
from protocols.concept_progress_routes import router as concept_progress_router
from protocols.writing_progress_routes import router as writing_progress_router

TEACHER_UID = "teacher-creator"
ACTIVITY = "act-boelger"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    """LOCAL_MODE so the real dispatcher accepts a group JWT; in-memory
    Firestore so group state round-trips; signing secret so mint/verify work.
    Reset both the Firestore client and the in-memory group state per test."""
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


@pytest.fixture()
def app() -> FastAPI:
    """An app wired with the REAL ``get_current_user`` dependency.

    Deliberately does NOT register a ``dependency_overrides`` for
    ``get_current_user`` — the whole point of this test is to drive the real
    token-shape dispatcher with a real token.
    """
    app = FastAPI()
    app.include_router(classes_router)
    app.include_router(activity_router)
    app.include_router(activity_config_router)
    app.include_router(writing_progress_router)
    app.include_router(checklist_progress_router)
    app.include_router(concept_progress_router)
    return app


@pytest.fixture()
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


def _mint_real_group_token() -> str:
    """Mint a REAL anonymous-group JWT the way production does.

    ``create_group`` registers the code (teacher action); ``join_group`` is the
    exact call ``POST /api/auth/group/join`` makes, returning a signed HS256 token
    with the production claim shape (``sub``/``group_id``/``exp``/``iat``/
    ``auth_mode``). We use the returned token verbatim — no hand-built claims.
    """
    record = create_group(
        title="T3 class",
        skill_ids=["concept-dialogue"],
        creator_uid=TEACHER_UID,
    )
    result = join_group(record.group_id, client_ip="203.0.113.7")
    return result.token


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Teacher-only endpoints reject a real student token (role-based, 403)
# ---------------------------------------------------------------------------


def test_post_classes_rejects_real_group_token(client):
    """A real student token is REJECTED at ``POST /api/classes``.

    Pins the current status code (403 — ``_assert_teacher``). Going through the
    real dispatch means the token IS verified and a real student ``User`` is
    built; the rejection is the role gate, not a bad token.
    """
    token = _mint_real_group_token()
    resp = client.post(
        "/api/classes",
        json={"name": "Hijack attempt"},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 403, resp.text


def test_post_activities_rejects_real_group_token(client):
    """A real student token is REJECTED at ``POST /api/activities`` (403)."""
    token = _mint_real_group_token()
    resp = client.post(
        "/api/activities",
        json={"skillId": "concept", "title": "Hijack attempt"},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# The SAME token is ACCEPTED on a student-legitimate endpoint
# ---------------------------------------------------------------------------


def test_student_endpoint_accepts_the_same_real_group_token(client):
    """The SAME token the teacher endpoints rejected is ACCEPTED here.

    This is the load-bearing half: it proves the rejection above is ROLE-based,
    not because the token is invalid. ``GET /api/activity-configs/active/{id}``
    is a student surface — it resolves the caller's active config from their
    group binding. An unbound demo group has no class binding, so the route
    returns 200 with an empty config (the graceful-degradation branch), which is
    exactly the "valid student, nothing assigned yet" state.
    """
    token = _mint_real_group_token()
    resp = client.get(
        "/api/activity-configs/active/act-some-activity",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Unbound group → empty config shape (not a 4xx).
    assert body["activityId"] == "act-some-activity"
    assert body["checklist"] == []


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", f"/api/activities/{ACTIVITY}/writing"),
        ("GET", f"/api/activities/{ACTIVITY}/checklist-progress"),
        ("GET", f"/api/activities/{ACTIVITY}/concept-progress"),
    ],
)
def test_student_progress_reads_accept_a_real_group_token(client, method, path):
    """The per-group progress reads accept a REAL student token.

    All three depended on ``auth.firebase_auth.get_current_user`` (Firebase
    ONLY) instead of the ``auth.get_current_user`` dispatcher, so every group
    JWT died at ``verify_id_token`` — a 401 no student could recover from. Their
    own unit tests overrode the Firebase symbol, so they stayed green while prod
    401'd; only a real token through the real dispatcher witnesses this.
    """
    resp = client.request(method, path, headers=_auth_headers(_mint_real_group_token()))
    assert resp.status_code == 200, resp.text


def test_student_writing_save_accepts_a_real_group_token(client):
    """The WRITE half too — this is the one that surfaced as lost student work.

    A 401 here means the autosave never lands, leaving the text in a tab-scoped
    sessionStorage buffer that dies with the tab.
    """
    token = _mint_real_group_token()
    save = client.put(
        f"/api/activities/{ACTIVITY}/writing",
        json={"elementId": "writing-1", "text": "Forsk skal komme før Forklar."},
        headers=_auth_headers(token),
    )
    assert save.status_code == 200, save.text

    read = client.get(f"/api/activities/{ACTIVITY}/writing", headers=_auth_headers(token))
    assert read.status_code == 200, read.text
    assert read.json()["docs"]["writing-1"]["text"] == "Forsk skal komme før Forklar."


def test_rejection_is_role_based_not_token_invalid(client):
    """Belt-and-braces: one token, three calls — same dispatch, different roles.

    Asserts the full asymmetry in one place: the teacher-only writes 403 while
    the student read 200s, all with a single real token. If a refactor made the
    dispatcher reject the token outright (401) instead of the role gate (403),
    this catches it.
    """
    token = _mint_real_group_token()
    headers = _auth_headers(token)

    create_class = client.post("/api/classes", json={"name": "x"}, headers=headers)
    create_activity = client.post("/api/activities", json={"skillId": "concept", "title": "x"}, headers=headers)
    student_read = client.get("/api/activity-configs/active/act-x", headers=headers)

    assert create_class.status_code == 403, create_class.text
    assert create_activity.status_code == 403, create_activity.text
    assert student_read.status_code == 200, student_read.text
