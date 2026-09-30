"""``session_timeline`` (1.1.136 M1) — turns and workbench work, interleaved.

No BigQuery: ``run_query`` is replaced by a fake that answers the turns query
and the work query separately (they are two queries on purpose — see the
function's docstring).
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from analytics import research_logs

T0 = datetime(2026, 9, 22, 9, 0, tzinfo=UTC)


def _at(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


def _fake(turns, work, *, work_raises: Exception | None = None, captured: list | None = None):
    def run_query(sql, params=None):
        if captured is not None:
            captured.append((sql, params))
        if "WITH work AS" in sql:
            if work_raises is not None:
                raise work_raises
            return work
        return turns

    return run_query


def _turn(i, role, ts, content="x", latency_ms=None):
    return {
        "ts": ts,
        "turn_index": i,
        "role": role,
        "content": content,
        "latency_ms": latency_ms,
        "is_synthetic": False,
    }


def _work(ts, label=None, server="table"):
    return {"ts": ts, "server": server, "tool": "state", "field": "state", "value": "{}", "label": label}


def test_work_is_slotted_between_turns_by_time(monkeypatch):
    turns = [_turn(0, "student", _at(10)), _turn(1, "tutor", _at(12)), _turn(2, "student", _at(60))]
    work = [_work(_at(5), "before"), _work(_at(30), "between"), _work(_at(90), "after")]
    monkeypatch.setattr(research_logs, "run_query", _fake(turns, work))
    items = research_logs.session_timeline("s-1")["items"]
    assert [(i["kind"], i.get("label") or i.get("turn_index")) for i in items] == [
        ("work", "before"),
        ("turn", 0),
        ("turn", 1),
        ("work", "between"),
        ("turn", 2),
        ("work", "after"),
    ]


def test_student_turn_is_anchored_at_when_it_was_sent_not_logged(monkeypatch):
    """Both turns of an invocation are LOGGED after the reply. A table edit made
    while the tutor was thinking must sort after the question, not before it."""
    # Student sent at 100s, tutor replied at 110s; both logged at 110s.
    turns = [_turn(0, "student", _at(110)), _turn(1, "tutor", _at(110), latency_ms=10_000)]
    work = [_work(_at(95), "before the question"), _work(_at(105), "while the tutor thought")]
    monkeypatch.setattr(research_logs, "run_query", _fake(turns, work))
    items = research_logs.session_timeline("s-1")["items"]
    order = [i.get("label") or f"turn{i['turn_index']}" for i in items]
    assert order == ["before the question", "turn0", "while the tutor thought", "turn1"]


def test_turn_order_is_never_changed(monkeypatch):
    """Re-anchoring can only move a student turn earlier, never past the one
    before it — the transcript's own order is sacred."""
    turns = [
        _turn(0, "tutor", _at(50)),
        _turn(1, "student", _at(60)),
        _turn(2, "tutor", _at(60), latency_ms=30_000),  # would anchor turn 1 at 30s < 50s
    ]
    monkeypatch.setattr(research_logs, "run_query", _fake(turns, []))
    items = research_logs.session_timeline("s-1")["items"]
    assert [i["turn_index"] for i in items] == [0, 1, 2]


def test_unreadable_work_is_reported_not_rendered_as_no_work(monkeypatch):
    turns = [_turn(0, "student", _at(1))]
    monkeypatch.setattr(research_logs, "run_query", _fake(turns, [], work_raises=RuntimeError("no table")))
    out = research_logs.session_timeline("s-1")
    assert out["workStatus"] == "unreadable"
    assert [i["kind"] for i in out["items"]] == ["turn"]


def test_unreadable_turns_raise(monkeypatch):
    """The transcript half is not optional: the route turns this into a 503."""

    def boom(sql, params=None):
        raise RuntimeError("bq down")

    monkeypatch.setattr(research_logs, "run_query", boom)
    try:
        research_logs.session_timeline("s-1")
    except RuntimeError:
        return
    raise AssertionError("expected the turns read failure to propagate")


def test_group_narrows_both_reads_as_a_bound_parameter(monkeypatch):
    captured: list = []
    monkeypatch.setattr(research_logs, "run_query", _fake([], [], captured=captured))
    research_logs.session_timeline("s-1", group_id="bold-kazoo-87")
    assert len(captured) == 2
    for sql, params in captured:
        assert "group_id = @group_id" in sql
        assert params["group_id"] == "bold-kazoo-87"
        assert "bold-kazoo-87" not in sql


def test_turns_read_excludes_non_student_conversations(monkeypatch):
    captured: list = []
    monkeypatch.setattr(research_logs, "run_query", _fake([], [], captured=captured))
    research_logs.session_timeline("s-1")
    turns_sql = next(sql for sql, _ in captured if "WITH turns AS" in sql)
    assert "teacher:" in turns_sql and "preview:" in turns_sql


def test_work_projection_reads_the_m0_columns_with_json_value():
    """The M0 columns are NULL on every older row; a struct-member read of a
    never-populated field fails the whole query on a young dataset."""
    cte = research_logs._work_cte()
    for key in ("label", "activity_id", "class_id", "server", "value"):
        assert f'"$.{key}"' in cte
    assert not re.search(r"jsonPayload\.\w+", cte)
