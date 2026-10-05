"""Researcher reviews of a rubric run (1.1.148 M4) — append-only, researcher-only."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import User, get_current_user
from db import firestore as fs_module
from db import rubric_reviews as rr
from db.firestore import get_document, set_document
from protocols.rubric_review_routes import router

RUN_ID = "s-1__fidelity:toulmin__fidelity-r3_fwyaml"

RESEARCHER = User(uid="r-1", email="r@ku.dk", domain="ku.dk", is_teacher=True, is_researcher=True)
TEACHER = User(uid="t-1", email="t@ku.dk", domain="ku.dk", is_teacher=True)


def _run(band: str = "partial", evidence: list | None = None) -> dict:
    return {
        "run_id": RUN_ID,
        "rubric_id": "fidelity:toulmin",
        "rubric_version": "fidelity-r3+fwyaml",
        "session_id": "s-1",
        "group_id": "woody-beetle-71",
        "profile": {
            "overallBand": "partial",
            "summary": "s",
            "drift": [],
            "scoredAt": "2026-10-05T09:47:00+00:00",
            "constructs": {
                "data": {
                    "band": band,
                    "rationale": "Asked for the measurements.",
                    "evidence": evidence if evidence is not None else [{"turn": 98, "quote": "skarp observation"}],
                    "moves": [],
                },
                "warrant": {"band": "absent", "rationale": "", "evidence": [], "moves": []},
            },
        },
    }


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    set_document("rubric_runs", RUN_ID, _run())
    yield
    fs_module._reset_client_for_testing()


def _review(**over):
    kw = {
        "construct_key": "data",
        "band": "strong",
        "evidence": [98, 106],
        "reason": "The tutor asked for the bounce heights twice.",
        "reviewer_uid": "r-1",
        "reviewer_email": "r@ku.dk",
    }
    kw.update(over)
    return rr.create_review(RUN_ID, **kw)


# ── the store ─────────────────────────────────────────────────────────────────


def test_a_review_is_a_new_document_and_snapshots_the_judge():
    a = _review()
    b = _review(band="partial", reason="On reflection only one data request.", supersedes=a["review_id"])
    assert a["review_id"] != b["review_id"]
    assert get_document("rubric_reviews", a["review_id"])["band"] == "strong"  # the first is untouched
    assert a["judged"]["band"] == "partial"
    assert a["judged"]["evidence"] == [{"turn": 98, "quote": "skarp observation"}]
    assert a["judged"]["rationale"] == "Asked for the measurements."
    assert [r["review_id"] for r in rr.list_reviews(RUN_ID)] == [a["review_id"], b["review_id"]]
    # The judge's record is not touched by a review.
    assert get_document("rubric_runs", RUN_ID)["profile"]["constructs"]["data"]["band"] == "partial"


def test_the_store_has_no_way_to_edit_or_delete_a_review():
    public = set(rr.__all__)
    assert not {n for n in public if n.startswith(("update", "delete", "edit", "remove", "set_"))}


@pytest.mark.parametrize(
    ("over", "message"),
    [
        ({"band": "excellent"}, "band must be one of"),
        ({"reason": "too short"}, "at least 10"),
        ({"construct_key": "rebuttal"}, "no construct"),
        ({"supersedes": "nope"}, "supersedes"),
    ],
)
def test_invalid_reviews_are_refused(over, message):
    with pytest.raises(rr.ReviewError, match=message):
        _review(**over)


def test_a_review_of_a_missing_run_is_refused():
    with pytest.raises(rr.ReviewError, match="no such run"):
        rr.create_review(
            "nope",
            construct_key="data",
            band="strong",
            evidence=[],
            reason="a long enough reason",
            reviewer_uid="r",
            reviewer_email="",
        )


def test_effective_band_is_the_latest_review_else_the_judges():
    eff = rr.effective_bands(_run(), [])
    assert eff["data"] == {"band": "partial", "source": "judge", "judgedBand": "partial"}
    first = _review(band="strong")
    second = _review(band="absent", reason="Re-read: no data was asked for.", supersedes=first["review_id"])
    eff = rr.effective_bands(_run(), rr.list_reviews(RUN_ID))
    assert eff["data"]["band"] == "absent" and eff["data"]["source"] == "review"
    assert eff["data"]["reviewId"] == second["review_id"]
    assert eff["data"]["judgedBand"] == "partial"  # both always available
    assert eff["data"]["reviewedAgainstEarlier"] is False
    assert eff["warrant"]["source"] == "judge"


def test_a_rescore_after_review_is_flagged_as_reviewed_against_an_earlier_judgement():
    _review()
    # The judge re-scores the same run id (the session grew): different evidence now.
    set_document("rubric_runs", RUN_ID, _run(band="partial", evidence=[{"turn": 50}]))
    eff = rr.effective_bands(get_document("rubric_runs", RUN_ID), rr.list_reviews(RUN_ID))
    assert eff["data"]["reviewedAgainstEarlier"] is True


# ── the routes: researcher-only ──────────────────────────────────────────────


def _client(user: User | None) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


BODY = {"constructKey": "data", "band": "strong", "evidence": [98], "reason": "The tutor asked for data twice."}


def test_a_researcher_posts_and_lists_reviews():
    c = _client(RESEARCHER)
    resp = c.post(f"/api/research/rubric-runs/{RUN_ID}/reviews", json=BODY)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["review"]["reviewer_uid"] == "r-1"  # from the token, never the body
    assert body["effective"]["data"]["band"] == "strong"
    listed = c.get(f"/api/research/rubric-runs/{RUN_ID}/reviews").json()
    assert len(listed["reviews"]) == 1
    assert c.post(f"/api/research/rubric-runs/{RUN_ID}/reviews", json={**BODY, "reason": "short"}).status_code == 422
    assert c.post("/api/research/rubric-runs/nope/reviews", json=BODY).status_code == 404


def test_there_is_no_route_that_edits_or_deletes_a_review():
    methods = {m for r in router.routes for m in getattr(r, "methods", set())}
    assert methods <= {"GET", "POST", "HEAD"}


def test_a_teacher_is_refused_every_route():
    c = _client(TEACHER)
    assert c.get(f"/api/research/rubric-runs/{RUN_ID}/reviews").status_code == 403
    assert c.post(f"/api/research/rubric-runs/{RUN_ID}/reviews", json=BODY).status_code == 403
    assert c.get("/api/research/sessions/s-1/fidelity-runs").status_code == 403
    assert rr.list_reviews(RUN_ID) == []


def test_a_real_group_token_through_the_real_dispatcher_is_refused():
    """No dependency override: a REAL minted student token goes through the real
    ``auth`` dispatcher, is accepted as a valid student, and is refused by the
    researcher gate — before any read or write."""
    from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group

    AnonymousGroupAuth.reset_for_tests()
    try:
        record = create_group(title="T3 class", skill_ids=["concept-dialogue"], creator_uid="t-1")
        token = join_group(record.group_id, client_ip="203.0.113.7").token
        c = _client(None)
        h = {"Authorization": f"Bearer {token}"}
        for resp in (
            c.get(f"/api/research/rubric-runs/{RUN_ID}/reviews", headers=h),
            c.post(f"/api/research/rubric-runs/{RUN_ID}/reviews", json=BODY, headers=h),
            c.get("/api/research/sessions/s-1/fidelity-runs", headers=h),
        ):
            assert resp.status_code == 403, resp.text  # a valid student, refused by role
        assert rr.list_reviews(RUN_ID) == []
    finally:
        AnonymousGroupAuth.reset_for_tests()
