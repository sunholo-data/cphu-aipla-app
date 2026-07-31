"""Structured chat-log emitters (SEQUENCE 1.2) → BigQuery via the Log Router sink.

``emit_chat_turn`` / ``emit_workbench_event`` write Cloud Logging structured
entries under dedicated log ids (``aipla_chat_turn`` / ``aipla_workbench_event``).
The ``aipla-chat-logs`` sink routes those to the ``chat_logs`` BigQuery dataset
(see ``infrastructure/modules/chat-logs/`` and ``ensure_chat_logs()`` in
``scripts/bootstrap-aipla-dev.sh``).

The jsonPayload keys here MUST stay in lockstep with the flattened views in
``infrastructure/modules/chat-logs/views.tf`` — the views select
``jsonPayload.<key>`` by these exact names.

Design constraints:
  * Keyed only by anonymous ``group_id`` (ADR-001) — no student PII.
  * Stays inside the GCP project (ADR-008 / Axiom #9) — Cloud Logging → BQ,
    no third-party egress.
  * Off the chat hot path and **never raises**: a logging failure (or no
    creds / LOCAL_MODE) logs a warning and returns, so chat is never broken
    by telemetry.

We use the ``google.cloud.logging`` Client directly (named loggers) rather
than the stdlib ``logging`` + ``extra`` path the rest of observability uses,
because the sink routes by ``logName`` and named loggers give explicit control.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from config.local_mode import is_local_mode

logger = logging.getLogger(__name__)

# Log ids — must match the sink filter in the chat-logs module + ensure_chat_logs().
LOG_ID_CHAT_TURN = "aipla_chat_turn"
LOG_ID_WORKBENCH_EVENT = "aipla_workbench_event"
LOG_ID_VOICE_COST = "aipla_voice_cost"
LOG_ID_RUBRIC_RUN = "aipla_rubric_run"  # RUBRIC-2 M3 — one row per scored (session/rubric/version)

# Lazily-initialised google.cloud.logging.Client, shared across log ids.
_client: Any = None
# Cache of log_id -> google.cloud.logging.Logger (or None = "do not emit").
_clients: dict[str, Any] = {}


def _version_fields() -> dict[str, str | None]:
    """Which build produced this row — the A/B arm key.

    Two identifiers, because they answer different questions:

    ``revision``
        Cloud Run's ``K_REVISION`` (e.g. ``aipla-v01-frontend-00004-flv``), set
        automatically on every Cloud Run container — no deploy config needed.
        This is the **A/B arm key**: Cloud Run traffic tags route to *revisions*,
        so when two versions serve side by side, the revision is what
        distinguishes them. Without it, turns from two arms are indistinguishable
        in BigQuery and the experiment is unanalysable after the fact.

    ``app_version``
        The release tag (``v0.1.4``), baked in at deploy as ``APP_VERSION``.
        Human-readable and stable across the revisions a single release produces.
        ``None`` when unset (e.g. local runs) rather than a fake default — an
        honest null beats a misleading "dev".

    Cheap to compute (two env reads) and deliberately not cached: a warm process
    never changes revision, but caching would only save nanoseconds and would
    make the values untestable.
    """
    return {
        "revision": os.environ.get("K_REVISION") or None,
        "app_version": os.environ.get("APP_VERSION") or None,
    }


def group_code_from_owner_uid(owner_uid: str | None) -> str | None:
    """Reverse the ``anon-{group_code}-{hex}`` owner_uid → ``group_code``.

    Returns ``None`` for non-anonymous owners (Firebase/Google-auth teachers,
    LOCAL_MODE ``workshop-user``) since those aren't a student group — callers
    skip emitting for them so no teacher identity ever lands in the logs
    (ADR-001). group_codes themselves contain hyphens (``bold-kazoo-87``), so
    we strip only the trailing ``-<hex>`` segment.
    """
    if not owner_uid or not owner_uid.startswith("anon-"):
        return None
    body = owner_uid[len("anon-") :]
    parts = body.rsplit("-", 1)
    return parts[0] if len(parts) == 2 else None


def _get_logger(log_id: str) -> Any:
    """Return a cached Cloud Logging ``Logger`` for ``log_id``, or ``None``.

    ``None`` means "silently don't emit": LOCAL_MODE, missing credentials, or
    a client-init failure. Callers treat ``None`` as a no-op. The first failure
    is cached so we don't re-attempt a broken import on every turn.
    """
    if is_local_mode():
        return None
    if log_id in _clients:
        return _clients[log_id]
    try:
        import google.cloud.logging  # lazy — keeps module import light + test-friendly

        global _client
        if _client is None:
            _client = google.cloud.logging.Client()
        gl = _client.logger(log_id)
    except Exception as exc:  # never let telemetry init break a turn
        logger.warning("chat_log: cloud logging unavailable (%s) — not emitting %s", exc, log_id)
        _clients[log_id] = None
        return None
    _clients[log_id] = gl
    return gl


def emit_chat_turn(
    *,
    group_id: str,
    session_id: str,
    skill_id: str,
    turn_index: int,
    role: str,
    content: str,
    model: str | None = None,
    token_in: int | None = None,
    token_out: int | None = None,
    latency_ms: int | None = None,
    teacher_focus: str | None = None,
) -> None:
    """Emit one chat turn (student or tutor). Never raises."""
    gl = _get_logger(LOG_ID_CHAT_TURN)
    if gl is None:
        return
    payload = {
        "group_id": group_id,
        "session_id": session_id,
        "skill_id": skill_id,
        "turn_index": turn_index,
        "role": role,
        "content": content,
        "model": model,
        "token_in": token_in,
        "token_out": token_out,
        "latency_ms": latency_ms,
        "teacher_focus": teacher_focus,
        **_version_fields(),
    }
    try:
        gl.log_struct(payload)
    except Exception as exc:  # telemetry must never break the chat path
        logger.warning("chat_log: emit_chat_turn failed (suppressed): %s", exc)


def emit_workbench_event(
    *,
    group_id: str,
    session_id: str,
    skill_id: str,
    server: str,
    tool: str,
    field: Any,
    value: Any,
) -> None:
    """Emit one workbench interaction. Never raises.

    ``value`` is stringified (the BQ view's ``value`` column is STRING) so a
    complex artefact payload still lands as a queryable scalar. ``field`` is
    likewise coerced to a scalar string — a list (a sim's ``changed`` keys)
    becomes comma-joined — so the BQ ``field`` column (non-repeated STRING)
    never rejects the row.
    """
    gl = _get_logger(LOG_ID_WORKBENCH_EVENT)
    if gl is None:
        return
    value_str = value if isinstance(value, str) else json.dumps(value, default=str)
    # The BQ ``field`` column is a non-repeated STRING. Coerce defensively so a
    # caller passing a list (e.g. a sim state-change's ``changed`` key array)
    # can never break the chat-logs sink with "Array specified for non-repeated
    # field" — a list becomes a comma-joined scalar; anything else is stringified.
    if isinstance(field, str):
        field_str = field
    elif isinstance(field, (list, tuple)):
        field_str = ",".join(str(f) for f in field)
    else:
        field_str = str(field)
    payload = {
        "group_id": group_id,
        "session_id": session_id,
        "skill_id": skill_id,
        "server": server,
        "tool": tool,
        "field": field_str,
        "value": value_str,
        **_version_fields(),
    }
    try:
        gl.log_struct(payload)
    except Exception as exc:  # telemetry must never break the request
        logger.warning("chat_log: emit_workbench_event failed (suppressed): %s", exc)


def emit_voice_cost(
    *,
    group_id: str,
    kind: str,
    provider: str,
    units: int,
    cost_usd: float,
    skill_id: str | None = None,
    session_id: str | None = None,
) -> None:
    """Emit one voice-cost estimate (STT or TTS) for the cost dashboard
    (1.1.9 voice integration). Never raises; no-op in LOCAL_MODE.

    ``kind`` is ``"stt"`` or ``"tts"``. ``units`` is the provenance count —
    ``duration_ms`` for STT, characters for TTS. ``cost_usd`` comes from
    ``voice.cost`` (estimates, not invoiced billing). Cost bins to
    ``group_id`` for class attribution (ADR-001 — never per-student); callers
    skip emission when there is no group (teacher / LOCAL_MODE).
    """
    gl = _get_logger(LOG_ID_VOICE_COST)
    if gl is None:
        return
    payload = {
        "group_id": group_id,
        "kind": kind,
        "provider": provider,
        "units": units,
        "cost_usd": cost_usd,
        "skill_id": skill_id,
        "session_id": session_id,
    }
    try:
        gl.log_struct(payload)
    except Exception as exc:  # telemetry must never break the request
        logger.warning("chat_log: emit_voice_cost failed (suppressed): %s", exc)


def emit_rubric_run(
    *,
    run_id: str,
    rubric_id: str,
    rubric_version: str,
    session_id: str,
    group_id: str,
    activity_id: str,
    model: str,
    abstained: bool,
    is_live: bool,
    evidence_count: int,
    student_initiated: int,
    tutor_prompted: int,
    profile_json: str,
) -> None:
    """Mirror one rubric run into BigQuery (RUBRIC-2 M3) so run metadata is
    queryable next to the turns it scored. Never raises; no-op in LOCAL_MODE.

    Group-keyed only (ADR-001). The full profile rides as a JSON string so the
    row stays flat/scalar for the auto-created BQ schema (same discipline as the
    workbench-event ``value`` column)."""
    gl = _get_logger(LOG_ID_RUBRIC_RUN)
    if gl is None:
        return
    payload = {
        "run_id": run_id,
        "rubric_id": rubric_id,
        "rubric_version": rubric_version,
        "session_id": session_id,
        "group_id": group_id,
        "activity_id": activity_id,
        "model": model,
        "abstained": abstained,
        "is_live": is_live,
        "evidence_count": evidence_count,
        "student_initiated": student_initiated,
        "tutor_prompted": tutor_prompted,
        "profile_json": profile_json,
    }
    try:
        gl.log_struct(payload)
    except Exception as exc:  # telemetry must never break the scoring path
        logger.warning("chat_log: emit_rubric_run failed (suppressed): %s", exc)


__all__ = [
    "LOG_ID_CHAT_TURN",
    "LOG_ID_RUBRIC_RUN",
    "LOG_ID_VOICE_COST",
    "LOG_ID_WORKBENCH_EVENT",
    "emit_chat_turn",
    "emit_rubric_run",
    "emit_voice_cost",
    "emit_workbench_event",
    "group_code_from_owner_uid",
]
