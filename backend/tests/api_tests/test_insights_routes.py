"""API tests for /api/insights/* endpoints (sprint
ANALYTICS-CHAT-AND-INSIGHTS, M7).

Mocks ``analytics.queries`` so tests run without BigQuery.

Five routes under test. The shared properties:

1. Teacher-gated. Student / no-teacher returns 403.
2. Per-class routes go through ``assert_caller_owns`` — cross-tenant
   returns 404 ``class not accessible`` with the same body as a missing
   class. Tests assert byte-identical content (HARD GATE).
3. Every successful response carries ``_debug.queries`` with non-empty
   SQL bodies and bound params.
4. Cache: a second call within the TTL window returns from cache.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.classes import create_class, mint_group_codes_under_class
from db.models.class_ import Class
from insights.cache import CACHE
from protocols.insights_routes import router

TEACHER_UID = "teacher-alice"
OTHER_TEACHER_UID = "teacher-bob"
MISSING_CLASS_ID = "this-class-does-not-exist"


@pytest.fixture(autouse=True)
def _local_state(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    CACHE.clear()
    yield
    fs_module._reset_client_for_testing()
    CACHE.clear()


@pytest.fixture(autouse=True)
def _mock_queries(monkeypatch):
    """Default mocks for the three queries the insights routes touch.
    Tests can override per-test."""
    monkeypatch.setattr(
        "analytics.queries.count_messages",
        lambda **_: {"total": 5, "per_group": [{"group_code": "g1", "count": 5}]},
    )
    monkeypatch.setattr(
        "analytics.queries.time_on_task",
        lambda **_: {
            "per_group": [
                {
                    "group_code": "g1",
                    "skill_id": "a",
                    "first_ts": "2026-06-01T00:00:00+00:00",
                    "last_ts": "2026-06-02T00:00:00+00:00",
                    "duration_min": 12,
                }
            ]
        },
    )
    monkeypatch.setattr(
        "analytics.queries.sim_runs_per_skill",
        lambda **_: {"per_skill": [{"skill_id": "a", "run_count": 3, "unique_groups": 1}], "total": 3},
    )
    monkeypatch.setattr(
        "analytics.queries.most_active_groups",
        lambda **kw: {"groups": [{"group_code": "g1", "message_count": 5, "session_count": 2}]},
    )
    monkeypatch.setattr(
        "analytics.queries.messages_per_day",
        lambda **_: {"per_day": [{"day": "2026-06-02", "count": 3}]},
    )


def _make_app(*, uid: str = TEACHER_UID, is_teacher: bool = True, is_researcher: bool = False) -> FastAPI:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", is_teacher=is_teacher, is_researcher=is_researcher)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return app


def _make_class(owner_uid: str, *, name: str = "9A") -> str:
    cls = Class.create_for_teacher(owner_uid=owner_uid, name=name)
    create_class(cls)
    mint_group_codes_under_class(cls.class_id, count=2)
    return cls.class_id


@pytest.fixture()
def teacher_client():
    return TestClient(_make_app())


@pytest.fixture()
def other_teacher_client():
    return TestClient(_make_app(uid=OTHER_TEACHER_UID))


@pytest.fixture()
def student_client():
    return TestClient(_make_app(uid="anon-X", is_teacher=False))


@pytest.fixture()
def researcher_client():
    return TestClient(_make_app(uid="researcher-rae", is_researcher=True))


# ---------------------------------------------------------------------------
# GET /api/insights/cost — researcher cross-class spend (sprint 1.1.9)
# ---------------------------------------------------------------------------


class TestCostOverview:
    def test_cost_requires_researcher(self, teacher_client):
        """A plain teacher (no researcher claim) is rejected — even via URL."""
        resp = teacher_client.get("/api/insights/cost")
        assert resp.status_code == 403

    def test_cost_rejects_student(self, student_client):
        resp = student_client.get("/api/insights/cost")
        assert resp.status_code == 403

    def test_cost_researcher_ok(self, researcher_client, monkeypatch):
        import analytics.cost_queries as cq

        monkeypatch.setattr(cq, "spend_rows", lambda *a, **k: [])
        resp = researcher_client.get("/api/insights/cost", params={"period": "this_month"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["currency"] == "EUR"
        assert body["total_eur"] == 0.0
        assert "by_cohort" in body and "by_model" in body and "per_class" in body

    def test_cost_invalid_period_400(self, researcher_client):
        resp = researcher_client.get("/api/insights/cost", params={"period": "nope"})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/insights/summary
# ---------------------------------------------------------------------------


class TestSummary:
    def test_owned_classes_only(self, teacher_client):
        a = _make_class(TEACHER_UID, name="Alice 1")
        b = _make_class(TEACHER_UID, name="Alice 2")
        _make_class(OTHER_TEACHER_UID, name="Bob's — excluded")

        resp = teacher_client.get("/api/insights/summary")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        ids = {c["class_id"] for c in body["classes"]}
        assert ids == {a, b}
        assert body["_debug"]["per_class"]

    def test_student_forbidden(self, student_client):
        resp = student_client.get("/api/insights/summary")
        assert resp.status_code == 403

    def test_invalid_since_preset_rejected(self, teacher_client):
        resp = teacher_client.get("/api/insights/summary?since=banana")
        assert resp.status_code == 400

    def test_scope_all_forbidden_for_non_researcher(self, teacher_client):
        """A plain teacher cannot URL-hack scope=all into a cross-class view."""
        resp = teacher_client.get("/api/insights/summary?scope=all")
        assert resp.status_code == 403

    def test_invalid_scope_rejected(self, researcher_client):
        resp = researcher_client.get("/api/insights/summary?scope=banana")
        assert resp.status_code == 400

    def test_researcher_scope_all_spans_all_teachers(self, researcher_client):
        a = _make_class(TEACHER_UID, name="Alice 1")
        b = _make_class(OTHER_TEACHER_UID, name="Bob 1")

        resp = researcher_client.get("/api/insights/summary?scope=all")
        assert resp.status_code == 200, resp.text
        ids = {c["class_id"] for c in resp.json()["classes"]}
        assert {a, b} <= ids

    def test_researcher_scope_own_is_still_owner_scoped(self, researcher_client):
        """Default scope=own stays the researcher's own classes (which is none
        here) even though the claim is present — no accidental cross-class."""
        _make_class(OTHER_TEACHER_UID, name="Bob 1")
        resp = researcher_client.get("/api/insights/summary")
        assert resp.status_code == 200, resp.text
        assert resp.json()["classes"] == []


# ---------------------------------------------------------------------------
# GET /api/insights/classes/{id}/kpis
# ---------------------------------------------------------------------------


class TestClassKpis:
    def test_owned_class_returns_kpi_grid_and_debug(self, teacher_client):
        class_id = _make_class(TEACHER_UID)
        resp = teacher_client.get(f"/api/insights/classes/{class_id}/kpis")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["kpis"]["active_groups"] == 1
        assert body["kpis"]["total_messages"] == 5
        # _debug.queries carries SQL + params for transparency.
        queries = body["_debug"]["queries"]
        assert len(queries) == 4
        assert all(q["sql"] for q in queries)
        assert all("since" in q["params"] for q in queries)

    def test_missing_class_returns_class_not_accessible(self, teacher_client):
        resp = teacher_client.get(f"/api/insights/classes/{MISSING_CLASS_ID}/kpis")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "class not accessible"

    def test_cross_tenant_byte_identical_to_missing(self, teacher_client):
        bobs_class = _make_class(OTHER_TEACHER_UID, name="Bob's class")
        cross = teacher_client.get(f"/api/insights/classes/{bobs_class}/kpis")
        missing = teacher_client.get(f"/api/insights/classes/{MISSING_CLASS_ID}/kpis")
        assert cross.status_code == missing.status_code == 404
        assert cross.json() == missing.json()
        assert cross.content == missing.content  # HARD GATE: byte equality

    def test_researcher_reads_non_owned_class(self, researcher_client):
        """A researcher gets the KPI grid for a class they don't own (1.1.51) —
        no 404 cliff."""
        bobs_class = _make_class(OTHER_TEACHER_UID, name="Bob's class")
        resp = researcher_client.get(f"/api/insights/classes/{bobs_class}/kpis")
        assert resp.status_code == 200, resp.text
        assert resp.json()["kpis"]["total_messages"] == 5

    def test_researcher_missing_class_still_404(self, researcher_client):
        """The bypass is read-all-real, not read-into-nothing — a missing class
        is still the byte-identical 404 for a researcher too."""
        resp = researcher_client.get(f"/api/insights/classes/{MISSING_CLASS_ID}/kpis")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "class not accessible"

    def test_cache_hit_avoids_second_compute(self, teacher_client, monkeypatch):
        class_id = _make_class(TEACHER_UID)
        # Wrap the aggregate function to count calls.
        from insights import aggregates

        call_counter: dict[str, int] = {"n": 0}
        original = aggregates.class_kpis

        def _counted(**kwargs):
            call_counter["n"] += 1
            return original(**kwargs)

        monkeypatch.setattr("insights.aggregates.class_kpis", _counted)
        # The route imports the symbol; patch the route module's reference too.
        monkeypatch.setattr("protocols.insights_routes.aggregates.class_kpis", _counted)

        r1 = teacher_client.get(f"/api/insights/classes/{class_id}/kpis")
        r2 = teacher_client.get(f"/api/insights/classes/{class_id}/kpis")
        assert r1.status_code == r2.status_code == 200
        # Same response body, but the aggregate ran only once.
        assert call_counter["n"] == 1


# ---------------------------------------------------------------------------
# /classes/{id}/groups + /activities
# ---------------------------------------------------------------------------


class TestClassGroupsAndActivities:
    def test_groups_returns_per_group_data(self, teacher_client):
        class_id = _make_class(TEACHER_UID)
        resp = teacher_client.get(f"/api/insights/classes/{class_id}/groups")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["class_id"] == class_id
        assert body["groups"][0]["group_code"] == "g1"
        assert any("most_active_groups" == q["name"] for q in body["_debug"]["queries"])

    def test_activities_returns_per_activity_data(self, teacher_client):
        class_id = _make_class(TEACHER_UID)
        resp = teacher_client.get(f"/api/insights/classes/{class_id}/activities")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["class_id"] == class_id
        skill_ids = {a["skill_id"] for a in body["activities"]}
        assert "a" in skill_ids
        names = [q["name"] for q in body["_debug"]["queries"]]
        assert "time_on_task" in names and "sim_runs_per_skill" in names

    def test_cross_tenant_groups_byte_identical(self, teacher_client):
        bobs_class = _make_class(OTHER_TEACHER_UID, name="bob")
        cross = teacher_client.get(f"/api/insights/classes/{bobs_class}/groups")
        missing = teacher_client.get(f"/api/insights/classes/{MISSING_CLASS_ID}/groups")
        assert cross.content == missing.content


# ---------------------------------------------------------------------------
# /classes/{id}/trend
# ---------------------------------------------------------------------------


class TestClassTrend:
    def test_owned_class_returns_dense_per_day_series(self, teacher_client):
        class_id = _make_class(TEACHER_UID)
        resp = teacher_client.get(f"/api/insights/classes/{class_id}/trend")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # The dense series spans the full window. 7d window -> 8 entries
        # (since-day inclusive through until-day inclusive).
        assert len(body["per_day"]) >= 7
        assert all("day" in r and "count" in r for r in body["per_day"])

    def test_cross_tenant_byte_identical(self, teacher_client):
        bobs_class = _make_class(OTHER_TEACHER_UID, name="bob")
        cross = teacher_client.get(f"/api/insights/classes/{bobs_class}/trend")
        missing = teacher_client.get(f"/api/insights/classes/{MISSING_CLASS_ID}/trend")
        assert cross.content == missing.content


# ---------------------------------------------------------------------------
# /api/insights/compare
# ---------------------------------------------------------------------------


class TestCompare:
    def test_owned_classes_only(self, teacher_client):
        a = _make_class(TEACHER_UID, name="Alice 1")
        _make_class(OTHER_TEACHER_UID, name="Bob's — excluded")

        resp = teacher_client.get("/api/insights/compare")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        ids = {r["class_id"] for r in body["rows"]}
        assert ids == {a}
        row = body["rows"][0]
        assert "messages" in row and "messages_prior" in row and "messages_delta" in row

    def test_student_forbidden(self, student_client):
        resp = student_client.get("/api/insights/compare")
        assert resp.status_code == 403

    def test_scope_all_forbidden_for_non_researcher(self, teacher_client):
        resp = teacher_client.get("/api/insights/compare?scope=all")
        assert resp.status_code == 403

    def test_researcher_scope_all_spans_all_teachers(self, researcher_client):
        a = _make_class(TEACHER_UID, name="Alice 1")
        b = _make_class(OTHER_TEACHER_UID, name="Bob 1")
        resp = researcher_client.get("/api/insights/compare?scope=all")
        assert resp.status_code == 200, resp.text
        ids = {r["class_id"] for r in resp.json()["rows"]}
        assert {a, b} <= ids


# ---------------------------------------------------------------------------
# Cache invalidation hook is callable from outside (used by /api/classes PATCH)
# ---------------------------------------------------------------------------


def test_cache_invalidate_for_teacher_clears_stored_entries(teacher_client):
    class_id = _make_class(TEACHER_UID)
    teacher_client.get(f"/api/insights/classes/{class_id}/kpis")  # populate
    assert CACHE.size() > 0

    dropped = CACHE.invalidate_for_teacher(TEACHER_UID)
    assert dropped > 0
    assert CACHE.size() == 0
