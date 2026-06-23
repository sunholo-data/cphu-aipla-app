"""Activity image materials (1.1.44) — durable storage over the ADK ArtifactService.

A teacher attaches an image to an activity (a diagram/graph/photographed
worksheet) and the tutor must SEE it during the student conversation. The bytes
live in the shared artifact store (``adk/session.py`` ``get_artifact_service()``
singleton — the SAME store the runner uses, by design), keyed by an **activity
slot** rather than a chat session:

    app_name   = AIPLA_ARTIFACT_APP
    user_id    = <teacher_uid>     (the activity's owner)
    session_id = <activity_id>     (the activity is the "session" dimension)
    filename   = activity-image:{material_id}   (MIME-independent — see below)

Both ``teacher_uid`` and ``activity_id`` are recoverable at student session-time
via ``resolve_active_config`` (``skill_id == activity_id``; ``group_tags`` carry
``class:<teacher_uid>:<class_id>``), so the session-start loader
(``adk/callbacks/activity_images.py``) reconstructs this exact key, loads the
bytes, and copies them into the student session.

This module is the ONLY place that knows the durable key scheme. The store is
MIME-agnostic: ``save_artifact`` persists ``inline_data`` with its ``mime_type``
and ``load_artifact`` hands back a ready-to-inline image Part — so the filename
needs no extension and callers never thread the mime through load/delete/GET.
"""

from __future__ import annotations

import logging

from google.genai.types import Part

from adk.session import get_artifact_service

log = logging.getLogger(__name__)

# Canonical app_name for the durable activity slot — used for BOTH the teacher
# upload write and the student-side read, so they always agree regardless of the
# ADK runner's own app_name (the agents_dir-vs-APP_NAME quirk). The copy INTO the
# student session uses callback_context (the runner's app_name) on both ends, so
# the two namespaces never need to match each other.
AIPLA_ARTIFACT_APP = "aipla"


# The slot filename is MIME-independent: load_artifact returns the Part with the
# mime carried by the blob's content-type, so callers need only the material_id
# (no mime threading, no per-ext probing on delete/GET). The mime IS preserved —
# it rides ``inline_data.mime_type`` on save and comes back on load.
def _slot_filename(material_id: str) -> str:
    return f"activity-image:{material_id}"


async def save_activity_image(
    *, teacher_uid: str, activity_id: str, material_id: str, data: bytes, mime_type: str
) -> None:
    """Save an image into the activity's durable artifact slot."""
    part = Part.from_bytes(data=data, mime_type=mime_type)
    await get_artifact_service().save_artifact(
        app_name=AIPLA_ARTIFACT_APP,
        user_id=teacher_uid,
        session_id=activity_id,
        filename=_slot_filename(material_id),
        artifact=part,
    )
    log.info("activity image saved: %s/%s/%s (%s)", teacher_uid, activity_id, material_id, mime_type)


async def load_activity_image(*, teacher_uid: str, activity_id: str, material_id: str) -> Part | None:
    """Load an image Part from the activity's durable slot (``None`` if missing).
    The returned Part's ``inline_data.mime_type`` is the original upload mime."""
    try:
        return await get_artifact_service().load_artifact(
            app_name=AIPLA_ARTIFACT_APP,
            user_id=teacher_uid,
            session_id=activity_id,
            filename=_slot_filename(material_id),
        )
    except Exception as exc:  # a missing/transient slot is non-fatal here
        log.warning("activity image load failed for %s/%s/%s: %s", teacher_uid, activity_id, material_id, exc)
        return None


async def delete_activity_image(*, teacher_uid: str, activity_id: str, material_id: str) -> None:
    """Delete an image from the activity's durable slot (idempotent)."""
    try:
        await get_artifact_service().delete_artifact(
            app_name=AIPLA_ARTIFACT_APP,
            user_id=teacher_uid,
            session_id=activity_id,
            filename=_slot_filename(material_id),
        )
    except Exception as exc:  # already-gone is fine
        log.warning("activity image delete failed for %s/%s/%s: %s", teacher_uid, activity_id, material_id, exc)
