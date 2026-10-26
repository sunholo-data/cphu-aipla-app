"""1.1.141 M0 prep — the goal-pedagogy session selection, with mocked BigQuery
and Firestore. A dry run makes ZERO model calls; group ids never leave."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from datetime import date
from pathlib import Path

import pytest

from analytics import goal_lint_sessions as gls
from analytics.teaching_goal_lint import GoalLint, PedagogySpan

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "goal-lint-sessions.py"

ROWS = [
    {"session_id": "s1", "activity_ids": ["act-a"], "framework_ids": ["esru"], "tutor_turns": 9, "first_ts": "1"},
    {"session_id": "s2", "activity_ids": ["act-a"], "framework_ids": ["esru"], "tutor_turns": 7, "first_ts": "2"},
    {"session_id": "s3", "activity_ids": ["act-b"], "framework_ids": ["poe"], "tutor_turns": 8, "first_ts": "3"},
    {
        "session_id": "s4",
        "activity_ids": ["act-a", "act-b"],
        "framework_ids": ["esru"],
        "tutor_turns": 9,
        "first_ts": "4",
    },
    {"session_id": "s5", "activity_ids": ["act-c"], "framework_ids": ["esru"], "tutor_turns": 2, "first_ts": "5"},
    {"session_id": "s6", "activity_ids": ["act-gone"], "framework_ids": ["esru"], "tutor_turns": 9, "first_ts": "6"},
]
GOALS = {"act-a": "Mål perioden. Vær opmuntrende.", "act-b": "Forudsig, observer, forklar."}


def _query(sql, params):
    _query.calls.append((sql, params))
    return ROWS


_query.calls = []


@pytest.fixture(autouse=True)
def _reset():
    _query.calls.clear()


@pytest.fixture
def no_model_calls(monkeypatch):
    import google.genai as genai

    def _boom(*a, **kw):
        raise AssertionError("a model client was constructed")

    async def _lint_boom(*a, **kw):
        raise AssertionError("the lint model was called")

    monkeypatch.setattr(genai, "Client", _boom)
    monkeypatch.setattr("analytics.teaching_goal_lint._call_lint_model", _lint_boom)


@pytest.fixture(scope="module")
def script():
    spec = importlib.util.spec_from_file_location("goal_lint_sessions_script", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_selection_sql_is_tutor_taught_students_only_and_carries_no_content():
    sql = gls.selection_sql("v")
    assert "teaching_source = 'tutor'" in sql
    assert "activity_id IS NOT NULL" in sql
    for prefix in ("teacher:", "preview:", "preview-"):
        assert f"'{prefix}'" in sql
    assert "content" not in sql.replace("IFNULL(group_id", "")  # no transcript read


def test_select_excludes_mixed_and_short_sessions():
    sel = gls.select_sessions(_query, "v", since=date(2026, 9, 26), until=date(2026, 9, 30), min_turns=6)
    assert [s.session_id for s in sel.sessions] == ["s1", "s2", "s3", "s6"]
    assert sel.mixed == 1 and sel.below_min_turns == 1


def test_plan_counts_one_call_per_distinct_goal_and_approach():
    sel = gls.select_sessions(_query, "v", since=date(2026, 9, 26), until=date(2026, 9, 30), min_turns=6)
    plan = gls.plan_lint(sel, GOALS.get)
    assert plan.missing == ["act-gone"]
    assert plan.lint_calls == 2  # s1 + s2 share a goal and an approach
    assert plan.tokens()[0] > 0


def test_run_lint_labels_each_session(monkeypatch):
    sel = gls.select_sessions(_query, "v", since=date(2026, 9, 26), until=date(2026, 9, 30), min_turns=6)
    plan = gls.plan_lint(sel, GOALS.get)

    async def _lint(text, *, framework_id=None):
        spans = (
            [PedagogySpan(text="Vær opmuntrende.", kind="tone", conflictsWith=["elicit"])] if "opmunt" in text else []
        )
        return GoalLint(spans=spans, frameworkId=framework_id)

    rows = asyncio.run(gls.run_lint(plan, _lint))
    by_id = {r["sessionId"]: r for r in rows}
    assert by_id["s1"]["carriesPedagogy"] and by_id["s1"]["spanKinds"] == ["tone"]
    assert by_id["s1"]["conflictsWith"] == ["elicit"]
    assert not by_id["s3"]["carriesPedagogy"]
    assert by_id["s6"]["goalRead"] is False
    assert all("Vær" not in json.dumps(r, ensure_ascii=False) for r in rows)  # no goal text out


def test_dry_run_makes_zero_model_calls(script, no_model_calls, monkeypatch, capsys):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "unset")
    rc = script.main(["--dry-run", "--since", "2026-09-26", "--until", "2026-09-30"], query=_query, read_goal=GOALS.get)
    assert rc == 0
    out = capsys.readouterr().out
    assert "lint calls    : 2" in out
    assert "--dry-run: no model was called" in out
    assert len(_query.calls) == 1


def test_without_go_it_refuses(script, no_model_calls, monkeypatch, capsys):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "unset")
    rc = script.main(["--since", "2026-09-26"], query=_query, read_goal=GOALS.get)
    assert rc == 2
    assert "Refusing" in capsys.readouterr().out
