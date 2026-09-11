"""The researcher chat-log lens's SQL (1.1.109), without a BigQuery.

The one that earns its place: **the inlined projection must stay in lockstep
with the terraform view it copies.** ``analytics/research_logs.py`` repeats the
``chat_turns`` view's SELECT list so the read path works on dev, which has no
views. Two copies of a projection drift — a column added to views.tf and not
here means the researcher lens silently lacks a field that the pipeline records,
which reads as "the data isn't there" rather than "the query didn't ask".
"""

from __future__ import annotations

import pathlib
import re

from analytics import research_logs

VIEWS_TF = pathlib.Path(__file__).resolve().parents[3] / "infrastructure/modules/chat-logs/views.tf"


def _view_query() -> str:
    """The chat_turns view body from views.tf (up to the workbench view)."""
    text = VIEWS_TF.read_text()
    start = text.index('table_id            = "chat_turns"')
    end = text.index('table_id            = "workbench_events"')
    return text[start:end]


def test_projection_selects_every_field_the_view_does():
    """Every ``$.<key>`` the view reads, the lens's CTE reads too."""
    view_keys = set(re.findall(r'"\$\.(\w+)"', _view_query()))
    cte = research_logs._turns_cte()
    cte_keys = set(re.findall(r'"\$\.(\w+)"', cte))
    missing = view_keys - cte_keys
    assert not missing, (
        f"chat_turns view selects field(s) the researcher lens does not: {sorted(missing)}. "
        "Add them to analytics/research_logs._turns_cte() or the lens cannot show them."
    )


def test_projection_uses_json_value_never_struct_members():
    """A struct-member read fails the WHOLE query on a young dataset.

    The sink infers the jsonPayload STRUCT only from fields it has seen
    non-null, so ``jsonPayload.framework_id`` over a dataset where no tutor was
    ever assigned raises ``Field name framework_id does not exist in STRUCT``.
    This is how enabling the views failed on 2026-09-11, and the lens would
    fail the same way on a fresh environment.
    """
    cte = research_logs._turns_cte()
    assert "JSON_VALUE(" in cte
    assert not re.search(r"jsonPayload\.\w+", cte)


def test_roles_match_what_the_emitter_writes():
    """'student'/'tutor', not 'user'/'assistant'.

    A rollup counting role='user' returns zero for every session — a silently
    empty column rather than an error. Verified against prod 2026-09-11.
    """
    from observability import chat_log

    src = pathlib.Path(chat_log.__file__).read_text()
    assert research_logs.ROLE_STUDENT in src
    assert research_logs.ROLE_TUTOR in src


def test_unassigned_sentinel_cannot_collide_with_a_framework_id():
    """Framework ids are slugs from backend/frameworks/*.yaml."""
    ids = {p.stem for p in (pathlib.Path(research_logs.__file__).parents[1] / "frameworks").glob("*.yaml")}
    assert ids, "no framework yaml found — the collision check would be vacuous"
    assert research_logs.UNASSIGNED not in ids


def test_filters_bind_parameters_and_never_interpolate():
    """Caller text must never reach the SQL string."""
    where, params = research_logs._filter_sql("esru'; DROP TABLE x--", "c-1", "a-1")
    assert "DROP TABLE" not in where
    assert "@framework" in where and "@class_id" in where and "@activity_id" in where
    assert params["framework"] == "esru'; DROP TABLE x--"


def test_unassigned_filter_is_a_null_test_not_an_equality():
    where, params = research_logs._filter_sql(research_logs.UNASSIGNED, None, None)
    assert where == "WHERE framework_id IS NULL"
    assert "framework" not in params


def test_no_filter_yields_no_where_clause():
    where, params = research_logs._filter_sql(None, None, None)
    assert where == ""
    assert params == {}


def test_limit_is_clamped_to_the_ceiling(monkeypatch):
    """A researcher cannot ask for an unbounded result."""
    captured = {}

    def fake_run_query(sql, params=None):
        captured["params"] = params or {}
        return []

    monkeypatch.setattr(research_logs, "run_query", fake_run_query)
    research_logs.list_sessions(limit=10_000)
    assert captured["params"]["limit"] == research_logs.MAX_LIMIT


def test_sessions_group_by_session_and_framework(monkeypatch):
    """A session that changed tutor mid-conversation appears under both arms.

    Collapsing it to one framework would attribute turns to a framework that
    did not produce them — a wrong label that looks like evidence.
    """
    captured = {}

    def fake_run_query(sql, params=None):
        captured["sql"] = sql
        return []

    monkeypatch.setattr(research_logs, "run_query", fake_run_query)
    research_logs.list_sessions()
    assert "GROUP BY session_id, framework_id" in captured["sql"]


def test_transcript_orders_by_turn_index_with_nulls_last(monkeypatch):
    captured = {}

    def fake_run_query(sql, params=None):
        captured["sql"] = sql
        captured["params"] = params
        return []

    monkeypatch.setattr(research_logs, "run_query", fake_run_query)
    research_logs.session_transcript("s-1")
    assert "ORDER BY turn_index NULLS LAST, ts" in captured["sql"]
    assert captured["params"]["session_id"] == "s-1"


def test_synthetic_turns_are_marked_not_dropped(monkeypatch):
    """ "[session_start]" is not something a student typed.

    It is the non-empty sentinel a system-driven turn must send, because
    ``ag_ui_adk._convert_latest_message`` silently drops a message with falsy
    content. It is logged under role='student' like any other turn, so a
    transcript would show it as a student utterance. The lens flags it —
    filtering it out instead would hide that the system opened the
    conversation, which is a fact about the interaction.
    """
    captured = {}

    def fake_run_query(sql, params=None):
        captured["sql"] = sql
        captured["params"] = params
        return []

    monkeypatch.setattr(research_logs, "run_query", fake_run_query)
    research_logs.session_transcript("s-1")
    assert "AS is_synthetic" in captured["sql"]
    assert "[session_start]" in captured["params"]["synthetic"]


def test_readable_turns_excludes_the_synthetic_sentinel(monkeypatch):
    """A 4-turn session that is really 3 turns plus a system opener."""
    captured = {}

    def fake_run_query(sql, params=None):
        captured["sql"] = sql
        return []

    monkeypatch.setattr(research_logs, "run_query", fake_run_query)
    research_logs.list_sessions()
    assert "NOT IN UNNEST(@synthetic)) AS readable_turns" in captured["sql"]
