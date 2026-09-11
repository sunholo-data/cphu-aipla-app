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
    assert "framework_id IS NULL" in where
    assert "framework" not in params


def test_every_filter_excludes_non_student_turns():
    """The correction of 2026-09-11. Teacher co-pilot turns (and, from M3,
    tutor previews) are real rows in the same table and are NOT teaching —
    nobody was taught. Before this, 23 teacher sessions sat on prod among the
    student conversations, separable only by having no content.

    Asserted on EVERY filter shape, because a lens where one query forgets it
    shows chatter as evidence."""
    for args in (
        (None, None, None),
        (research_logs.UNASSIGNED, None, None),
        ("esru", "c-1", "a-1"),
    ):
        where, _ = research_logs._filter_sql(*args)
        for prefix in research_logs.NON_STUDENT_PREFIXES:
            assert f"NOT STARTS_WITH(IFNULL(group_id, ''), '{prefix}')" in where


def test_no_caller_filter_still_narrows_to_student_conversations():
    """There is no such thing as "no WHERE clause" here any more: the lens is
    about student conversations, and that is a floor rather than a filter."""
    where, params = research_logs._filter_sql(None, None, None)
    assert where.startswith("WHERE NOT STARTS_WITH")
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


def test_the_exclusion_is_null_safe():
    """`NOT STARTS_WITH(NULL, 'teacher:')` is NULL, not TRUE.

    Without IFNULL the filter silently DROPS every row with no group_id — 21 of
    them on prod, caught because the lens totals stopped reconciling with the
    raw table by exactly that many. A row with no group is not a teacher row;
    it is an unattributed row, and hiding it is the opposite of what this lens
    is for.
    """
    where, _ = research_logs._filter_sql(None, None, None)
    assert "IFNULL(group_id, '')" in where
    assert "STARTS_WITH(group_id," not in where  # the unguarded form must not survive


def test_excluded_counts_reports_what_the_lens_hides():
    """Reported, not silently dropped. A lens whose totals cannot be reconciled
    against the table is one whose numbers nobody can explain."""
    captured = {}

    def fake_run_query(sql, params=None):
        captured["sql"] = sql
        return [{"teacher_turns": 150, "teacher_sessions": 23, "preview_turns": 0, "preview_sessions": 0}]

    import pytest

    monkey = pytest.MonkeyPatch()
    monkey.setattr(research_logs, "run_query", fake_run_query)
    try:
        out = research_logs.excluded_counts()
    finally:
        monkey.undo()

    assert out["teacher_sessions"] == 23
    # It counts BOTH excluded kinds, so adding a third prefix without extending
    # this shows up as a number that no longer adds up.
    for prefix in research_logs.NON_STUDENT_PREFIXES:
        assert prefix in captured["sql"]


def test_session_less_rows_are_never_listed_as_conversations():
    """A row with no session_id is not a conversation and must not be offered as
    one — there is no transcript to open.

    Shipped without this in 1.1.109: 21 such rows on prod grouped into a single
    result with `session_id: null`, the UI called `.slice()` on it, and React
    unmounted the whole tree — "Application error" on the entire page, from one
    field on one row.
    """
    where, _ = research_logs._filter_sql(None, None, None)
    assert "session_id IS NOT NULL" in where
    assert "session_id != ''" in where


def test_unattributed_turns_are_counted_even_though_they_cannot_be_listed():
    """Excluded from the list, but not from the arithmetic — otherwise the
    totals stop reconciling against the raw table and nobody can say why."""
    captured = {}

    def fake_run_query(sql, params=None):
        captured["sql"] = sql
        return [{"unattributed_turns": 24}]

    import pytest

    monkey = pytest.MonkeyPatch()
    monkey.setattr(research_logs, "run_query", fake_run_query)
    try:
        out = research_logs.excluded_counts()
    finally:
        monkey.undo()

    assert out["unattributed_turns"] == 24
    assert "session_id IS NULL" in captured["sql"]
