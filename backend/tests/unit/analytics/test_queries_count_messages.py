"""Tests for analytics.queries.count_messages.

The BQ client is mocked at ``run_query`` — these are pure SQL-shape +
parameter-binding tests. An integration test against a seeded BQ
dataset belongs under ``tests/integration/`` and is marked
``@integration`` so CI doesn't try to run it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

from analytics import queries

SINCE = datetime(2026, 5, 26, tzinfo=UTC)
UNTIL = datetime(2026, 6, 2, tzinfo=UTC)


def _fake_rows(per_group: list[tuple[str, int]]) -> list[dict]:
    return [{"group_code": gc, "count": count} for gc, count in per_group]


class TestCountMessagesSqlShape:
    """The SQL string is the security perimeter — these tests assert
    it has the right shape rather than the right rows."""

    def test_uses_parameter_binding_not_interpolation(self) -> None:
        """Every variable goes through @-named parameters; no f-string
        interpolation of caller-controlled values."""
        with patch.object(queries, "run_query") as mock_q:
            mock_q.return_value = []
            queries.count_messages(
                since=SINCE,
                until=UNTIL,
                allowed_group_codes=["a-1", "b-2"],
                class_group_codes=["a-1"],
            )
            assert mock_q.called
            sql_arg = mock_q.call_args.args[0]
            params_arg = mock_q.call_args.kwargs["params"]

            # SQL contains the named parameter references, not raw values.
            assert "@since" in sql_arg
            assert "@until" in sql_arg
            assert "@class_group_codes" in sql_arg
            assert "@allowed_group_codes" in sql_arg
            # Raw values do NOT appear in the SQL.
            assert "a-1" not in sql_arg
            assert "b-2" not in sql_arg
            # Params dict is bound through run_query.
            assert params_arg["since"] == SINCE
            assert params_arg["until"] == UNTIL
            assert set(params_arg["class_group_codes"]) == {"a-1"}
            assert set(params_arg["allowed_group_codes"]) == {"a-1", "b-2"}

    def test_filters_by_both_group_code_sets_defense_in_depth(self) -> None:
        """Even though class_group_codes is a subset of allowed_group_codes,
        the SQL applies BOTH filters as defense in depth."""
        with patch.object(queries, "run_query") as mock_q:
            mock_q.return_value = []
            queries.count_messages(
                since=SINCE,
                until=UNTIL,
                allowed_group_codes=["a-1", "b-2", "c-3"],
                class_group_codes=["a-1"],
            )
            sql_arg = mock_q.call_args.args[0]
            assert "IN UNNEST(@class_group_codes)" in sql_arg
            assert "IN UNNEST(@allowed_group_codes)" in sql_arg

    def test_uses_chat_turn_table_via_table_ref(self) -> None:
        """SQL references the chat-turn table via the canonical
        ``table_ref`` helper (so the dataset name comes from one place)."""
        with patch.object(queries, "run_query") as mock_q:
            mock_q.return_value = []
            queries.count_messages(
                since=SINCE,
                until=UNTIL,
                allowed_group_codes=["a-1"],
                class_group_codes=["a-1"],
            )
            sql = mock_q.call_args.args[0]
            assert "aipla_chat_turn" in sql
            # Backtick-quoted FQN as produced by table_ref.
            assert "`" in sql


class TestCountMessagesShortCircuit:
    """Empty inputs must not hit BQ — defense against an empty IN-list
    accidentally matching everything in some adapter."""

    def test_empty_class_group_codes_returns_zero_without_bq(self) -> None:
        with patch.object(queries, "run_query") as mock_q:
            result = queries.count_messages(
                since=SINCE,
                until=UNTIL,
                allowed_group_codes=["a-1"],
                class_group_codes=[],
            )
            assert result == {"total": 0, "per_group": []}
            mock_q.assert_not_called()

    def test_empty_allowed_group_codes_returns_zero_without_bq(self) -> None:
        with patch.object(queries, "run_query") as mock_q:
            result = queries.count_messages(
                since=SINCE,
                until=UNTIL,
                allowed_group_codes=[],
                class_group_codes=["a-1"],
            )
            assert result == {"total": 0, "per_group": []}
            mock_q.assert_not_called()


class TestCountMessagesShape:
    """The structured return shape is the contract the FunctionTool +
    REST routes consume — assert it explicitly."""

    def test_aggregates_total_and_returns_per_group_sorted(self) -> None:
        with patch.object(queries, "run_query") as mock_q:
            # The SQL has ORDER BY count DESC, but the test verifies our
            # wrapper preserves whatever order BQ returns.
            mock_q.return_value = _fake_rows([("g-pop", 42), ("g-quiet", 3)])
            result = queries.count_messages(
                since=SINCE,
                until=UNTIL,
                allowed_group_codes=["g-pop", "g-quiet"],
                class_group_codes=["g-pop", "g-quiet"],
            )
            assert result["total"] == 45
            assert result["per_group"] == [
                {"group_code": "g-pop", "count": 42},
                {"group_code": "g-quiet", "count": 3},
            ]

    def test_returns_zero_total_when_no_rows(self) -> None:
        with patch.object(queries, "run_query") as mock_q:
            mock_q.return_value = []
            result = queries.count_messages(
                since=SINCE,
                until=UNTIL,
                allowed_group_codes=["g-1"],
                class_group_codes=["g-1"],
            )
            assert result == {"total": 0, "per_group": []}
