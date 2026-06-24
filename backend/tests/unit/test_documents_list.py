"""list_documents_for_user — newest-first, capped, index-free (1.1.45 fix).

Regression for the GET /api/documents 500: the query must NOT use a Firestore
``order_by`` (which, combined with the equality filters, needs an unprovisioned
composite index). It sorts in Python instead.
"""

from __future__ import annotations

from unittest.mock import patch

from tools.documents.context import list_documents_for_user


def test_lists_newest_first_and_caps_to_limit() -> None:
    rows = [
        {"__id": "a", "createdAt": "2026-06-01T10:00:00+00:00"},
        {"__id": "b", "createdAt": "2026-06-03T10:00:00+00:00"},
        {"__id": "c", "createdAt": "2026-06-02T10:00:00+00:00"},
    ]
    with patch("tools.documents.context.query_documents", return_value=rows) as q:
        out = list_documents_for_user("u1", skill_id="s1", limit=2)

    # ISO-8601 createdAt → reverse lexical sort is chronological; capped at limit.
    assert [r["__id"] for r in out] == ["b", "c"]
    # The query carries NO order_by (index-free) and scopes by the equality filters.
    _, kwargs = q.call_args
    assert "order_by" not in kwargs
    assert ("userId", "==", "u1") in kwargs["filters"]
    assert ("status", "==", "parsed") in kwargs["filters"]
    assert ("skillId", "==", "s1") in kwargs["filters"]


def test_omits_skill_filter_when_no_skill() -> None:
    with patch("tools.documents.context.query_documents", return_value=[]) as q:
        list_documents_for_user("u1")
    fields = [f[0] for f in q.call_args.kwargs["filters"]]
    assert "skillId" not in fields


def test_missing_created_at_does_not_crash() -> None:
    rows = [{"__id": "a"}, {"__id": "b", "createdAt": "2026-06-03T10:00:00+00:00"}]
    with patch("tools.documents.context.query_documents", return_value=rows):
        out = list_documents_for_user("u1")
    # The dated doc sorts ahead of the undated one (no exception).
    assert out[0]["__id"] == "b"
