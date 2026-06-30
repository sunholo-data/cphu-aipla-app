"""Activity image materials (1.1.44) — durable storage over the ADK ArtifactService.

A teacher attaches an image to an activity (a diagram/graph/photographed
worksheet) and the tutor must SEE it during the student conversation. The bytes
live in the shared artifact store (``adk/session.py`` ``get_artifact_service()``
singleton — the SAME store the runner uses, by design).

**Key scheme — `material_id` ONLY (fixed since the 2026-06-30 fix).**

    app_name   = AIPLA_ARTIFACT_APP
    user_id    = _MATERIALS_USER        (fixed sentinel — NOT the teacher)
    session_id = _MATERIALS_SESSION     (fixed sentinel — NOT the activity)
    filename   = activity-image:{material_id}

``material_id`` is a unique UUID minted per image, and — crucially — BOTH the
teacher upload and the student-session loader (``adk/callbacks/activity_images.py``)
already hold the exact same ``material_id`` (the upload form field; the activity's
``MaterialRef.material_id``). So keying on it alone guarantees save↔load agree.

**Why the key changed (the bug it fixes):** the original key was
``(teacher_uid, activity_id, material_id)`` and relied on ``skill_id == activity_id``.
That assumption is false — activities carry their own ``act-...`` id. An image
uploaded while the client sent the *skill* id (``f45dc300…``) was saved under that
id, but the loader reconstructs the *canonical* ``active_cfg.activity_id``
(``act-…``) → the slot key diverged → ``load_artifact`` returned ``None`` →
"durable slot missing" → the image never reached the tutor (reported: an uploaded
image not referenced in the AI's answer). The uid could diverge the same way
(uploader vs activity owner). Dropping both from the key removes the entire class.

The HTTP endpoints still enforce teacher/owner/student ACL; the durable key is an
internal addressing detail, and ``material_id`` is unguessable. The store is
MIME-agnostic: ``save_artifact`` persists ``inline_data`` with its ``mime_type``
and ``load_artifact`` hands back a ready-to-inline image Part — so callers never
thread the mime through load/delete/GET. ``teacher_uid``/``activity_id`` are kept
as parameters for log context only (they do NOT affect the key).
"""

from __future__ import annotations

import logging

from google.genai.types import Part

from adk.session import get_artifact_service

log = logging.getLogger(__name__)

# Canonical app_name for the durable activity slot — used for BOTH the teacher
# upload write and the student-side read, so they always agree regardless of the
# ADK runner's own app_name (the agents_dir-vs-APP_NAME quirk).
AIPLA_ARTIFACT_APP = "aipla"

# Fixed (user_id, session_id) sentinels so the durable key depends ONLY on
# material_id — see the module docstring. These are NOT real user/activity ids.
_MATERIALS_USER = "activity-materials"
_MATERIALS_SESSION = "images"


# The slot filename is MIME-independent: load_artifact returns the Part with the
# mime carried by the blob's content-type, so callers need only the material_id.
def _slot_filename(material_id: str) -> str:
    return f"activity-image:{material_id}"


def _slot_key(material_id: str) -> dict[str, str]:
    """The artifact key for an image — material_id ONLY (see module docstring)."""
    return {
        "app_name": AIPLA_ARTIFACT_APP,
        "user_id": _MATERIALS_USER,
        "session_id": _MATERIALS_SESSION,
        "filename": _slot_filename(material_id),
    }


async def save_activity_image(
    *, teacher_uid: str, activity_id: str, material_id: str, data: bytes, mime_type: str
) -> None:
    """Save an image into the durable material slot (keyed by material_id)."""
    part = Part.from_bytes(data=data, mime_type=mime_type)
    await get_artifact_service().save_artifact(**_slot_key(material_id), artifact=part)
    log.info(
        "activity image saved: material=%s activity=%s by=%s (%s)", material_id, activity_id, teacher_uid, mime_type
    )


async def load_activity_image(*, teacher_uid: str, activity_id: str, material_id: str) -> Part | None:
    """Load an image Part from the durable material slot (``None`` if missing).
    The returned Part's ``inline_data.mime_type`` is the original upload mime."""
    try:
        return await get_artifact_service().load_artifact(**_slot_key(material_id))
    except Exception as exc:  # a missing/transient slot is non-fatal here
        log.warning("activity image load failed for material=%s (activity=%s): %s", material_id, activity_id, exc)
        return None


async def delete_activity_image(*, teacher_uid: str, activity_id: str, material_id: str) -> None:
    """Delete an image from the durable material slot (idempotent)."""
    try:
        await get_artifact_service().delete_artifact(**_slot_key(material_id))
    except Exception as exc:  # already-gone is fine
        log.warning("activity image delete failed for material=%s (activity=%s): %s", material_id, activity_id, exc)
