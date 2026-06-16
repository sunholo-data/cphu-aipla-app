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


_ALL_COLS = {"model", "skill_id", "group_id", "token_in", "token_out"}


def test_spend_rows_empty_codes_short_circuits() -> None:
    with patch.object(cost_queries, "run_query") as mock_q:
        assert cost_queries.spend_rows([], NOW, NOW) == []
        mock_q.assert_not_called()


def test_spend_rows_param_binding_no_interpolation() -> None:
    with (
        patch.object(cost_queries, "jsonpayload_columns", return_value=_ALL_COLS),
        patch.object(cost_queries, "run_query") as mock_q,
    ):
        mock_q.return_value = []
        cost_queries.spend_rows(["a-b-1"], datetime(2026, 6, 1, tzinfo=UTC), NOW)
        sql = mock_q.call_args.args[0]
        params = mock_q.call_args.kwargs["params"]
        assert "@group_codes" in sql and "@since" in sql and "@until" in sql
        assert "a-b-1" not in sql  # value bound, not interpolated
        assert params["group_codes"] == ["a-b-1"]
        assert "jsonPayload.model" in sql  # column present → selected


def test_spend_rows_tolerates_missing_model_column() -> None:
    """The bug that 500'd on first ship: model column absent on a young
    log-sink dataset. The query must NOT reference jsonPayload.model then."""
    with (
        patch.object(
            cost_queries, "jsonpayload_columns", return_value={"skill_id", "group_id", "token_in", "token_out"}
        ),
        patch.object(cost_queries, "run_query") as mock_q,
    ):
        mock_q.return_value = []
        cost_queries.spend_rows(["a-b-1"], datetime(2026, 6, 1, tzinfo=UTC), NOW)
        sql = mock_q.call_args.args[0]
        assert "jsonPayload.model" not in sql
        assert "CAST(NULL AS STRING) AS model" in sql
        assert "GROUP BY jsonPayload.skill_id, jsonPayload.group_id" in sql


def test_spend_rows_tolerates_missing_token_columns() -> None:
    with (
        patch.object(cost_queries, "jsonpayload_columns", return_value={"model", "skill_id", "group_id"}),
        patch.object(cost_queries, "run_query") as mock_q,
    ):
        mock_q.return_value = []
        cost_queries.spend_rows(["a-b-1"], datetime(2026, 6, 1, tzinfo=UTC), NOW)
        sql = mock_q.call_args.args[0]
        assert "CAST(jsonPayload.token_in AS INT64)" not in sql
        assert "0 AS token_in" in sql


def test_class_spend_degrades_to_zero_on_bq_error() -> None:
    """A BQ failure must yield €0, never a 500 (graceful degradation)."""
    cls = _seed_class("teacher-A", group_codes=["g-1"])
    with patch.object(cost_queries, "spend_rows", side_effect=RuntimeError("BQ down")):
        result = cost_queries.class_spend(cls.class_id, "this_month", now=NOW)
    assert result["total_eur"] == 0.0
    assert result["by_activity"] == []


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


def test_classes_spend_aggregates_per_class_and_total() -> None:
    """Teacher-scoped spend: one BQ query over the union of codes, summed back
    to each class + a grand total. Regression guard for the class-list spend
    column + teacher-level total."""
    mapping = {
        "class-A": ["wooly-kettle-61"],
        "class-B": ["bold-fox-2"],
        "class-C": ["lonely-code-9"],  # no rows -> 0.0
    }
    rows = [
        {"model": "m", "skill_id": "s", "group_id": "wooly-kettle-61", "token_in": 0, "token_out": 0},
        {"model": "m", "skill_id": "s", "group_id": "bold-fox-2", "token_in": 0, "token_out": 0},
        {"model": "m", "skill_id": "s", "group_id": "bold-fox-2", "token_in": 0, "token_out": 0},
    ]
    with (
        patch.object(cost_queries, "_safe_spend_rows", return_value=rows),
        patch.object(cost_queries, "cost_eur", side_effect=lambda *a, **k: 0.5),
    ):
        out = cost_queries.classes_spend(mapping, "this_month", now=NOW)

    assert out["total_eur"] == pytest.approx(1.5)  # 3 rows x 0.5 EUR
    per = {p["class_id"]: p["eur"] for p in out["per_class"]}
    assert per["class-A"] == pytest.approx(0.5)  # 1 row
    assert per["class-B"] == pytest.approx(1.0)  # 2 rows
    assert per["class-C"] == pytest.approx(0.0)  # class with no activity still listed
