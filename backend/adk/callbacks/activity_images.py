"""before_agent + before_model callbacks for activity image materials (1.1.44).

Twins of the document pipeline (``adk/callbacks/document.py``), for a teacher's
activity image instead of an attached document:

  * ``make_activity_image_loader(active_cfg)`` — a ``before_agent_callback`` that,
    at session start, copies the activity's image materials from the durable
    activity slot (``adk/activity_images.py``) into THIS student's session
    artifacts. Idempotent + orphan-recovering (mirrors ``make_document_loader``),
    so it copies once per session and self-heals a vanished artifact.
  * ``make_activity_image_injector(active_cfg)`` — a ``before_model_callback`` that
    inlines each loaded image into the LLM request as a native **image** Part
    (the one line that differs from ``make_document_injector``, which inlines text).

Why copy into the session rather than read the durable slot every turn: it makes
the image a normal session artifact (observable in the ADK web UI / eval) and lets
the injector use the plain ``callback_context.load_artifact`` (session-scoped).

State key:
  ``app:activity_images_loaded`` — list[str] of material_ids copied into this session.
"""

from __future__ import annotations

import logging
from typing import Any

from adk.activity_images import load_activity_image

logger = logging.getLogger(__name__)

_STATE_IMAGES_LOADED = "app:activity_images_loaded"


def _image_materials(active_cfg: Any) -> list[Any]:
    """The activity's image materials (empty when no config / no images)."""
    if active_cfg is None:
        return []
    return [m for m in (active_cfg.materials or []) if getattr(m, "kind", "curriculum") == "image"]


def _session_filename(material_id: str) -> str:
    return f"activity-image:{material_id}"


def make_activity_image_loader(active_cfg: Any) -> Any:
    """Return a ``before_agent_callback`` that copies the activity's image
    materials from the durable activity slot into this student's session.

    ``active_cfg`` is the already-resolved ``ActivityConfig`` (or ``None``) — the
    agent factory resolves it once for ``{teacher_focus}`` + curriculum, so we
    reuse it (no extra Firestore read). It supplies the durable slot key
    (``teacher_uid`` + ``activity_id``) and the image ``MaterialRef``s.
    """
    materials = _image_materials(active_cfg)

    async def _loader(callback_context: Any) -> None:
        if not materials:
            return
        state = getattr(callback_context, "state", None)
        if state is None:
            return

        loaded_raw: list[str] = list(state.get(_STATE_IMAGES_LOADED) or [])

        # Orphan recovery: drop ids whose session artifact has vanished so they
        # re-copy (mirrors the document loader's self-heal).
        loaded: list[str] = []
        for mid in loaded_raw:
            try:
                art = await callback_context.load_artifact(filename=_session_filename(mid))
            except Exception as exc:
                logger.warning("activity image loader: orphan probe error for %s: %s", mid, exc)
                continue
            if art is None or getattr(art, "inline_data", None) is None:
                continue
            loaded.append(mid)
        loaded_set = set(loaded)

        to_load = [m for m in materials if m.material_id and m.material_id not in loaded_set]
        if not to_load:
            state[_STATE_IMAGES_LOADED] = loaded
            return

        teacher_uid = active_cfg.teacher_uid
        activity_id = active_cfg.activity_id
        for m in to_load:
            try:
                part = await load_activity_image(
                    teacher_uid=teacher_uid,
                    activity_id=activity_id,
                    material_id=m.material_id,
                )
                if part is None or getattr(part, "inline_data", None) is None:
                    logger.warning(
                        "activity image loader: durable slot missing for %s (activity=%s) — skipping",
                        m.material_id,
                        activity_id,
                    )
                    continue
                await callback_context.save_artifact(filename=_session_filename(m.material_id), artifact=part)
                loaded.append(m.material_id)
                logger.info("activity image copied into session: %s (activity=%s)", m.material_id, activity_id)
            except Exception as exc:
                logger.warning("activity image loader failed for %s: %s", m.material_id, exc)

        state[_STATE_IMAGES_LOADED] = loaded

    return _loader


def make_activity_image_injector(active_cfg: Any) -> Any:
    """Return a ``before_model_callback`` that inlines loaded activity images as
    native image Parts (twin of ``make_document_injector``).

    Each image is prefixed with a short text Part naming it (the teacher's ``alt``
    label) so the tutor knows what it's looking at. Per-turn: only the first model
    call of a turn (trailing content is the user's text, not a tool response); the
    request is rebuilt from session events each turn, so we re-inject every turn
    rather than persist the image into history.
    """
    alt_by_id = {m.material_id: (m.alt or "").strip() for m in _image_materials(active_cfg) if m.material_id}

    async def _injector(callback_context: Any, llm_request: Any) -> None:
        state = getattr(callback_context, "state", None)
        if state is None:
            return
        loaded: list[str] = list(state.get(_STATE_IMAGES_LOADED) or [])
        if not loaded:
            return

        contents = getattr(llm_request, "contents", None)
        if not contents:
            return
        last = contents[-1]
        if getattr(last, "role", None) != "user":
            return
        last_parts = getattr(last, "parts", None) or []
        if any(getattr(p, "function_response", None) for p in last_parts):
            return  # mid-turn tool round-trip

        from google.genai.types import Content, Part

        injected = 0
        for mid in loaded:
            try:
                art = await callback_context.load_artifact(filename=_session_filename(mid))
            except Exception as exc:
                logger.warning("activity image injector: load failed for %s: %s", mid, exc)
                continue
            if not art or not getattr(art, "inline_data", None):
                continue
            label = alt_by_id.get(mid) or mid
            text_part = Content(
                role="user",
                parts=[Part.from_text(text=f"[Reference image for this activity: {label} — attached by the teacher]")],
            )
            image_content = Content(role="user", parts=[art])
            contents.insert(-1, text_part)
            contents.insert(-1, image_content)
            injected += 1

        logger.info("activity image injector: inlined %d/%d image(s)", injected, len(loaded))

    return _injector
