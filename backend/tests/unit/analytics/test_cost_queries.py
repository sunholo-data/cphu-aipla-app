"""Tests for analytics.cost_queries — spend aggregation (sprint 1.1.9).

BQ is mocked at `run_query`; these are SQL-shape + folding + period tests.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from analytics import cost_queries
from db import classes as classes_db
from db import firestore as fs_module
from db.models.class_ import Class

NOW = datetime(2026, 6, 15, 12, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _seed_class(owner: str, *, name="C", group_codes=None, cohort=None) -> Class:
    cls = Class.create_for_teacher(owner_uid=owner, name=name)
    update = {}
    if group_codes:
        update["group_codes"] = group_codes
    if cohort:
        update["cohort"] = cohort
    if update:
        cls = cls.model_copy(update=update)
    classes_db.create_class(cls)
    return cls


# --- period bounds ---------------------------------------------------------


def test_period_this_month() -> None:
    since, until = cost_queries.period_bounds("this_month", now=NOW)
    assert since == datetime(2026, 6, 1, tzinfo=UTC)
    assert until == NOW


def test_period_last_month() -> None:
    since, until = cost_queries.period_bounds("last_month", now=NOW)
    assert since == datetime(2026, 5, 1, tzinfo=UTC)
    assert until == datetime(2026, 6, 1, tzinfo=UTC)


def test_projection_linear() -> None:
    # day 15 of a 30-day month -> x2
    assert cost_queries.project_month_eur(10.0, now=NOW) == 20.0


# --- spend_rows SQL shape --------------------------------------------------


def test_spend_rows_empty_codes_short_circuits() -> None:
    with patch.object(cost_queries, "run_query") as mock_q:
        assert cost_queries.spend_rows([], NOW, NOW) == []
        mock_q.assert_not_called()


def test_spend_rows_param_binding_no_interpolation() -> None:
    with patch.object(cost_queries, "run_query") as mock_q:
        mock_q.return_value = []
        cost_queries.spend_rows(["a-b-1"], datetime(2026, 6, 1, tzinfo=UTC), NOW)
        sql = mock_q.call_args.args[0]
        params = mock_q.call_args.kwargs["params"]
        assert "@group_codes" in sql and "@since" in sql and "@until" in sql
        assert "a-b-1" not in sql  # value bound, not interpolated
        assert params["group_codes"] == ["a-b-1"]


# --- class_spend folding ---------------------------------------------------


def test_class_spend_folds_tokens_to_eur() -> None:
    cls = _seed_class("teacher-A", group_codes=["g-1"])
    fake = [
        {
            "model": "claude-sonnet-4-6",
            "skill_id": "boldkast",
            "group_id": "g-1",
            "token_in": 10_000,
            "token_out": 5_000,
        },
        {"model": "gemini-2.5-flash", "skill_id": "kinebot", "group_id": "g-1", "token_in": 20_000, "token_out": 1_000},
    ]
    with patch.object(cost_queries, "spend_rows", return_value=fake):
        result = cost_queries.class_spend(cls.class_id, "this_month", now=NOW)
    # sonnet: 10*0.0027 + 5*0.0135 = 0.027 + 0.0675 = 0.0945
    # flash: 20*0.0003 + 1*0.0012 = 0.006 + 0.0012 = 0.0072
    assert result["total_eur"] == pytest.approx(0.1017)
    assert result["by_activity"][0]["skill_id"] == "boldkast"  # most expensive first
    assert result["projected_eur"] == pytest.approx(0.2034)  # day 15 -> x2


def test_class_spend_unknown_class_is_zero() -> None:
    with patch.object(cost_queries, "spend_rows", return_value=[]):
        result = cost_queries.class_spend("nope", "all_time", now=NOW)
    assert result["total_eur"] == 0.0
    assert result["projected_eur"] is None  # only this_month projects


# --- cohort_spend ----------------------------------------------------------


def test_cohort_spend_groups_by_cohort() -> None:
    _seed_class("t-A", name="DK class", group_codes=["dk-1"], cohort="dk")
    _seed_class("t-B", name="IN class", group_codes=["in-1"], cohort="in-beta")
    fake = [
        {"model": "gemini-2.5-flash", "skill_id": "s", "group_id": "dk-1", "token_in": 100_000, "token_out": 0},
        {"model": "gemini-2.5-flash", "skill_id": "s", "group_id": "in-1", "token_in": 50_000, "token_out": 0},
    ]
    with patch.object(cost_queries, "spend_rows", return_value=fake):
        result = cost_queries.cohort_spend("this_month", now=NOW)
    cohorts = {c["cohort"]: c["eur"] for c in result["by_cohort"]}
    assert cohorts["dk"] == pytest.approx(0.03)  # 100k * 0.0003
    assert cohorts["in-beta"] == pytest.approx(0.015)
    assert result["by_cohort"][0]["cohort"] == "dk"  # descending
    assert len(result["per_class"]) == 2
