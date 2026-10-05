"""A cited turn is the turn the researcher reads (1.1.148) — both ends, one store.

The bug this pins shipped with green tests on each half: the fidelity judge
cited 0-based POSITIONS in the report's conversation list, while the transcript
beside it labels turns by the emitter's ADK event index. In any session with
tool events between messages the two diverge — on prod (2026-10-05) a cited
"43" was transcript #98. The judge's unit tests numbered turns one way; the
transcript's tests numbered them the other; nothing held them against each
other.

So this test drives the REAL chain end to end against ONE store:

  ADK events (with tool events interleaved)
    → the real chat-log emitter (``_emit_new_turns``) → the rows BigQuery holds
    → the group report route (summary → judge → researcher payload)
    AND the timeline route the transcript renders from, over the same rows.

The judge is stubbed to cite a real ``turn_index``; the assertion is that the
citation and the transcript resolve that id to the SAME message. Then a review
is posted and the report re-read: the judge's band is unchanged, the review is
there beside it.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import User, get_current_user
from db import firestore as fs_module
from db.firestore import get_document, set_document

SESSION = "sess-bounce-1"
GROUP = "woody-beetle-71"
RESEARCHER = User(uid="r-1", email="r@ku.dk", domain="ku.dk", is_teacher=True, is_researcher=True)
TEACHER = User(uid="t-owner", email="owner@ku.dk", domain="ku.dk", is_teacher=True)

#: (author, text) — None text = a tool event (function call / response), which
#: takes an ADK event index but is no message.
EVENTS = [
    ("user", "Hvorfor hopper bolden lavere hver gang?"),  # 0
    ("agent", "Godt spørgsmål. Hvad har I målt indtil nu?"),  # 1
    ("agent", None),  # 2  sim tool call
    ("agent", None),  # 3  sim tool response
    ("user", "Første hop 80 cm, andet 60 cm."),  # 4
    ("agent", None),  # 5  record_assessment
    ("agent", "Det er en skarp observation. Hvad siger de to tal om energien?"),  # 6
    ("user", "At noget af den forsvinder?"),  # 7
    ("agent", None),  # 8
    ("agent", None),  # 9
    ("agent", "Hvor tror I den bliver af? Brug jeres målinger som belæg."),  # 10
    ("user", "Varme måske, når den rammer gulvet."),  # 11
    ("agent", "Hvordan kunne I teste det med simuleringen?"),  # 12
]

#: The judge cites turn #6 — the third message, POSITION 2. Under the old
#: numbering "2" was cited and the transcript's #2 does not exist (a tool event).
CITED = 6


def _adk_event(i: int, author: str, text: str | None):
    ev = MagicMock()
    ev.author = author
    ev.timestamp = 1_790_000_000.0 + i
    ev.invocation_id = "inv-1"
    part = MagicMock()
    part.text = text
    ev.content = MagicMock()
    ev.content.parts = [part]
    return ev


def _emitted_rows() -> list[dict]:
    """Run the REAL emitter over the event list; return what BigQuery would hold."""
    from adk.callbacks.session import _emit_new_turns

    session = MagicMock()
    session.events = [_adk_event(i, a, t) for i, (a, t) in enumerate(EVENTS)]
    ctx = MagicMock()
    ctx.invocation_id = "inv-1"
    teaching = SimpleNamespace(
        tutor_id="sofie-esru",
        tutor_version=1,
        framework_id="esru",
        persona_id=None,
        class_id=None,
        activity_id="act-bounce",
        interaction_style=None,
        source="class",
    )
    rows: list[dict] = []
    t0 = datetime(2026, 10, 5, 9, 40, tzinfo=UTC)

    def _capture(**kw):
        rows.append({**kw, "ts": t0 + timedelta(seconds=len(rows))})

    with patch("observability.chat_log.emit_chat_turn", side_effect=_capture):
        _emit_new_turns(session, SESSION, "anon-woodybeetle71-1", "act-bounce", ctx, group_id=GROUP, teaching=teaching)
    return rows


def _fake_bigquery(rows: list[dict]):
    """One store, answering every reader the two routes make."""

    def _row(r: dict) -> dict:
        return {
            "ts": r["ts"],
            "group_id": r["group_id"],
            "session_id": r["session_id"],
            "skill_id": r["skill_id"],
            "role": r["role"],
            "content": r["content"],
            "turn_index": r["turn_index"],
            "framework_id": r.get("framework_id"),
            "tutor_id": r.get("tutor_id"),
            "tutor_version": r.get("tutor_version"),
            "revision": None,
            "model": r.get("model"),
            "latency_ms": r.get("latency_ms"),
            "class_id": None,
            "activity_id": None,
            "is_synthetic": False,
        }

    def run_query(sql: str, params: dict | None = None):
        if "last_ts" in sql:
            return [{"session_id": SESSION, "last_ts": rows[-1]["ts"]}]
        if "aipla_workbench_event" in sql or "aipla_rubric_run" in sql:
            return []
        if "aipla_chat_turn" in sql:
            return [_row(r) for r in sorted(rows, key=lambda r: r["turn_index"])]
        return []

    return run_query


def _judge():
    from analytics import framework_fidelity as ff
    from frameworks.loader import load_framework

    _, keys = ff.criteria_block(load_framework("esru"))
    constructs = {k: {"band": "absent", "rationale": "", "moves": [], "evidence": []} for k in keys}
    constructs[keys[0]] = {
        "band": "strong",
        "rationale": "Drew out the group's own measurements before explaining.",
        "moves": [ff.move_id(keys[0], 1)],
        "evidence": [
            {"turn": CITED, "quote": "Hvad siger de to tal om energien?"},
            {"turn": 2, "quote": "a tool event is not a turn"},
        ],
    }
    payload = {
        "constructs": constructs,
        "overall": {"band": "partial", "summary": "The tutor elicited.", "drift": [f"#{CITED}: fine"]},
    }
    return keys[0], AsyncMock(return_value=json.dumps(payload))


def _client(user: User) -> TestClient:
    from protocols.reports_routes import router as reports_router
    from protocols.research_logs_routes import router as logs_router
    from protocols.rubric_review_routes import router as review_router

    app = FastAPI()
    for r in (reports_router, logs_router, review_router):
        app.include_router(r)
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    from db.classes import create_class
    from db.models.class_ import Class

    cls = Class.create_for_teacher(owner_uid=TEACHER.uid, name="Fysik 1a")
    create_class(cls)
    set_document("anon_groups", GROUP, {"groupId": GROUP, "classId": cls.class_id})
    yield
    fs_module._reset_client_for_testing()


def test_a_cited_turn_is_the_same_message_in_the_report_and_the_transcript():
    rows = _emitted_rows()
    # The precondition that made the old numbering wrong: ids are sparse.
    assert [r["turn_index"] for r in rows] == [0, 1, 4, 6, 7, 10, 11, 12]
    key, judge = _judge()
    bq = _fake_bigquery(rows)

    with (
        patch("db.bigquery.run_query", side_effect=bq),
        patch("analytics.research_logs.run_query", side_effect=bq),
        patch("analytics.session_rubric._call_judge_model", new=judge),
        patch("protocols.reports_routes.resolve_narrative", new=AsyncMock()),
    ):
        c = _client(RESEARCHER)
        report = c.get(f"/api/reports/groups/{GROUP}")
        assert report.status_code == 200, report.text
        timeline = c.get(f"/api/research/logs/groups/{GROUP}/sessions/{SESSION}/timeline")
        assert timeline.status_code == 200, timeline.text

        fid = report.json()["fidelity"]
        assert fid["idScheme"] == "turn_index"
        cited = fid["constructs"][key]["evidence"]
        assert [e["transcriptTurn"] for e in cited] == [CITED]
        # The tool event's index was cited too — it is no turn, so it is rejected, never a link.
        assert [r["turn"] for r in fid["constructs"][key]["rejectedEvidence"]] == [2]

        transcript = {i["turn_index"]: i["content"] for i in timeline.json()["items"] if i["kind"] == "turn"}
        said = transcript[cited[0]["transcriptTurn"]]
        assert said.startswith(cited[0]["snippet"].rstrip("…"))
        assert cited[0]["quote"] in said and cited[0]["verified"] is True
        assert cited[0]["role"] == "tutor"
        # The criteria the judge was given ride along, with move ids.
        assert fid["criteria"][key]["moves"][0]["id"] == f"{key}.1"

        # A researcher corrects the band. The judge's record is untouched.
        run_id = fid["runId"]
        posted = c.post(
            f"/api/research/rubric-runs/{run_id}/reviews",
            json={"constructKey": key, "band": "partial", "evidence": [CITED], "reason": "Elicited once, then told."},
        )
        assert posted.status_code == 201, posted.text

        again = c.get(f"/api/reports/groups/{GROUP}").json()["fidelity"]
        assert again["constructs"][key]["band"] == "strong"  # the judge's, unchanged
        assert get_document("rubric_runs", run_id)["profile"]["constructs"][key]["band"] == "strong"
        reviews = c.get(f"/api/research/rubric-runs/{run_id}/reviews").json()
        assert [r["band"] for r in reviews["reviews"]] == ["partial"]
        assert reviews["effective"][key] == {
            "band": "partial",
            "source": "review",
            "reviewId": reviews["reviews"][0]["review_id"],
            "judgedBand": "strong",
            "reviewedAgainstEarlier": False,
        }
        assert judge.await_count == 1  # the re-read was served from the run store


def test_a_teacher_gets_no_bands_quotes_citations_or_reviews():
    rows = _emitted_rows()
    _, judge = _judge()
    bq = _fake_bigquery(rows)
    with (
        patch("db.bigquery.run_query", side_effect=bq),
        patch("analytics.research_logs.run_query", side_effect=bq),
        patch("analytics.session_rubric._call_judge_model", new=judge),
        patch("protocols.reports_routes.resolve_narrative", new=AsyncMock()),
    ):
        c = _client(TEACHER)
        fid = c.get(f"/api/reports/groups/{GROUP}").json()["fidelity"]
        for leaked in ("constructs", "overallBand", "criteria", "runId", "idScheme"):
            assert leaked not in fid
        assert "quote" not in json.dumps(fid)
        assert c.get(f"/api/research/sessions/{SESSION}/fidelity-runs").status_code == 403
