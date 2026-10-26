"""Pre-routing a turn to the smart tier (1.1.142 M3), and the route vocabulary.

A turn is answered by the platform default (flash-lite) unless one of two
DETERMINISTIC rules sends it to the smart tier up front:

* **escalation** — the student's CURRENT message carries an image the tutor
  must interpret (a photo of their working, the solution element's drawing, a
  1.1.7 upload). Flash-lite is weakest exactly there ("they couldn't draw the
  amplitude").
* **opt_in** — the activity sets ``modelTier: smart``. Researcher-only for now
  (open question 1 in retry-then-escalate.md: protect the 1.1.106 envelope until
  the share is measured), via ``POST /api/activities/{id}/model-tier``.

There is deliberately NO "is this turn hard?" model call: it would be a second
LLM call on every turn, and its mistakes would be invisible.

The third route, **failover**, is not a pre-routing rule — it is what
``adk/resilient_llm.py`` does when the model it started with fails before any
visible output. All three are stamped on the answering ``LlmResponse`` under
``custom_metadata[MODEL_ROUTE_KEY]`` beside ``served_model``, so the cost view
can split smart-tier share by WHY a turn landed there (M4).
"""

from __future__ import annotations

from typing import Any

ROUTE_FAILOVER = "failover"
ROUTE_ESCALATION = "escalation"
ROUTE_OPT_IN = "opt_in"
ROUTES = (ROUTE_FAILOVER, ROUTE_ESCALATION, ROUTE_OPT_IN)

#: ``LlmResponse.custom_metadata`` key naming WHY the served model answered.
#: Set only when the served model differs from the chain head (the default).
MODEL_ROUTE_KEY = "model_route"

#: The activity field (camelCase in Firestore) that opts an activity in.
MODEL_TIER_SMART = "smart"
MODEL_TIER_DEFAULT = "default"


def _is_function_part(part: Any) -> bool:
    return bool(getattr(part, "function_call", None) or getattr(part, "function_response", None))


def _is_image_part(part: Any) -> bool:
    blob = getattr(part, "inline_data", None)
    mime = getattr(blob, "mime_type", "") if blob is not None else ""
    return (mime or "").startswith("image/")


def latest_student_message_has_image(llm_request: Any) -> bool:
    """True when the student's CURRENT message carries an image.

    Walks back from the end of ``llm_request.contents`` past tool round-trips
    (function calls and responses — a tool follow-up call within the same turn
    must route like the turn's first call, or a turn would switch model half-way)
    to the nearest user content that is not a tool response: that is what the
    student just sent.

    Deliberately NOT ``_request_has_image_part`` (``adk/agent.py``), which is
    right for its job — stripping grounding tools from ANY multimodal request —
    and wrong for this one. It also fires on:

    * an activity's teacher-attached reference images, re-injected before the
      student's message on EVERY turn (``callbacks/activity_images.py``), which
      would put a whole activity on the smart tier;
    * images earlier in the history, replayed every turn, which would keep a
      conversation on the smart tier forever after one photo;
    * the svg-illustrator / sim-author previews riding inside a function
      response, which are the agent looking at its own output.
    """
    for content in reversed(getattr(llm_request, "contents", None) or []):
        parts = getattr(content, "parts", None) or []
        if parts and all(_is_function_part(p) for p in parts):
            continue  # a tool round-trip inside this turn
        if getattr(content, "role", None) != "user":
            return False  # reached a model reply before any student message
        return any(_is_image_part(p) for p in parts)
    return False


def activity_opts_into_smart(active_cfg: Any) -> bool:
    """True when the resolved activity config sets ``modelTier: smart``."""
    tier = getattr(active_cfg, "model_tier", None) if active_cfg is not None else None
    return tier == MODEL_TIER_SMART


__all__ = [
    "MODEL_ROUTE_KEY",
    "MODEL_TIER_DEFAULT",
    "MODEL_TIER_SMART",
    "ROUTES",
    "ROUTE_ESCALATION",
    "ROUTE_FAILOVER",
    "ROUTE_OPT_IN",
    "activity_opts_into_smart",
    "latest_student_message_has_image",
]
