"""1.1.139 M1 — the class lesson roll-up (pure parts + the cost guards).

BigQuery, Firestore and the model are all mocked.
"""

from __future__ import annotations

import asyncio
import threading
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from analytics.framework_fidelity import FidelityResult
from insights import lessons
from reports.narrative import CONCEPTS_VERSION


def _row(sid, group, *, activity="act-1", start="2026-10-20T08:00:00+00:00", fw="esru", turns=10):
    return {
        "sessionId": sid,
        "groupCode": group,
        "skillId": "skill-x",
        "activityId": activity,
        "frameworkId": fw,
        "startedAt": datetime.fromisoformat(start),
        "lastAt": datetime.fromisoformat(start),
        "turns": turns,
    }


def _idx(text="**Narrative** x\n\n**Next time** Work on frequency.", concepts=None, version=CONCEPTS_VERSION):
    return SimpleNamespace(
        summary_text=text, concepts=concepts, concepts_version=version if concepts is not None else None
    )


def _fid(sid, *, abstained=False, reason="", band="partial", drift=(), summary="Asked before telling."):
    return FidelityResult(
        sessionId=sid,
        frameworkId="esru",
        frameworkLabel="ESRU",
        abstained=abstained,
        abstainReason=reason,
        summary="" if abstained else summary,
        drift=list(drift),
        overallBand=None if abstained else band,
        constructs={} if abstained else {"elicit": {"band": band}},
    )


# --- dates and grouping --------------------------------------------------------


def test_lesson_date_is_the_copenhagen_day() -> None:
    # 23:30 UTC on the 19th is 01:30 on the 20th in Copenhagen (CEST).
    assert lessons.lesson_date(datetime(2026, 10, 19, 23, 30, tzinfo=UTC)) == "2026-10-20"


def test_lessons_are_activity_and_date_with_skill_fallback() -> None:
    rows = [_row("s1", "g1"), _row("s2", "g2"), _row("s3", "g1", activity=None, start="2026-10-21T08:00:00+00:00")]
    grouped = lessons.group_into_lessons(rows)
    assert set(grouped) == {("act-1", "2026-10-20"), ("skill-x", "2026-10-21")}


def test_list_lessons_newest_first(monkeypatch) -> None:
    monkeypatch.setattr(lessons, "_class_codes", lambda cid: ["g1", "g2"])
    monkeypatch.setattr(
        lessons,
        "class_sessions",
        lambda codes, since: [_row("s1", "g1"), _row("s2", "g2"), _row("s3", "g1", start="2026-10-22T08:00:00+00:00")],
    )
    monkeypatch.setattr(lessons, "activity_title", lambda key: "Bølger")
    out = lessons.list_lessons("c1")
    assert [(lesson["date"], lesson["groups"]) for lesson in out["lessons"]] == [("2026-10-22", 1), ("2026-10-20", 2)]
    assert out["lessons"][0]["activityTitle"] == "Bølger"


def test_next_time_line_parses_heading_or_following_line() -> None:
    assert lessons.next_time_line("**Next time** (one sentence): Revisit amplitude.") == "Revisit amplitude."
    assert lessons.next_time_line("**Next time**\n\n- Try the energy sim.") == "Try the energy sim."
    assert lessons.next_time_line("no heading") is None


# --- concepts --------------------------------------------------------------------


def test_concepts_count_groups_and_sort_most_struggled_first() -> None:
    out = lessons.roll_up_concepts(
        {
            "g1": [{"key": "amplitude", "label": "Amplitude", "status": "discussed"}],
            "g2": [
                {"key": "amplitude", "label": "Amplitude", "status": "struggled"},
                {"key": "frekvens", "label": "Frekvens", "status": "struggled"},
            ],
            "g3": [{"key": "frekvens", "label": "Frekvens", "status": "struggled"}],
        },
        {},
        set(),
    )
    assert [c["key"] for c in out] == ["frekvens", "amplitude"]
    amp = out[1]
    assert amp["counts"] == {"discussed": 1, "struggled": 1, "demonstrated": 0}
    assert [g["groupCode"] for g in amp["groups"]] == ["g1", "g2"]


def test_mapped_demonstrated_comes_only_from_concept_progress() -> None:
    # The narrative stamped "demonstrated" at summary time; the tutor's record
    # (the 1.1.121 source) now says partial for g1 and demonstrated for g2.
    out = lessons.roll_up_concepts(
        {"g1": [{"key": "amplitude", "label": "Amplitude", "nodeId": "n1", "status": "demonstrated"}], "g2": []},
        {
            "g1": {
                "amplitude": {"status": "partial", "nodeId": "n1", "label": "Amplitude", "evidence": "explained it"}
            },
            "g2": {
                "amplitude": {"status": "demonstrated", "nodeId": "n1", "label": "Amplitude", "evidence": "derived it"}
            },
        },
        {"amplitude"},
    )
    (amp,) = out
    assert amp["counts"]["demonstrated"] == 1
    assert {g["groupCode"]: g["status"] for g in amp["groups"]} == {"g1": "discussed", "g2": "demonstrated"}
    assert next(g for g in amp["groups"] if g["groupCode"] == "g2")["evidence"] == "derived it"
    assert amp["mapped"] is True


def test_not_yet_progress_is_not_a_reading_of_the_lesson() -> None:
    out = lessons.roll_up_concepts(
        {}, {"g1": {"amplitude": {"status": "not_yet", "label": "Amplitude"}}}, {"amplitude"}
    )
    assert out == []


def test_mapped_counts_equal_the_class_graph_for_the_activity(monkeypatch) -> None:
    """Acceptance: for an activity with a concept map, the lesson's demonstrated
    count IS the 1.1.121 rollup's count — one source, not two."""
    from db import class_concept_rollup as rollup

    docs = [
        {
            "groupId": "g1",
            "activityId": "act-1",
            "nodeStates": {
                "n1": {"evidence": [{"kind": "observed", "status": "demonstrated", "summary": "s", "at": "1"}]}
            },
        },
        {
            "groupId": "g2",
            "activityId": "act-1",
            "nodeStates": {
                "n1": {"evidence": [{"kind": "checkpoint", "status": "partial", "summary": "p", "at": "1"}]}
            },
        },
    ]
    monkeypatch.setattr("db.concept_progress.docs_for_class", lambda cid: docs)
    monkeypatch.setattr(rollup, "docs_for_class", lambda cid: docs)
    monkeypatch.setattr(rollup, "_node_labels", lambda aid: {"n1": "Amplitude"})
    monkeypatch.setattr(rollup, "_label_edges", lambda aid: [])
    graph = rollup.class_concept_distribution("c1")
    progress = lessons._progress_for("c1", "act-1", {"g1", "g2"}, {"n1": "Amplitude"})
    lesson = lessons.roll_up_concepts({}, progress, {"amplitude"})
    assert lesson[0]["counts"]["demonstrated"] == graph["concepts"][0]["counts"]["demonstrated"] == 1


# --- approach ----------------------------------------------------------------------


def test_approach_coverage_is_honest_and_teacher_gets_no_bands() -> None:
    per_group = {
        "g1": {"frameworkId": "esru", "fidelity": _fid("s1")},
        "g2": {
            "frameworkId": "esru",
            "fidelity": _fid("s2", abstained=True, reason="too little dialogue to assess (1)"),
        },
        "g3": {"frameworkId": "esru", "fidelity": None},
    }
    teacher = lessons.roll_up_approach(per_group, researcher=False)
    assert teacher["coverage"] == {
        "groups": 3,
        "assessed": 1,
        "tooShort": 1,
        "abstained": 0,
        "notJudged": 1,
        "otherApproach": 0,
    }
    assert "bands" not in teacher and "overallBands" not in teacher
    researcher = lessons.roll_up_approach(per_group, researcher=True)
    assert researcher["bands"] == {"elicit": {"partial": 1}}


def test_no_framework_says_so() -> None:
    out = lessons.roll_up_approach({"g1": {"frameworkId": None, "fidelity": None}}, researcher=False)
    assert out["state"] == "no_framework"


def test_outlier_flags() -> None:
    groups = [
        {"groupCode": "g1", "summarised": True, "struggledCount": 0},
        {"groupCode": "g2", "summarised": True, "struggledCount": 0},
        {"groupCode": "g3", "summarised": True, "struggledCount": 3, "_band": "absent"},
    ]
    lessons.flag_outliers(groups)
    assert [g["flags"] for g in groups] == [[], [], ["struggle", "drift"]]


# --- the whole lesson, no model call ------------------------------------------------


@pytest.fixture()
def lesson_world(monkeypatch):
    monkeypatch.setattr(lessons, "_class_codes", lambda cid: ["g1", "g2", "g3"])
    monkeypatch.setattr(
        lessons,
        "class_sessions",
        lambda codes, since: [_row("s1", "g1"), _row("s2", "g2"), _row("s3", "g3"), _row("sX", "g1", activity="act-2")],
    )
    monkeypatch.setattr(lessons, "activity_title", lambda key: "Bølger")
    monkeypatch.setattr("db.activities.get_activity", lambda *a, **k: None)
    indexes = {
        "s1": _idx(concepts=[{"key": "amplitude", "label": "Amplitude", "status": "struggled"}]),
        "s2": _idx(concepts=None),  # summarised before M0
        "s3": None,  # no index row
    }
    monkeypatch.setattr(lessons, "_session_index", lambda sid: indexes.get(sid))
    monkeypatch.setattr(lessons, "_fidelity", lambda sid, fw: _fid(sid) if sid == "s1" else None)
    return indexes


def test_lesson_detail_makes_no_model_call(lesson_world) -> None:
    with patch("reports.narrative._call_gemini", new=AsyncMock(side_effect=AssertionError("model called"))):
        d = lessons.lesson_detail("c1", "act-1", "2026-10-20")
    assert d["coverage"]["groups"] == 3
    assert d["coverage"]["summarised"] == 2
    assert d["coverage"]["conceptsExtracted"] == 1
    assert d["pendingSessionIds"] == ["s2"]  # s3 has no index row: counted, never queued
    assert d["coverage"]["unsummarisable"] == 1
    assert d["concepts"][0]["key"] == "amplitude"
    assert d["nextTime"]["groups"][0]["text"] == "Work on frequency."
    assert d["approach"]["coverage"]["assessed"] == 1


def test_lesson_detail_none_for_a_day_with_no_sessions(lesson_world) -> None:
    assert lessons.lesson_detail("c1", "act-1", "2026-01-01") is None
    assert lessons.lesson_detail("c1", "act-1", "not-a-date") is None


# --- the one synthesis call ----------------------------------------------------------


def _detail():
    return {
        "classId": "c1",
        "activityId": "act-1",
        "date": "2026-10-20",
        "activityTitle": "Bølger",
        "approach": {"frameworkLabel": "ESRU", "groupSummaries": [{"summary": "s", "drift": []}]},
        "nextTime": {"groups": [{"groupCode": "g1", "text": "frequency"}]},
    }


async def test_synthesis_cached_only_never_calls_the_model(monkeypatch) -> None:
    monkeypatch.setattr("db.firestore.get_document", lambda c, d: None)
    with patch("reports.narrative._call_gemini", new=AsyncMock(side_effect=AssertionError("model called"))):
        assert await lessons.resolve_synthesis(_detail(), generate=False) is None


async def test_synthesis_generates_once_then_serves_the_cache(monkeypatch) -> None:
    store: dict = {}
    monkeypatch.setattr("db.firestore.get_document", lambda c, d: store.get(d))
    monkeypatch.setattr("db.firestore.set_document", lambda c, d, data: store.__setitem__(d, data))
    llm = AsyncMock(return_value='{"approach": "Mostly elicited first.", "nextTime": "Revisit frequency."}')
    with patch("reports.narrative._call_gemini", new=llm):
        first = await lessons.resolve_synthesis(_detail())
        second = await lessons.resolve_synthesis(_detail())
    assert first["nextTime"] == "Revisit frequency." and second["approach"] == "Mostly elicited first."
    llm.assert_awaited_once()


async def test_synthesis_skipped_with_nothing_to_synthesise() -> None:
    d = _detail()
    d["approach"]["groupSummaries"] = []
    d["nextTime"]["groups"] = []
    with patch("reports.narrative._call_gemini", new=AsyncMock(side_effect=AssertionError("model called"))):
        assert await lessons.resolve_synthesis(d) is None


async def test_concurrent_synthesis_shares_one_call(monkeypatch) -> None:
    monkeypatch.setattr("db.firestore.get_document", lambda c, d: None)
    monkeypatch.setattr("db.firestore.set_document", lambda c, d, data: None)
    calls = 0

    async def slow(prompt, *, schema=None):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return '{"approach": "a", "nextTime": "n"}'

    with patch("reports.narrative._call_gemini", new=slow):
        await asyncio.gather(*(lessons.resolve_synthesis(_detail()) for _ in range(4)))
    assert calls == 1


# --- the explicit summarise action ----------------------------------------------------


async def test_summarise_is_capped_and_concurrency_limited(monkeypatch) -> None:
    in_flight = peak = 0

    async def fake_summary(sid):
        return SimpleNamespace(session_id=sid)

    async def fake_narrative(summary, force=False):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.01)
        in_flight -= 1
        return "N"

    monkeypatch.setattr("reports.session_summary.resolve_session_summary", fake_summary)
    monkeypatch.setattr("reports.narrative.resolve_narrative", fake_narrative)
    out = await lessons.summarise_sessions([f"s{i}" for i in range(20)])
    assert out["requested"] == lessons.SUMMARISE_MAX_PER_REQUEST
    assert out["summarised"] == lessons.SUMMARISE_MAX_PER_REQUEST
    assert out["remaining"] == 20 - lessons.SUMMARISE_MAX_PER_REQUEST
    assert peak <= lessons.SUMMARISE_CONCURRENCY


# --- backfill plan ---------------------------------------------------------------------


def test_backfill_plan_skips_done_and_unindexed() -> None:
    from scripts.backfill_lesson_concepts import plan

    idx = {
        "s1": _idx(concepts=[{"key": "a"}]),
        "s2": _idx(concepts=None),
        "s3": None,
        "s4": _idx(concepts=[{"key": "a"}], version="concepts-v0"),
    }
    rows = [_row(s, "g1") for s in idx]
    todo, done, no_index = plan(rows, idx.get, version=CONCEPTS_VERSION, day="2026-10-20", redo=False)
    assert [r["sessionId"] for r in todo] == ["s2", "s4"]
    assert done == ["s1"] and no_index == ["s3"]
    assert plan(rows, idx.get, version=CONCEPTS_VERSION, day="2026-01-01", redo=False) == ([], [], [])


def test_off_loop_helper_runs_in_a_worker_thread(monkeypatch) -> None:
    """The route reaches lesson_detail through CACHE.aget_or_compute; pin that
    the compute runs off the loop thread (1.1.131)."""
    from insights.cache import CACHE, make_key

    CACHE.clear()
    seen: dict = {}

    def compute():
        seen["thread"] = threading.get_ident()
        return {"ok": True}

    async def go():
        seen["loop"] = threading.get_ident()
        return await CACHE.aget_or_compute(
            make_key(teacher_uid="t", surface="x", since=datetime(2000, 1, 1), until=datetime(2000, 1, 1)), compute
        )

    asyncio.run(go())
    assert seen["thread"] != seen["loop"]
    CACHE.clear()
