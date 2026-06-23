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
from fastapi.responses import Response

from adk.activity_images import delete_activity_image, load_activity_image, save_activity_image
from adk.teacher_focus import resolve_active_config
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
    """Remove an image from the activity slot. Idempotent."""
    _require_teacher(user)
    await delete_activity_image(teacher_uid=user.uid, activity_id=activity_id, material_id=material_id)


@router.get("/{activityId}/{materialId}")
async def get_activity_image(
    activity_id: Annotated[str, Path(alias="activityId")],
    material_id: Annotated[str, Path(alias="materialId")],
    user: User = Depends(get_current_user),  # noqa: B008
) -> Response:
    """Serve an activity image's bytes. **Dual-audience** (1.1.44 M4):

    - **Teacher** (no ``group_id``): owns the activity → reads their own slot
      (the slot is keyed by their uid, so they can only ever read their own).
    - **Student** (anonymous group): only if the image material is cited on their
      bound activity AND marked ``student_visible`` — same gate as cited docs.
      The teacher_uid for the slot comes from the resolved activity config, never
      from the student.

    The caller picks the auth helper: student surfaces send the group token
    (``fetchWithAuth``), the teacher builder the Firebase token
    (``fetchWithTeacherAuth``) — both resolve through ``get_current_user``.
    """
    if getattr(user, "group_id", None):
        # Student: authorise via the bound activity's config; deny by default.
        cfg = resolve_active_config(activity_id, group_tags=user.group_tags)
        material = _find_image_material(cfg, material_id) if cfg else None
        if material is None or not material.student_visible:
            raise HTTPException(status_code=403, detail="This image isn't available to you.")
        teacher_uid = cfg.teacher_uid
    else:
        teacher_uid = user.uid

    part = await load_activity_image(teacher_uid=teacher_uid, activity_id=activity_id, material_id=material_id)
    if part is None or part.inline_data is None or not part.inline_data.data:
        raise HTTPException(status_code=404, detail="Image not found.")

    return Response(
        content=part.inline_data.data,
        media_type=part.inline_data.mime_type or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=3600"},
    )


def _find_image_material(cfg: Any, material_id: str) -> MaterialRef | None:
    for m in cfg.materials or []:
        if m.kind == "image" and m.material_id == material_id:
            return m
    return None
