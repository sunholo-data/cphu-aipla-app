"""Session-report REST endpoints (teacher-facing).

Phase 2 (1.G-Ph2) scope:
  GET /api/reports/sessions/{session_id}   — direct lookup by session id
  GET /api/reports/groups/{group_code}     — most-recent session for an
                                              anonymous group

Both endpoints return a 404 when no session matches.

Who may read a report: the teacher who OWNS the group's class, or a researcher
(``role:researcher``, the same cross-class read bypass as
``analytics.auth.assert_can_read_class``). Everyone else — another teacher, a
visitor, an anonymous-group student holding a valid token — gets the same 404
as a missing report, so a group code cannot be probed for existence.

Until 2026-10-05 there was no such check: the module said "every authenticated
user can read every report — fine for LOCAL_MODE's single-teacher world", and
prod is not that world. A student's group token passed ``get_current_user`` and
could read any other group's transcript by code.

A researcher may also read a group whose class can no longer be resolved (its
``anon_groups`` record was deleted by Revoke — 1.1.146); that evidence must not
become unreachable. A teacher cannot: without a class there is no ownership to
prove.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from analytics.auth import assert_can_read_class
from analytics.framework_fidelity import resolve_fidelity
from auth import User, get_current_user
from config.models import analysis_model
from db.classes import get_class_for_group
from reports.narrative import resolve_narrative
from reports.session_summary import (
    SessionSummary,
    find_latest_session_for_group,
    find_latest_session_id_for_group_bq,
    resolve_session_summary,
    summarize_session_bq,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])

#: One message for "no such report" and "not yours", so a 404 says nothing about
#: whether the group or session exists.
_NOT_FOUND = "report not found"


def _can_read_group(user: User, group_code: str | None) -> bool:
    """True when ``user`` may read reports for ``group_code``. Synchronous
    Firestore reads — call through ``asyncio.to_thread``."""
    if not group_code:
        # No group (a teacher's own chat, not a student session): researcher only.
        return bool(getattr(user, "is_researcher", False))
    cls = get_class_for_group(group_code)
    if cls is None:
        return bool(getattr(user, "is_researcher", False))
    try:
        assert_can_read_class(user, cls.class_id)
    except PermissionError:
        return False
    return True


async def _assert_can_read_group(user: User, group_code: str | None) -> None:
    if not await asyncio.to_thread(_can_read_group, user, group_code):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)


def _report_labels(summary: SessionSummary) -> dict:
    """Human labels for the report header: which class this group belongs to
    (so the UI can link back to it) and the activity's display name rather than
    its raw UUID. All best-effort — a missing binding just yields nulls / the
    raw id, never an error."""
    from db.classes import get_class_for_group
    from db.firestore import get_document

    labels: dict = {"classId": None, "className": None, "activityName": summary.activity_id}
    try:
        cls = get_class_for_group(summary.group_code)
        if cls is not None:
            labels["classId"] = cls.class_id
            labels["className"] = cls.name
    except Exception as exc:
        log.warning("report labels: class lookup failed for group=%s: %s", summary.group_code, exc)
    try:
        if summary.activity_id:
            skill = get_document("skills", summary.activity_id) or {}
            name = skill.get("displayName") or skill.get("name")
            if name:
                labels["activityName"] = name
    except Exception as exc:
        log.warning("report labels: skill lookup failed for id=%s: %s", summary.activity_id, exc)
    return labels


def _report_inputs(summary: SessionSummary) -> dict:
    """ "What's included" for the report UI (1.1.36 A3): the sources the narrative was
    built from + the model + generation state, so the teacher knows what it's based on
    and why it took a moment. Best-effort; never raises."""
    generated_at = None
    try:
        from db.chat_sessions import get_session_index

        idx = get_session_index(summary.session_id)
        if idx is not None and idx.summary_generated_at is not None:
            generated_at = idx.summary_generated_at.isoformat()
    except Exception:  # best-effort metadata
        generated_at = None
    return {
        "chatTurns": summary.message_count,
        "audioMinutes": summary.voice_minutes,
        "audioSegments": summary.voice_segments,
        "simEvents": summary.sim_run_count,
        # The model that writes the narrative (reports.narrative) — BENCH-1.
        "model": analysis_model(),
        "generatedAt": generated_at,
        "state": "ready" if summary.narrative else "none",
    }


def _serialize(summary: SessionSummary, *, fidelity: dict | None = None) -> dict:
    data = summary.model_dump(by_alias=True, mode="json")
    data.update(_report_labels(summary))
    data["inputs"] = _report_inputs(summary)
    # 1.1.107 M5 — the "Teaching approach" section: how the ONE approach this
    # session ran under was used, and where it drifted. None = no read (the
    # page omits the section), never a broken page.
    data["fidelity"] = fidelity
    return data


async def _aserialize(summary: SessionSummary, *, fidelity: dict | None = None) -> dict:
    """``_serialize`` off the event loop. Its labels + inputs are three
    synchronous Firestore reads, on a route the teacher's live view polls every
    few seconds (1.1.131 M3)."""
    return await asyncio.to_thread(_serialize, summary, fidelity=fidelity)


async def _fidelity_for(summary: SessionSummary, user: User, *, force: bool = False) -> dict | None:
    """The fidelity read shaped for the caller. Prose for everyone; bands and
    per-construct scores only for a researcher — fit is not quality, and a
    number about a teacher's own tutor must not read as a grade (1.1.65 R1)."""
    result = await resolve_fidelity(summary, force=force)
    if result is None:
        return None
    return result.researcher_view() if getattr(user, "is_researcher", False) else result.teacher_view()


@router.get("/sessions/{session_id}")
async def get_session_report(
    session_id: str = Path(...),
    source: str = Query("auto", pattern="^(auto|bq)$"),
    narrative: bool = Query(True),
    _user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Return the session summary for ``session_id``. 404 if missing.

    ``source=auto`` (default) is BigQuery-first with a session-state fallback.
    ``source=bq`` reads BigQuery ONLY (no fallback) — used by
    ``aiplatform logs verify`` to prove the chat-log pipeline reached BigQuery
    rather than being masked by the live-session fallback. 404 until the row
    has been ingested by the sink.

    ``narrative=true`` (default) attaches the cached/generated AI summary
    (1.1.4). The ``source=bq`` verify path skips it to stay LLM-free.
    """
    if source == "bq":
        summary = await summarize_session_bq(session_id)
    else:
        summary = await resolve_session_summary(session_id)
    if summary is None:
        raise HTTPException(status_code=404, detail="session not found")
    # Before the narrative/fidelity calls: a refused caller must not spend an LLM call.
    # One exception: a group reading its OWN session through the BigQuery-only
    # verify path — what `aiplatform logs verify` (`make verify-chat-logs`) does
    # with the token it just joined with. That path carries no narrative or
    # fidelity read, only the group's own turns.
    own_group_verify = source == "bq" and bool(_user.group_id) and summary.group_code == _user.group_id
    if not own_group_verify:
        await _assert_can_read_group(_user, summary.group_code)
    fidelity = None
    if narrative and source != "bq":
        await resolve_narrative(summary)
        fidelity = await _fidelity_for(summary, _user)
    return await _aserialize(summary, fidelity=fidelity)


@router.get("/groups/{group_code}")
async def get_group_latest_report(
    group_code: str = Path(...),
    session_id: str | None = Query(None),
    refresh: bool = Query(False),
    _user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Return a session summary for an anonymous group.

    Default: the most-recently active session. Pass ``?session_id=<id>``
    to pick a specific past session (used by the teacher dashboard's
    activity-feed rows to deep-link to the row's own session rather than
    always landing on the latest).

    ``?refresh=1`` forces the AI summary to regenerate now (the teacher's
    manual "Refresh summary" on a live report), bypassing the cache/debounce.
    The raw transcript + workbench data are always live regardless.

    404 when the group has no sessions yet (frontend renders an empty state).
    """
    await _assert_can_read_group(_user, group_code)
    if session_id:
        summary = await resolve_session_summary(session_id)
        if summary is None:
            raise HTTPException(status_code=404, detail="session not found")
        # Confirm the session actually belongs to this group code — prevents
        # cross-group enumeration by guessing session ids. A session with NO
        # group code is refused too: the ownership check above was on
        # ``group_code``, so it says nothing about a session outside it.
        if summary.group_code != group_code:
            raise HTTPException(status_code=404, detail="session not found for this group")
        await resolve_narrative(summary, force=refresh)
        fidelity = await _fidelity_for(summary, _user, force=refresh)
        return await _aserialize(summary, fidelity=fidelity)

    # Prefer the chat-turn log (BigQuery) as the source of truth for the
    # group's latest *real* session. The Firestore chat_sessions index is
    # sparse for anonymous groups, and a bare join (0 turns) can otherwise win
    # "latest" by timestamp — surfacing an empty "no conversation" report when
    # the group actually chatted in another session.
    #
    # 1.1.131 M3 — synchronous BigQuery, so it runs in a worker thread. The
    # teacher's live view polls this route; inline, every poll froze every
    # student stream on the instance (the runtime guard logged 114 hits on
    # 24 Sep before anyone read it).
    bq_session_id = await asyncio.to_thread(find_latest_session_id_for_group_bq, group_code)
    if bq_session_id:
        summary = await resolve_session_summary(bq_session_id)
        if summary is not None:
            await resolve_narrative(summary, force=refresh)
            fidelity = await _fidelity_for(summary, _user, force=refresh)
            return await _aserialize(summary, fidelity=fidelity)

    idx = await asyncio.to_thread(find_latest_session_for_group, group_code)
    if idx is None:
        raise HTTPException(status_code=404, detail="no sessions for this group yet")
    summary = await resolve_session_summary(idx.session_id)
    if summary is None:
        # Race: index existed, ADK session gone. Same UX as "no sessions".
        raise HTTPException(status_code=404, detail="no sessions for this group yet")
    await resolve_narrative(summary, force=refresh)
    fidelity = await _fidelity_for(summary, _user, force=refresh)
    return await _aserialize(summary, fidelity=fidelity)
