"""Researcher corrections → a calibration set for the fidelity judge (1.1.148).

Decided by M on 2026-10-08 (open questions 3 and 4): corrections stay SHARED
among researchers and ANNOTATION-ONLY in effect — a review never changes a
stored judgement or the live judge — and they become a calibration set: the
labelled examples a later judge revision (BENCH-3) is measured against.

This module only READS. It turns the append-only ``rubric_reviews`` store into
one row per reviewed construct and computes how often researchers agree with
the AI, per construct and per framework. Nothing here writes to Firestore,
BigQuery or the judge; the prompt does not read it.

Which reviews count
    A review that a later review ``supersedes`` is that reviewer's changed mind,
    so it is dropped. Two researchers reviewing the same construct without
    superseding each other are two labels, and both are kept — shared
    adjudication is the point, and inter-rater agreement is computable from the
    rows (``reviewerUid``; uid only, as in the BigQuery mirror).

What "the AI band" is
    The judge's snapshot taken WHEN the review was written (``judged``), not the
    run document as it stands now: a run doc is overwritten in place when the
    session grows and is re-judged, so its current band may not be the one the
    researcher was correcting. Prompt and criteria version come from the
    review's ``rubric_version`` (``fidelity-r3+fw2`` → ``fidelity-r3``, ``2``),
    which is exact. The model is in the snapshot for reviews written since this
    module landed; older ones fall back to the run doc and say so
    (``modelSource``).

A review whose researcher band EQUALS the AI's is kept: a confirmation is as
much a calibration label as a correction, and without it the agreement rate is
undefined. ``agrees`` marks which is which.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime
from typing import Any

#: Bump when a row's shape changes, so a consumer can tell exports apart.
CALIBRATION_FORMAT = "aipla-calibration-r1"

_BAND_RANK = {"absent": 0, "partial": 1, "strong": 2}

#: The lens id a fidelity run carries is ``fidelity:<framework id>``.
_FIDELITY_PREFIX = "fidelity:"


def split_rubric_version(rubric_version: str | None) -> tuple[str | None, str | None]:
    """``fidelity-r3+fw2`` → (``fidelity-r3``, ``2``); ``fidelity-r2`` → (``fidelity-r2``, None)."""
    v = (rubric_version or "").strip()
    if not v:
        return None, None
    prompt, sep, fw = v.partition("+fw")
    return prompt or None, (fw or None) if sep else None


def framework_of(rubric_id: str | None) -> str | None:
    rid = rubric_id or ""
    return (rid[len(_FIDELITY_PREFIX) :] or None) if rid.startswith(_FIDELITY_PREFIX) else None


def _citations(evidence: Any) -> list[dict[str, Any]]:
    """The judge's citations as ``{turn, quote, verified}`` — r3 dicts or r2 bare ids."""
    out: list[dict[str, Any]] = []
    for it in evidence if isinstance(evidence, list) else []:
        if isinstance(it, dict):
            out.append({"turn": it.get("turn", it.get("id")), "quote": it.get("quote"), "verified": it.get("verified")})
        else:
            out.append({"turn": it, "quote": None, "verified": None})
    return out


def current_reviews(reviews: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop every review a later review supersedes; oldest first."""
    rows = list(reviews)
    superseded = {r.get("supersedes") for r in rows if r.get("supersedes")}
    kept = [r for r in rows if r.get("review_id") not in superseded]
    kept.sort(key=lambda r: r.get("created_at") or "")
    return kept


def _direction(ai: str | None, human: str | None) -> str:
    if ai not in _BAND_RANK or human not in _BAND_RANK:
        return "unknown"
    d = _BAND_RANK[human] - _BAND_RANK[ai]
    return "agree" if d == 0 else ("researcher_higher" if d > 0 else "researcher_lower")


def calibration_row(review: dict[str, Any], run: dict[str, Any] | None) -> dict[str, Any]:
    """One labelled example: what the judge said, what the researcher said, and why."""
    judged = review.get("judged") or {}
    prompt_v, criteria_v = split_rubric_version(review.get("rubric_version"))
    # The snapshot is exact for reviews written since 2026-10-08; fall back to it
    # for the version fields too, then to the run doc for the model only.
    prompt_v = prompt_v or judged.get("promptVersion")
    criteria_v = criteria_v or judged.get("criteriaVersion")
    model, model_source = judged.get("model"), "judged-snapshot"
    if not model and run:
        model = run.get("model") or (run.get("profile") or {}).get("model")
        model_source = "run-current" if model else None
    if not model:
        model_source = None
    ai_band = judged.get("band")
    human_band = review.get("band")
    direction = _direction(ai_band, human_band)
    framework = framework_of(review.get("rubric_id")) or judged.get("frameworkId") or (run or {}).get("framework_id")
    return {
        "format": CALIBRATION_FORMAT,
        "reviewId": review.get("review_id"),
        "runId": review.get("run_id"),
        "sessionId": review.get("session_id"),
        "frameworkId": framework,
        "construct": review.get("construct_key"),
        "aiBand": ai_band,
        "researcherBand": human_band,
        "agrees": direction == "agree",
        "direction": direction,
        "aiRationale": judged.get("rationale") or judged.get("summary") or "",
        "aiCitations": _citations(judged.get("evidence")),
        "aiMoves": list(judged.get("moves") or []),
        "researcherEvidence": list(review.get("evidence") or []),
        "researcherRationale": review.get("reason") or "",
        "rubricVersion": review.get("rubric_version") or None,
        "promptVersion": prompt_v,
        "criteriaVersion": criteria_v,
        "model": model or None,
        "modelSource": model_source,
        "judgedAt": judged.get("scoredAt"),
        "reviewedAt": review.get("created_at"),
        "reviewerUid": review.get("reviewer_uid"),
        "supersedes": review.get("supersedes") or None,
    }


def _cell() -> dict[str, Any]:
    return {"n": 0, "agree": 0, "researcherHigher": 0, "researcherLower": 0, "unknown": 0, "confusion": {}}


def _add(cell: dict[str, Any], row: dict[str, Any]) -> None:
    cell["n"] += 1
    key = {"agree": "agree", "researcher_higher": "researcherHigher", "researcher_lower": "researcherLower"}.get(
        row["direction"], "unknown"
    )
    cell[key] += 1
    pair = f"{row['aiBand'] or '?'}->{row['researcherBand'] or '?'}"
    cell["confusion"][pair] = cell["confusion"].get(pair, 0) + 1


def _finish(cell: dict[str, Any]) -> dict[str, Any]:
    comparable = cell["n"] - cell["unknown"]
    cell["agreement"] = round(cell["agree"] / comparable, 3) if comparable else None
    return cell


def agreement_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """How often researchers agree with the AI — overall, per framework, per construct.

    ``agreement`` is agree / (n - unknown); None when nothing is comparable,
    never 0 (an empty cell is not a judge that is always wrong).
    """
    overall = _cell()
    by_fw: dict[str, dict[str, Any]] = defaultdict(_cell)
    by_construct: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_cell))
    raters: dict[tuple[Any, Any], set[Any]] = defaultdict(set)
    for row in rows:
        fw = row.get("frameworkId") or "unknown"
        _add(overall, row)
        _add(by_fw[fw], row)
        _add(by_construct[fw][str(row.get("construct"))], row)
        raters[(row.get("runId"), row.get("construct"))].add(row.get("reviewerUid"))
    return {
        "overall": _finish(overall),
        "byFramework": {fw: _finish(c) for fw, c in sorted(by_fw.items())},
        "byConstruct": {fw: {k: _finish(c) for k, c in sorted(cs.items())} for fw, cs in sorted(by_construct.items())},
        "reviewers": len({row.get("reviewerUid") for row in rows if row.get("reviewerUid")}),
        # Constructs more than one researcher labelled — the inter-rater sample.
        "multiRated": sum(1 for uids in raters.values() if len(uids) > 1),
    }


def build_calibration_set(
    reviews: Iterable[dict[str, Any]],
    runs: Mapping[str, dict[str, Any] | None],
    *,
    framework_id: str | None = None,
) -> dict[str, Any]:
    """Rows + agreement stats. Pure: the caller supplies the reviews and runs."""
    rows = [calibration_row(r, runs.get(str(r.get("run_id")))) for r in current_reviews(reviews)]
    if framework_id:
        rows = [r for r in rows if r["frameworkId"] == framework_id]
    return {
        "format": CALIBRATION_FORMAT,
        "generatedAt": datetime.now(UTC).isoformat(),
        "frameworkId": framework_id,
        "rows": rows,
        "stats": agreement_stats(rows),
    }


ReadReviews = Callable[[], list[dict[str, Any]]]
ReadRun = Callable[[str], dict[str, Any] | None]


def _default_read_reviews() -> list[dict[str, Any]]:
    from db.firestore import query_documents
    from db.rubric_reviews import COLLECTION

    rows = query_documents(COLLECTION) or []
    return [{k: v for k, v in r.items() if k != "__id"} for r in rows]


def _default_read_run(run_id: str) -> dict[str, Any] | None:
    from analytics.rubric_runs import _COLLECTION
    from db.firestore import get_document

    return get_document(_COLLECTION, run_id)


def load_calibration_set(
    framework_id: str | None = None,
    *,
    read_reviews: ReadReviews | None = None,
    read_run: ReadRun | None = None,
) -> dict[str, Any]:
    """Read every review (and each reviewed run, for the model fallback) and build the set.

    Read-only. A read failure RAISES — it never becomes an empty set, which
    would read as "no researcher has corrected anything".
    """
    reviews = (read_reviews or _default_read_reviews)()
    reader = read_run or _default_read_run
    runs = {rid: reader(rid) for rid in sorted({str(r.get("run_id")) for r in reviews if r.get("run_id")})}
    return build_calibration_set(reviews, runs, framework_id=framework_id)


__all__ = [
    "CALIBRATION_FORMAT",
    "agreement_stats",
    "build_calibration_set",
    "calibration_row",
    "current_reviews",
    "framework_of",
    "load_calibration_set",
    "split_rubric_version",
]
