"""Assessment transparency + researcher review routes (1.1.148 M4/M2).

RESEARCHER-ONLY. Fidelity bands, citations and reviews are R1-quarantined from
teachers (fit is not quality, 1.1.65 R1), and a student has no business here.

  GET  /api/research/sessions/{session_id}/fidelity-runs
       Every judgement of one session — the run store's one-per-version rows
       and the BigQuery mirror's full history — so a researcher can see that a
       session was judged more than once and compare the runs (M0: one session
       was judged three times in a minute; only the last was visible).
  GET  /api/research/rubric-runs/{run_id}/reviews
       The reviews of one run, oldest first, with the effective band per
       construct (latest review, else the judge's — both shown).
  POST /api/research/rubric-runs/{run_id}/reviews
       Record a correction. CREATE-ONLY: there is no route that edits or
       deletes a review, by design — a change of mind is another review that
       ``supersedes`` the first.

Auth goes through the ``auth`` dispatcher (never ``auth.firebase_auth`` — the
footgun table), then ``assert_researcher``: a teacher and an anonymous-group
student alike are refused with 403 before any read happens.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field

from auth import User, get_current_user
from auth.guards import assert_researcher

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/research", tags=["research-reviews"])


class ReviewBody(BaseModel):
    """One correction. ``evidence`` is the turn ids the reviewer rests it on
    (the transcript's ``#N``); ``supersedes`` names an earlier review of the
    same run and construct that this one replaces."""

    construct_key: str = Field(alias="constructKey", min_length=1, max_length=80)
    band: str = Field(min_length=1, max_length=16)
    evidence: list[int] = Field(default_factory=list, max_length=50)
    reason: str = Field(min_length=1, max_length=4000)
    supersedes: str | None = Field(default=None, max_length=64)

    model_config = ConfigDict(populate_by_name=True)


@router.get("/sessions/{session_id}/fidelity-runs")
async def list_fidelity_runs(
    session_id: str = Path(..., min_length=1, max_length=128),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    assert_researcher(user)
    from analytics.framework_fidelity import fidelity_run_history
    from reports.session_summary import resolve_session_summary

    try:
        # The conversation the citations resolve against. Already off the loop
        # inside (its BigQuery reads go through asyncio.to_thread).
        summary = await resolve_session_summary(session_id)
    except Exception as exc:  # the history still renders, with unresolved ids
        log.warning("fidelity-runs: summary unreadable for session=%s: %s", session_id, exc)
        summary = None
    conversation = summary.conversation if summary is not None else None
    # Firestore + BigQuery, synchronous — a worker thread (1.1.131).
    return await asyncio.to_thread(fidelity_run_history, session_id, conversation)


def _reviews_payload(run_id: str) -> dict[str, Any]:
    from analytics.rubric_runs import _COLLECTION as RUNS
    from db.firestore import get_document
    from db.rubric_reviews import effective_bands, list_reviews

    run = get_document(RUNS, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="no such run")
    reviews = list_reviews(run_id)
    return {"runId": run_id, "reviews": reviews, "effective": effective_bands(run, reviews)}


@router.get("/rubric-runs/{run_id}/reviews")
async def get_reviews(
    run_id: str = Path(..., min_length=1, max_length=512),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    assert_researcher(user)
    return await asyncio.to_thread(_reviews_payload, run_id)


@router.post("/rubric-runs/{run_id}/reviews", status_code=201)
async def post_review(
    body: ReviewBody,
    run_id: str = Path(..., min_length=1, max_length=512),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    assert_researcher(user)
    from db.rubric_reviews import ReviewError, create_review

    def _create() -> dict[str, Any]:
        return create_review(
            run_id,
            construct_key=body.construct_key,
            band=body.band,
            evidence=body.evidence,
            reason=body.reason,
            reviewer_uid=user.uid,
            reviewer_email=user.email or "",
            supersedes=body.supersedes,
        )

    try:
        review = await asyncio.to_thread(_create)
    except ReviewError as exc:
        status = 404 if str(exc) == "no such run" else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    payload = await asyncio.to_thread(_reviews_payload, run_id)
    return {"review": review, **payload}
