"""OTel span tagging for proactive tutor turns (sprint PROACTIVE-SIM-REACTIVE M7).

Detects the two proactive sentinels and tags the current OTel span with
``tutor.proactive_kind`` (= ``greet`` or ``event_reactive``) plus the
triggering-event kind where applicable, so analytics-chat (sprint 1.L)
and any future trace inspection can distinguish proactive turns from
user-driven turns without parsing message content downstream.

Recon finding 2026-06-03: the existing ``tutor.proactive_kind`` attribute
mentioned in Phase A's docstring was aspirational and was never actually
implemented. M7 of the sprint creates the seam fresh rather than
extending non-existent infrastructure.

Wired in two places:
  - ``backend/protocols/proactive_routes.py`` /greet endpoint — tags
    explicitly with ``greet`` before sending the synthetic sentinel.
    Kept inline so the attribution doesn't depend on the agent's
    before-callback firing.
  - ``backend/adk/agent.py`` _composed_before_agent — reads
    ``callback_context.user_content`` and tags via ``tag_proactive_span``.
    This catches the Phase B (Path B) FE-initiated AG-UI run case where
    the trigger sentinel arrives inside RunAgentInput.messages and the
    backend has no other natural seam to detect it.
"""

from __future__ import annotations

import logging
import re

from opentelemetry import trace

log = logging.getLogger(__name__)

# Phase A sentinel — must match protocols/proactive_routes.py:PROACTIVE_GREET_TRIGGER.
_GREET_SENTINEL = "[session_start]"

# Phase B sentinel pattern — must match the trigger minted by
# protocols/proactive_routes.py:post_proactive_event_check. The capture
# group is the event kind (e.g. "sim_run") which we surface as a
# separate span attribute so analytics-chat can filter by kind.
_EVENT_REACTIVE_PATTERN = re.compile(r"^\[event_reactive:([a-z][a-z0-9_]*)\]$")


def tag_proactive_span_from_content(content: str | None) -> None:
    """Inspect a user-message content string and tag the current OTel
    span if it matches a proactive sentinel. No-op otherwise.

    Safe to call on every invocation — non-matching content (i.e.
    normal student chat turns) simply doesn't tag the span. Never
    raises: telemetry must not break the turn.
    """
    if not content:
        return
    stripped = content.strip()
    if not stripped:
        return

    try:
        span = trace.get_current_span()
        if stripped == _GREET_SENTINEL:
            span.set_attribute("tutor.proactive_kind", "greet")
            return
        match = _EVENT_REACTIVE_PATTERN.match(stripped)
        if match:
            span.set_attribute("tutor.proactive_kind", "event_reactive")
            span.set_attribute("tutor.triggering_event_kind", match.group(1))
    except Exception as exc:
        log.debug("tag_proactive_span_from_content: span tag failed (%s) — non-fatal", exc)


def tag_proactive_span_from_callback_context(callback_context: object) -> None:
    """Extract the user-message text from an ADK ``CallbackContext`` and
    delegate to ``tag_proactive_span_from_content``. The ``user_content``
    property exposes a ``google.genai.types.Content`` whose ``parts``
    list carries the user message. Empty / missing parts → no-op.

    Wired into adk/agent.py:_composed_before_agent so every agent
    invocation gets the chance to be tagged.
    """
    try:
        user_content = getattr(callback_context, "user_content", None)
        if user_content is None:
            return
        parts = getattr(user_content, "parts", None) or []
        text = " ".join(getattr(p, "text", "") or "" for p in parts).strip()
        tag_proactive_span_from_content(text)
    except Exception as exc:
        log.debug("tag_proactive_span_from_callback_context: failed (%s) — non-fatal", exc)


__all__ = [
    "tag_proactive_span_from_callback_context",
    "tag_proactive_span_from_content",
]
