"""Researcher reviews of a rubric run — append-only (1.1.148 M4).

The run store (``rubric_runs``) is the JUDGE's record; this is the HUMAN's.
Kept apart on purpose: a run document is overwritten in place whenever the
session grows and is re-judged, so a correction written into it would be lost
on the next re-score — and would destroy the evidence it corrected.

One Firestore document per review at ``rubric_reviews/{auto-id}``, written
once and never updated or deleted — there is no function here that does either,
and no route. A researcher who changes their mind writes ANOTHER review, naming
the one it ``supersedes``. Every review carries a snapshot of what the judge
said (``judged``) at the moment it was written, so a later re-score that changes
the judgement shows the review was made against an earlier one.

The effective band for a run+construct is the latest review's, else the
judge's (:func:`effective_bands`); the UI always shows both. Same shape as
``concept_progress`` (append-only records, derived status, human precedence —
1.1.144), deliberately not the same store.

Mirrored to BigQuery as ``aipla_rubric_review`` (``observability.chat_log``)
so a review sits next to the run it reviewed in the analysis tables.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from db.firestore import get_document, query_documents, set_document

log = logging.getLogger(__name__)

COLLECTION = "rubric_reviews"

#: The row a review of the whole run (not one construct) carries.
OVERALL = "overall"

#: A correction must say why. Ten characters is "a reason", not a word.
MIN_REASON_CHARS = 10

BANDS = ("absent", "partial", "strong")


class ReviewError(ValueError):
    """A review that cannot be recorded, with the reason a caller can show."""


def _judged_snapshot(run: dict[str, Any], construct_key: str) -> dict[str, Any]:
    """What the judge said about ``construct_key`` in ``run``, right now.

    Carries the judge's provenance too (model, prompt and criteria version,
    framework): the run document is overwritten in place on a re-score, so the
    snapshot is the only record of WHICH judge the reviewer was correcting —
    and the calibration set (``analytics.calibration_set``) needs exactly that.
    """
    profile = run.get("profile") or {}
    provenance = {
        "scoredAt": profile.get("scoredAt"),
        "model": profile.get("model") or run.get("model") or None,
        "promptVersion": profile.get("promptVersion"),
        "criteriaVersion": profile.get("criteriaVersion"),
        "frameworkId": profile.get("frameworkId") or run.get("framework_id"),
    }
    if construct_key == OVERALL:
        return {
            "band": profile.get("overallBand"),
            "summary": profile.get("summary") or "",
            "drift": list(profile.get("drift") or []),
            **provenance,
        }
    c = (profile.get("constructs") or {}).get(construct_key) or {}
    return {
        "band": c.get("band"),
        "rationale": c.get("rationale") or "",
        "evidence": list(c.get("evidence") or []),
        "moves": list(c.get("moves") or []),
        **provenance,
    }


def create_review(
    run_id: str,
    *,
    construct_key: str,
    band: str,
    evidence: list[int],
    reason: str,
    reviewer_uid: str,
    reviewer_email: str,
    supersedes: str | None = None,
) -> dict[str, Any]:
    """Record one review. Create-only: a fresh id every call.

    Raises :class:`ReviewError` for a run that does not exist, a construct the
    run does not carry, a band outside :data:`BANDS`, a reason under
    :data:`MIN_REASON_CHARS`, or a ``supersedes`` that is not a review of the
    same run and construct.
    """
    from analytics.rubric_runs import _COLLECTION as RUNS

    run = get_document(RUNS, run_id)
    if not run:
        raise ReviewError("no such run")
    constructs = (run.get("profile") or {}).get("constructs") or {}
    if construct_key != OVERALL and construct_key not in constructs:
        raise ReviewError(f"this run has no construct {construct_key!r}")
    if band not in BANDS:
        raise ReviewError(f"band must be one of {', '.join(BANDS)}")
    reason = (reason or "").strip()
    if len(reason) < MIN_REASON_CHARS:
        raise ReviewError(f"a correction needs a reason of at least {MIN_REASON_CHARS} characters")
    if supersedes:
        prev = get_document(COLLECTION, supersedes)
        if not prev or prev.get("run_id") != run_id or prev.get("construct_key") != construct_key:
            raise ReviewError("supersedes must name an earlier review of the same run and construct")

    review_id = uuid.uuid4().hex
    row = {
        "review_id": review_id,
        "run_id": run_id,
        "rubric_id": run.get("rubric_id") or "",
        "rubric_version": run.get("rubric_version") or "",
        "session_id": run.get("session_id") or "",
        "group_id": run.get("group_id") or "",
        "construct_key": construct_key,
        "judged": _judged_snapshot(run, construct_key),
        "band": band,
        "evidence": sorted({int(e) for e in evidence}),
        "reason": reason,
        "reviewer_uid": reviewer_uid,
        "reviewer_email": reviewer_email,
        "supersedes": supersedes or None,
        "created_at": datetime.now(UTC).isoformat(),
    }
    set_document(COLLECTION, review_id, row)

    try:
        from observability.chat_log import emit_rubric_review

        emit_rubric_review(row)
    except Exception as exc:  # the mirror is best-effort; the Firestore row stands
        log.warning("rubric_reviews: BQ mirror failed for %s (suppressed): %s", review_id, exc)
    return row


def list_reviews(run_id: str) -> list[dict[str, Any]]:
    """Every review of one run, oldest first."""
    rows = query_documents(COLLECTION, filters=[("run_id", "==", run_id)]) or []
    rows = [{k: v for k, v in r.items() if k != "__id"} for r in rows]
    rows.sort(key=lambda r: r.get("created_at") or "")
    return rows


def effective_bands(run: dict[str, Any] | None, reviews: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Construct key (or ``overall``) → ``{band, source, reviewId?, judgedBand,
    reviewedAgainstEarlier}``. The latest review wins; else the judge's band.

    ``reviewedAgainstEarlier`` is True when the judge has re-scored since that
    review and now says something different from what the reviewer saw.
    """
    profile = (run or {}).get("profile") or {}
    constructs = profile.get("constructs") or {}
    out: dict[str, dict[str, Any]] = {}
    for key, c in constructs.items():
        out[key] = {"band": c.get("band"), "source": "judge", "judgedBand": c.get("band")}
    out[OVERALL] = {"band": profile.get("overallBand"), "source": "judge", "judgedBand": profile.get("overallBand")}
    latest: dict[str, dict[str, Any]] = {}
    for r in sorted(reviews, key=lambda r: r.get("created_at") or ""):
        latest[str(r.get("construct_key"))] = r
    for key, r in latest.items():
        judged_now = out.get(key, {}).get("judgedBand")
        snap = r.get("judged") or {}
        changed = (snap.get("band") != judged_now) or (
            key != OVERALL and snap.get("evidence") != list((constructs.get(key) or {}).get("evidence") or [])
        )
        out[key] = {
            "band": r.get("band"),
            "source": "review",
            "reviewId": r.get("review_id"),
            "judgedBand": judged_now,
            "reviewedAgainstEarlier": bool(changed),
        }
    return out


__all__ = [
    "BANDS",
    "COLLECTION",
    "MIN_REASON_CHARS",
    "OVERALL",
    "ReviewError",
    "create_review",
    "effective_bands",
    "list_reviews",
]
