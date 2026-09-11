"""API tests for /api/research/logs/* (1.1.109 — the researcher chat-log lens).

Properties under test:

1. **Researcher-only.** A plain teacher gets 403 on every route.
2. **A failed read is a 503, never an empty tab.** The one that matters: an
   empty list returned for an unreadable store is a research conclusion
   ("nothing ran under ESRU") manufactured out of an outage.
3. The unassigned bucket round-trips its sentinel.
4. Export emits CSV/JSONL of the turn text.

BigQuery is mocked at the ``analytics.research_logs`` boundary — these exercise
the route + auth surface, not the SQL. The SQL's own shape is covered in
``tests/unit/test_research_logs_sql.py``.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import User, get_current_user
from protocols.research_logs_routes import router

TEACHER = User(uid="t-1", email="teacher@ku.dk", domain="ku.dk", is_teacher=True, is_researcher=False)
RESEARCHER = User(uid="r-1", email="researcher@ku.dk", domain="ku.dk", is_teacher=True, is_researcher=True)


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize(
    "path",
    [
        "/api/research/logs/tabs",
        "/api/research/logs/sessions",
        "/api/research/logs/sessions/s-1",
        "/api/research/logs/export",
    ],
)
def test_plain_teacher_is_refused_everywhere(path):
    assert _client(TEACHER).get(path).status_code == 403


def test_tabs_returns_rows_and_the_unassigned_key(monkeypatch):
    from analytics import research_logs

    monkeypatch.setattr(
        research_logs,
        "framework_tabs",
        lambda: [{"framework_id": "esru", "sessions": 3, "turns": 20}],
    )
    monkeypatch.setattr(
        research_logs,
        "excluded_counts",
        lambda: {"teacher_turns": 150, "teacher_sessions": 23, "preview_turns": 0, "preview_sessions": 0},
    )
    resp = _client(RESEARCHER).get("/api/research/logs/tabs")
    assert resp.status_code == 200
    body = resp.json()
    assert body["tabs"][0]["framework_id"] == "esru"
    assert body["unassignedKey"] == research_logs.UNASSIGNED
    # What the lens is NOT showing travels with it, so its totals can be
    # reconciled against the raw table.
    assert body["excluded"]["teacher_sessions"] == 23


def test_unreadable_store_is_503_not_an_empty_result(monkeypatch):
    """The reassuring-wrong-answer guard.

    A BigQuery outage must not render as "no conversations used this
    framework". That is the deploy-status footgun applied to evidence: the
    failure mode and the real finding would be byte-identical in the UI.
    """
    from analytics import research_logs

    def boom():
        raise RuntimeError("403 Access Denied: Table aipla_chat_turn")

    monkeypatch.setattr(research_logs, "framework_tabs", boom)
    resp = _client(RESEARCHER).get("/api/research/logs/tabs")
    assert resp.status_code == 503
    assert "failed read" in resp.json()["detail"]
    assert "not an empty result" in resp.json()["detail"]


def test_sessions_passes_the_unassigned_sentinel_through(monkeypatch):
    from analytics import research_logs

    seen = {}

    def fake(**kwargs):
        seen.update(kwargs)
        return [{"session_id": "s-9", "framework_id": research_logs.UNASSIGNED, "turns": 4}]

    monkeypatch.setattr(research_logs, "list_sessions", fake)
    resp = _client(RESEARCHER).get(f"/api/research/logs/sessions?framework={research_logs.UNASSIGNED}&limit=10")
    assert resp.status_code == 200
    assert seen["framework"] == research_logs.UNASSIGNED
    assert seen["limit"] == 10
    assert resp.json()["sessions"][0]["session_id"] == "s-9"


def test_transcript_404s_when_no_turns(monkeypatch):
    from analytics import research_logs

    monkeypatch.setattr(research_logs, "session_transcript", lambda sid: [])
    assert _client(RESEARCHER).get("/api/research/logs/sessions/nope").status_code == 404


def test_transcript_returns_turns_in_order(monkeypatch):
    from analytics import research_logs

    monkeypatch.setattr(
        research_logs,
        "session_transcript",
        lambda sid: [
            {"turn_index": 0, "role": "student", "content": "why does it fall?"},
            {"turn_index": 1, "role": "tutor", "content": "what do you predict?"},
        ],
    )
    body = _client(RESEARCHER).get("/api/research/logs/sessions/s-1").json()
    assert [t["role"] for t in body["turns"]] == ["student", "tutor"]


def test_export_csv_carries_the_text(monkeypatch):
    from analytics import research_logs

    monkeypatch.setattr(
        research_logs,
        "export_turns",
        lambda **kw: [
            {
                "ts": "2026-09-11T08:03:15",
                "session_id": "s-1",
                "role": "student",
                "content": "hello",
                "framework_id": "esru",
            }
        ],
    )
    resp = _client(RESEARCHER).get("/api/research/logs/export?format=csv&framework=esru")
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    assert "attachment" in resp.headers["content-disposition"]
    assert "hello" in resp.text
    assert "session_id" in resp.text.splitlines()[0]


def test_export_jsonl_is_one_object_per_line(monkeypatch):
    from analytics import research_logs

    monkeypatch.setattr(
        research_logs,
        "export_turns",
        lambda **kw: [{"session_id": "s-1", "content": "a"}, {"session_id": "s-2", "content": "b"}],
    )
    resp = _client(RESEARCHER).get("/api/research/logs/export?format=jsonl")
    assert resp.status_code == 200
    lines = [ln for ln in resp.text.splitlines() if ln.strip()]
    assert len(lines) == 2


def test_export_rejects_an_unknown_format():
    assert _client(RESEARCHER).get("/api/research/logs/export?format=xlsx").status_code == 422
