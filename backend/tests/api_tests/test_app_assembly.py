"""T5b — ``fast_api_app.py`` app-assembly characterization test.

Pins the ROUTE TABLE produced by importing the real app factory, so a future
refactor that splits ``fast_api_app.py`` (planned) cannot silently DROP a route
or its auth guard.

What it pins
------------
1. The app assembles and registers a plausible number of routes (a tripwire for
   "a whole router stopped being included").
2. A CONTAINS-set of critical routes is present, each with its expected HTTP
   methods. This is deliberately a subset, not an exact 187-route snapshot —
   the ADK ``get_fast_api_app`` base contributes ~100 ``/apps/...`` + ``/dev/...``
   routes whose exact shape we don't want to freeze. We freeze the routes AIPLA
   owns: auth, classes, activities, activity-configs, sessions, the chat stream,
   voice, insights.
3. Each critical AUTHENTICATED route carries the ``auth.get_current_user``
   dependency (the auth guard). If a refactor re-registers a route without its
   ``Depends(get_current_user)`` it becomes unauthenticated — this catches it.
4. The anonymous endpoints (``/api/auth/group/join`` + ``/refresh``) do NOT carry
   the guard. That asymmetry is intentional (students join with a code, no token
   yet); pinning it both ways means a refactor can't accidentally lock students
   out OR accidentally open a teacher route.

Import note
-----------
Importing ``fast_api_app`` runs the module-level assembly (it builds ``app`` at
import time). The autouse conftest fixtures stub GCP credentials + Firestore;
this test additionally forces ``LOCAL_MODE=1`` and a signing secret BEFORE the
import so the assembly takes the in-memory path with no GCP round-trips. The
import is cached at session scope so the (relatively heavy) ADK app build runs
once.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.routing import APIRoute


@pytest.fixture(scope="module")
def assembled_app():
    """Import the real ``fast_api_app`` and return its ``app``.

    Forces LOCAL_MODE + a signing secret and clears the genai/Vertex env vars
    that Mark's shell may carry (they only trigger noisy STARTUP-ERROR logs, but
    we keep the import clean). Imports via ``importlib`` so the env is set first.

    Uses a module-scoped ``MonkeyPatch`` (restored on teardown) rather than a raw
    ``os.environ`` write: the raw write leaked LOCAL_MODE=1 into every later test
    in the session, which flipped the auth dispatcher to the LOCAL_MODE stub and
    broke the Firebase-auth tests (whoami / tenant-attribution) that ran after.
    The function-scoped ``monkeypatch`` fixture can't be used from a module-scoped
    fixture (ScopeMismatch), hence the explicit ``pytest.MonkeyPatch``.
    """
    mp = pytest.MonkeyPatch()
    mp.setenv("LOCAL_MODE", "1")
    mp.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    # Avoid the API-key-vs-Vertex STARTUP ERROR noise during the import.
    for var in ("GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENAI_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI"):
        mp.delenv(var, raising=False)

    module = importlib.import_module("fast_api_app")
    yield module.app
    mp.undo()


def _api_routes(app) -> list[APIRoute]:
    return [r for r in app.routes if isinstance(r, APIRoute)]


def _route_method_map(app) -> dict[str, set[str]]:
    """``path -> {methods}`` (HEAD/OPTIONS stripped), merged across duplicate
    registrations of the same path so a path that appears on two routers (e.g.
    ``/health`` is defined by both ADK and our app) still surfaces all methods."""
    out: dict[str, set[str]] = {}
    for r in _api_routes(app):
        methods = {m for m in r.methods if m not in ("HEAD", "OPTIONS")}
        out.setdefault(r.path, set()).update(methods)
    return out


def _route_has_auth_guard(app, path: str, method: str) -> bool:
    """True iff a route for (path, method) carries ``auth.get_current_user`` in
    its dependency tree."""
    from auth import get_current_user

    for r in _api_routes(app):
        if r.path != path or method not in r.methods:
            continue
        for dep in r.dependant.dependencies:
            if dep.call is get_current_user:
                return True
    return False


# Critical routes AIPLA owns: (path, expected-methods). This is the contains-set
# a refactor must preserve. Methods are exact per route; the set membership is
# "must be present" (other routes may exist).
CRITICAL_ROUTES: dict[str, set[str]] = {
    # Anonymous-group auth (ADR-001)
    "/api/auth/group/create": {"POST"},
    "/api/auth/group/join": {"POST"},
    "/api/auth/group/refresh": {"POST"},
    "/api/auth/group/{group_id}": {"GET", "DELETE"},
    # Teacher class management (1.A)
    "/api/classes": {"GET", "POST"},
    "/api/classes/{class_id}": {"GET", "PATCH", "DELETE"},
    # Activity library (ALS-1)
    "/api/activities": {"GET", "POST"},
    "/api/activities/{activity_id}": {"GET", "PATCH", "DELETE"},
    # Activity configs (teacher write + student read)
    "/api/activity-configs": {"GET", "POST"},
    "/api/activity-configs/active/{activity_id}": {"GET"},
    # Sessions
    "/api/sessions/{session_id}": {"GET", "PATCH", "DELETE"},
    "/api/sessions/{session_id}/messages": {"GET"},
    # Chat / streaming agent (AG-UI)
    "/api/skill/{skill_id}/stream": {"POST"},
    # Voice
    "/api/voice/config": {"GET"},
    "/api/voice/stt/transcribe": {"POST"},
    "/api/voice/tts/synthesize": {"POST"},
    # Insights (teacher analytics)
    "/api/insights/summary": {"GET"},
    "/api/insights/classes/{class_id}/kpis": {"GET"},
}

# The authenticated subset of CRITICAL_ROUTES: each (path, method) here MUST
# carry the get_current_user guard. (join/refresh are deliberately omitted —
# they're the anonymous endpoints, asserted separately below.)
AUTH_GUARDED: list[tuple[str, str]] = [
    ("/api/auth/group/create", "POST"),
    ("/api/auth/group/{group_id}", "DELETE"),
    ("/api/auth/group/{group_id}", "GET"),
    ("/api/classes", "POST"),
    ("/api/classes", "GET"),
    ("/api/classes/{class_id}", "PATCH"),
    ("/api/classes/{class_id}", "DELETE"),
    ("/api/activities", "POST"),
    ("/api/activities", "GET"),
    ("/api/activities/{activity_id}", "PATCH"),
    ("/api/activities/{activity_id}", "DELETE"),
    ("/api/activity-configs", "POST"),
    ("/api/activity-configs/active/{activity_id}", "GET"),
    ("/api/sessions/{session_id}", "DELETE"),
    ("/api/skill/{skill_id}/stream", "POST"),
    ("/api/voice/tts/synthesize", "POST"),
    ("/api/insights/summary", "GET"),
]

# Endpoints that must stay ANONYMOUS (no get_current_user). A student presents a
# code, not a token, to these — guarding them would lock the whole join flow out.
ANONYMOUS_ROUTES: list[tuple[str, str]] = [
    ("/api/auth/group/join", "POST"),
    ("/api/auth/group/refresh", "POST"),
    # The frontend's environment banner reads this from the /group join page,
    # where nobody is signed in. Guarding it would blank the banner on exactly
    # the surface the dev-code-typed-into-test incident happened on.
    ("/api/environment", "GET"),
]


def test_app_assembles(assembled_app):
    """Sanity tripwire: the app builds and registers a plausible route count.

    The current count is ~187 APIRoutes (ADK base + AIPLA routers). We assert a
    floor well below that so dropping an entire router (each contributes several
    routes) trips this, without freezing the exact number (ADK upgrades shift it).
    """
    routes = _api_routes(assembled_app)
    assert len(routes) > 120, f"only {len(routes)} APIRoutes — a router may have been dropped"


def test_critical_routes_present_with_expected_methods(assembled_app):
    """Each critical AIPLA route is registered with (at least) its expected
    methods. Contains-set, not exact-equality, so unrelated routes don't break it."""
    method_map = _route_method_map(assembled_app)
    missing: list[str] = []
    wrong_methods: list[str] = []
    for path, expected in CRITICAL_ROUTES.items():
        if path not in method_map:
            missing.append(path)
            continue
        actual = method_map[path]
        if not expected.issubset(actual):
            wrong_methods.append(f"{path}: expected {sorted(expected)} got {sorted(actual)}")
    assert not missing, f"critical routes missing from the app: {missing}"
    assert not wrong_methods, f"critical routes with wrong methods: {wrong_methods}"


def test_authenticated_routes_keep_their_auth_guard(assembled_app):
    """Every critical authenticated route carries ``Depends(get_current_user)``.

    Pins the auth guard against a refactor that re-registers a route without it
    (silently making a teacher/student endpoint public)."""
    unguarded = [
        f"{method} {path}" for path, method in AUTH_GUARDED if not _route_has_auth_guard(assembled_app, path, method)
    ]
    assert not unguarded, f"these critical routes LOST their auth guard: {unguarded}"


def test_anonymous_routes_stay_unguarded(assembled_app):
    """The anonymous join/refresh endpoints must NOT carry the auth guard.

    A code-bearing student has no token yet — guarding these would 401 the whole
    join flow. Pins the asymmetry so a refactor can't accidentally add a guard."""
    wrongly_guarded = [
        f"{method} {path}" for path, method in ANONYMOUS_ROUTES if _route_has_auth_guard(assembled_app, path, method)
    ]
    assert not wrongly_guarded, f"anonymous endpoints unexpectedly gained an auth guard: {wrongly_guarded}"


def test_environment_endpoint_is_public_and_answers(assembled_app):
    """``/api/environment`` backs the UI's environment banner.

    Public (the join page has no signed-in user) and it must actually return a
    known env name — a banner that can't name the environment is the state that
    let dev codes be typed into test for two hours on 2026-08-04.
    """
    from fastapi.testclient import TestClient

    from config.environment import KNOWN_ENVIRONMENTS

    method_map = _route_method_map(assembled_app)
    assert "/api/environment" in method_map
    assert "GET" in method_map["/api/environment"]

    body = TestClient(assembled_app).get("/api/environment").json()
    assert body["env"] in KNOWN_ENVIRONMENTS
    assert set(body) == {"env", "projectId", "version"}


def test_health_endpoint_is_public(assembled_app):
    """``/health`` is the smoke-check probe — must exist and be unauthenticated."""
    method_map = _route_method_map(assembled_app)
    assert "/health" in method_map
    assert "GET" in method_map["/health"]
    assert not _route_has_auth_guard(assembled_app, "/health", "GET")
