"""Activity image-material routes (1.1.44).

  POST   /api/activity-images                          — upload an image into the activity slot
  DELETE /api/activity-images/{activityId}/{materialId} — remove it

Teacher-only (deny-by-default: an anonymous-group student → 403). The image bytes
are stored in the ADK ArtifactService keyed by an *activity* slot (see
``adk/activity_images.py``); a session-start loader copies them into each student's
session and an injector inlines them so the tutor SEES the image multimodally.

This endpoint does NOT write the returned ``MaterialRef`` into the ``ActivityConfig``
— the activity-builder save (a full overwrite of ``materials``) owns that, so create
and edit keep a single write path.
"""

from __future__ import annotations

import logging
import uuid
from pathlib import PurePosixPath
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Form, HTTPException, Path, UploadFile

from adk.activity_images import IMAGE_MIME_TO_EXT, delete_activity_image, save_activity_image
from auth import User, get_current_user
from db.models.activity_config import MaterialRef

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/activity-images", tags=["activity-images"])

# Extension → canonical MIME. We derive the MIME from the filename (deterministic)
# rather than trusting the browser-supplied content-type.
_EXT_TO_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# Generous cap — reference diagrams/graphs, not high-res photos.
IMAGE_MAX_BYTES = 5 * 1024 * 1024


def _require_teacher(user: User) -> None:
    if getattr(user, "group_id", None):
        raise HTTPException(status_code=403, detail="Activity images are teacher-only.")


@router.post("", status_code=201)
async def upload_activity_image(
    file: UploadFile,
    activity_id: Annotated[str, Form(alias="activityId", min_length=1, max_length=200)],
    alt: Annotated[str, Form(max_length=300)] = "",
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Upload an image into the activity's artifact slot; return its image MaterialRef."""
    _require_teacher(user)

    ext = PurePosixPath(file.filename or "upload").suffix.lower()
    mime_type = _EXT_TO_MIME.get(ext)
    if mime_type is None:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported image type {ext!r}. Supported: {sorted(_EXT_TO_MIME)}.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="Image file is empty.")
    if len(data) > IMAGE_MAX_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"Image too large ({len(data)} bytes); max {IMAGE_MAX_BYTES} bytes.",
        )

    material_id = uuid.uuid4().hex
    await save_activity_image(
        teacher_uid=user.uid,
        activity_id=activity_id,
        material_id=material_id,
        data=data,
        mime_type=mime_type,
    )

    ref = MaterialRef(
        kind="image",
        materialId=material_id,
        mimeType=mime_type,
        alt=alt,
        studentVisible=False,
    )
    log.info("activity image uploaded: activity=%s material=%s by=%s", activity_id, material_id, user.uid)
    return {"materialRef": ref.model_dump(by_alias=True, mode="json")}


@router.delete("/{activityId}/{materialId}", status_code=204)
async def delete_activity_image_route(
    activity_id: Annotated[str, Path(alias="activityId")],
    material_id: Annotated[str, Path(alias="materialId")],
    user: User = Depends(get_current_user),  # noqa: B008
) -> None:
    """Remove an image from the activity slot. Idempotent; the DELETE has no MIME, so
    we clear every candidate extension for this material id (only one ever exists)."""
    _require_teacher(user)
    for mime_type in IMAGE_MIME_TO_EXT:
        await delete_activity_image(
            teacher_uid=user.uid,
            activity_id=activity_id,
            material_id=material_id,
            mime_type=mime_type,
        )
