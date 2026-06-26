"""Unit tests for ``insights.aggregates``.

Mocks the ``analytics.queries`` layer so tests run without BigQuery.
Properties under test:

- ``class_kpis`` composes six KPI numbers from the underlying queries.
- Cross-tenant attempt raises ``PermissionError`` with the canonical
  message (HARD GATE preserved at the aggregate layer too).
- ``_debug.queries`` carries the executed SQL templates + params.
- ``teacher_summary`` returns one entry per owned class.
- ``teacher_compare`` computes a delta vs the prior window.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from auth import User
from db import firestore as fs_module
from db.classes import create_class, mint_group_codes_under_class
from db.models.class_ import Class
from insights import aggregates

TEACHER_UID = "teacher-alice"
OTHER_TEACHER_UID = "teacher-bob"


def _user(uid: str = TEACHER_UID, *, is_researcher: bool = False) -> User:
    """Build the authenticated caller the aggregates now take (1.1.51).
    A researcher (`is_researcher=True`) may read any class cross-tenant."""
    return User(uid=uid, email=f"{uid}@example.test", is_teacher=True, is_researcher=is_researcher)


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _ts(year: int = 2026, month: int = 6, day: int = 1) -> datetime:
    return datetime(year, month, day, tzinfo=UTC)


def _create_class(owner_uid: str, *, name: str = "9A") -> str:
    cls = Class.create_for_teacher(owner_uid=owner_uid, name=name)
    create_class(cls)
    mint_group_codes_under_class(cls.class_id, count=2)
    return cls.class_id


# ---------------------------------------------------------------------------
# class_kpis
# ---------------------------------------------------------------------------


class TestClassKpis:
    def test_composes_six_kpis_from_queries(self, monkeypatch):
        class_id = _create_class(TEACHER_UID)
        since, until = _ts(), _ts(day=8)

        monkeypatch.setattr(
            "analytics.queries.count_messages",
            lambda **_: {
                "total": 100,
                "per_group": [{"group_code": "g1", "count": 60}, {"group_code": "g2", "count": 40}],
            },
        )
        monkeypatch.setattr(
            "analytics.queries.time_on_task",
            lambda **_: {
                "per_group": [
                    {
                        "group_code": "g1",
                        "skill_id": "a",
                        "first_ts": "2026-06-01T10:00:00+00:00",
                        "last_ts": "2026-06-02T11:00:00+00:00",
                        "duration_min": 30,
                    },
                    {
                        "group_code": "g2",
                        "skill_id": "b",
                        "first_ts": "2026-06-03T10:00:00+00:00",
                        "last_ts": "2026-06-04T11:00:00+00:00",
                        "duration_min": 20,
                    },
                ]
            },
        )
        monkeypatch.setattr(
            "analytics.queries.sim_runs_per_skill",
            lambda **_: {"per_skill": [{"skill_id": "a", "run_count": 5, "unique_groups": 1}], "total": 5},
        )
        monkeypatch.setattr(
            "analytics.queries.most_active_groups",
            lambda **_: {"groups": [{"group_code": "g1", "message_count": 60, "session_count": 4}]},
        )

        out = aggregates.class_kpis(user=_user(TEACHER_UID), class_id=class_id, since=since, until=until)

        assert out["kpis"]["active_groups"] == 2
        assert out["kpis"]["total_messages"] == 100
        # skill "a" and "b" each appear in time_on_task; sim_runs has only "a".
        # Union = {a, b}. Active activities = 2.
        assert out["kpis"]["active_activities"] == 2
        assert out["kpis"]["sim_runs"] == 5
        # Median of [30, 20] is 25.
        assert out["kpis"]["median_time_on_task_min"] == 25
        # Last activity == max(last_ts) across the time_on_task rows.
        assert out["kpis"]["last_activity"] == "2026-06-04T11:00:00+00:00"

    def test_debug_queries_carry_sql_and_params(self, monkeypatch):
        class_id = _create_class(TEACHER_UID)
        monkeypatch.setattr("analytics.queries.count_messages", lambda **_: {"total": 0, "per_group": []})
        monkeypatch.setattr("analytics.queries.time_on_task", lambda **_: {"per_group": []})
        monkeypatch.setattr("analytics.queries.sim_runs_per_skill", lambda **_: {"per_skill": [], "total": 0})
        monkeypatch.setattr("analytics.queries.most_active_groups", lambda **_: {"groups": []})

        out = aggregates.class_kpis(user=_user(TEACHER_UID), class_id=class_id, since=_ts(), until=_ts(day=8))

        names = [q["name"] for q in out["_debug"]["queries"]]
        assert names == ["count_messages", "time_on_task", "sim_runs_per_skill", "most_active_groups"]
        # Every entry has a non-empty SQL body sourced from queries.SQL_TEMPLATES.
        for q in out["_debug"]["queries"]:
            assert q["sql"], f"missing sql for {q['name']}"
            assert "SELECT" in q["sql"]
            assert "since" in q["params"] and "until" in q["params"]

    def test_cross_tenant_raises_class_not_accessible(self, monkeypatch):
        bobs_class = _create_class(OTHER_TEACHER_UID, name="Bob's class")
        with pytest.raises(PermissionError, match="class not accessible"):
            aggregates.class_kpis(
                user=_user(TEACHER_UID),
                class_id=bobs_class,
                since=_ts(),
                until=_ts(day=8),
            )

    def test_missing_class_raises_same_error_as_cross_tenant(self, monkeypatch):
        with pytest.raises(PermissionError, match="class not accessible"):
            aggregates.class_kpis(
                user=_user(TEACHER_UID),
                class_id="not-a-real-id",
                since=_ts(),
                until=_ts(day=8),
            )


# ---------------------------------------------------------------------------
# teacher_summary
# ---------------------------------------------------------------------------


def test_teacher_summary_returns_entry_per_owned_class(monkeypatch):
    a = _create_class(TEACHER_UID, name="Alice 1")
    b = _create_class(TEACHER_UID, name="Alice 2")
    _create_class(OTHER_TEACHER_UID, name="Bob's — excluded")

    monkeypatch.setattr(
        "analytics.queries.count_messages",
        lambda **_: {"total": 7, "per_group": [{"group_code": "g", "count": 7}]},
    )
    monkeypatch.setattr(
        "analytics.queries.time_on_task",
        lambda **_: {
            "per_group": [
                {
                    "group_code": "g",
                    "skill_id": "x",
                    "first_ts": "2026-06-01T00:00:00+00:00",
                    "last_ts": "2026-06-02T00:00:00+00:00",
                    "duration_min": 5,
                }
            ]
        },
    )

    out = aggregates.teacher_summary(user=_user(TEACHER_UID), since=_ts(), until=_ts(day=8))
    ids = {c["class_id"] for c in out["classes"]}
    assert ids == {a, b}
    assert all(c["active_groups"] == 1 and c["total_messages"] == 7 for c in out["classes"])
    assert all(c["last_activity"] == "2026-06-02T00:00:00+00:00" for c in out["classes"])


# ---------------------------------------------------------------------------
# class_trend — dense per-day series
# ---------------------------------------------------------------------------


def test_class_trend_fills_zero_days(monkeypatch):
    class_id = _create_class(TEACHER_UID)
    since = datetime(2026, 6, 1, tzinfo=UTC)
    until = datetime(2026, 6, 7, tzinfo=UTC)

    monkeypatch.setattr(
        "analytics.queries.messages_per_day",
        lambda **_: {
            "per_day": [
                {"day": "2026-06-02", "count": 5},
                {"day": "2026-06-05", "count": 2},
            ]
        },
    )

    out = aggregates.class_trend(user=_user(TEACHER_UID), class_id=class_id, since=since, until=until)
    days = [r["day"] for r in out["per_day"]]
    assert days == [
        "2026-06-01",
        "2026-06-02",
        "2026-06-03",
        "2026-06-04",
        "2026-06-05",
        "2026-06-06",
        "2026-06-07",
    ]
    counts = {r["day"]: r["count"] for r in out["per_day"]}
    assert counts["2026-06-02"] == 5
    assert counts["2026-06-05"] == 2
    assert counts["2026-06-01"] == 0


def test_class_trend_cross_tenant(monkeypatch):
    bobs_class = _create_class(OTHER_TEACHER_UID, name="bob")
    with pytest.raises(PermissionError, match="class not accessible"):
        aggregates.class_trend(
            user=_user(TEACHER_UID),
            class_id=bobs_class,
            since=_ts(),
            until=_ts(day=8),
        )


# ---------------------------------------------------------------------------
# teacher_compare — delta vs prior window
# ---------------------------------------------------------------------------


def test_teacher_compare_computes_delta(monkeypatch):
    _create_class(TEACHER_UID, name="Alice 1")
    since = _ts()
    until = since + timedelta(days=7)

    call_counter = {"n": 0}

    def fake_count(**kwargs) -> dict[str, Any]:
        call_counter["n"] += 1
        # First call = current window (10); second = prior (4); alternating per class.
        return {"total": 10 if call_counter["n"] % 2 == 1 else 4, "per_group": []}

    monkeypatch.setattr("analytics.queries.count_messages", fake_count)
    monkeypatch.setattr("analytics.queries.sim_runs_per_skill", lambda **_: {"per_skill": [], "total": 2})
    monkeypatch.setattr("analytics.queries.time_on_task", lambda **_: {"per_group": []})

    out = aggregates.teacher_compare(user=_user(TEACHER_UID), since=since, until=until)
    row = out["rows"][0]
    assert row["messages"] == 10
    assert row["messages_prior"] == 4
    assert row["messages_delta"] == 6
    assert row["sim_runs"] == 2


# ---------------------------------------------------------------------------
# Researcher cross-class bypass (sprint 1.1.51)
# ---------------------------------------------------------------------------


def _simple_query_mocks(monkeypatch) -> None:
    monkeypatch.setattr(
        "analytics.queries.count_messages",
        lambda **_: {"total": 9, "per_group": [{"group_code": "g", "count": 9}]},
    )
    monkeypatch.setattr("analytics.queries.time_on_task", lambda **_: {"per_group": []})
    monkeypatch.setattr(
        "analytics.queries.sim_runs_per_skill",
        lambda **_: {"per_skill": [], "total": 0},
    )
    monkeypatch.setattr("analytics.queries.most_active_groups", lambda **_: {"groups": []})


def test_researcher_reads_non_owned_class_kpis(monkeypatch):
    """A researcher gets real KPIs for a class they do NOT own — where a
    plain teacher would raise PermissionError (the 404 cliff)."""
    _simple_query_mocks(monkeypatch)
    bobs_class = _create_class(OTHER_TEACHER_UID, name="Bob's class")

    out = aggregates.class_kpis(
        user=_user("researcher-rae", is_researcher=True),
        class_id=bobs_class,
        since=_ts(),
        until=_ts(day=8),
    )
    assert out["kpis"]["total_messages"] == 9


def test_researcher_bypass_widens_allowed_group_codes(monkeypatch):
    """The defense-in-depth ``allowed_group_codes`` filter is widened to the
    target class's codes — without this the SQL intersection would be empty
    and the researcher would get authorized-but-zero rows."""
    from db.classes import get_class

    _simple_query_mocks(monkeypatch)
    bobs_class = _create_class(OTHER_TEACHER_UID, name="Bob's class")
    class_codes = set(get_class(bobs_class).group_codes)
    assert class_codes, "fixture should mint group codes"

    out = aggregates.class_kpis(
        user=_user("researcher-rae", is_researcher=True),
        class_id=bobs_class,
        since=_ts(),
        until=_ts(day=8),
    )
    allowed = set(out["_debug"]["queries"][0]["params"]["allowed_group_codes"])
    assert class_codes <= allowed


def test_owner_path_allowed_codes_unchanged_byte_identical(monkeypatch):
    """For an OWNER, _widen_allowed is a no-op — the emitted allowed_group_codes
    equal the caller's owned codes (regression bar: don't change owner output)."""
    from analytics.auth import resolve_caller_group_codes

    _simple_query_mocks(monkeypatch)
    class_id = _create_class(TEACHER_UID)
    owned_codes = set(resolve_caller_group_codes(TEACHER_UID))

    out = aggregates.class_kpis(user=_user(TEACHER_UID), class_id=class_id, since=_ts(), until=_ts(day=8))
    allowed = set(out["_debug"]["queries"][0]["params"]["allowed_group_codes"])
    assert allowed == owned_codes


def test_non_researcher_still_blocked_cross_tenant(monkeypatch):
    """A teacher without the claim is still refused a non-owned class."""
    _simple_query_mocks(monkeypatch)
    bobs_class = _create_class(OTHER_TEACHER_UID, name="bob")
    with pytest.raises(PermissionError, match="class not accessible"):
        aggregates.class_kpis(
            user=_user("teacher-carol", is_researcher=False),
            class_id=bobs_class,
            since=_ts(),
            until=_ts(day=8),
        )


def test_teacher_summary_scope_all_spans_all_teachers(monkeypatch):
    """scope='all' + researcher → every teacher's class, not just the caller's."""
    _simple_query_mocks(monkeypatch)
    a = _create_class(TEACHER_UID, name="Alice 1")
    b = _create_class(OTHER_TEACHER_UID, name="Bob 1")

    out = aggregates.teacher_summary(
        user=_user("researcher-rae", is_researcher=True),
        since=_ts(),
        until=_ts(day=8),
        scope="all",
    )
    ids = {c["class_id"] for c in out["classes"]}
    assert {a, b} <= ids
    # Each row carries the owner uid so the route can resolve a label.
    assert all("owner_uid" in c for c in out["classes"])


def test_teacher_summary_scope_all_ignored_without_claim(monkeypatch):
    """A non-researcher passing scope='all' silently gets their OWN scope
    (defense-in-depth; the route also 403s before reaching here)."""
    _simple_query_mocks(monkeypatch)
    _create_class(TEACHER_UID, name="Alice 1")
    _create_class(OTHER_TEACHER_UID, name="Bob 1")

    out = aggregates.teacher_summary(
        user=_user(TEACHER_UID, is_researcher=False),
        since=_ts(),
        until=_ts(day=8),
        scope="all",
    )
    owners = {c["owner_uid"] for c in out["classes"]}
    assert owners == {TEACHER_UID}


def test_teacher_compare_scope_all_spans_all_teachers(monkeypatch):
    _simple_query_mocks(monkeypatch)
    a = _create_class(TEACHER_UID, name="Alice 1")
    b = _create_class(OTHER_TEACHER_UID, name="Bob 1")

    out = aggregates.teacher_compare(
        user=_user("researcher-rae", is_researcher=True),
        since=_ts(),
        until=_ts(day=8),
        scope="all",
    )
    ids = {r["class_id"] for r in out["rows"]}
    assert {a, b} <= ids
