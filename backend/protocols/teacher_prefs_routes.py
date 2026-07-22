"""Teacher account defaults API (1.1.58 / SETTINGS-1).

``GET/PUT /api/teacher/prefs`` — the caller's OWN prefs only (uid from the
verified token, never a parameter). Anonymous-group students are rejected: a
group JWT has no teacher account to hold defaults (the ADR-001 corner, tested).
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from auth.firebase_auth import User, get_current_user
from auth.guards import assert_teacher
from db.teacher_prefs import get_teacher_prefs, merge_teacher_prefs

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/teacher", tags=["teacher-prefs"])


class TeacherPrefsUpdate(BaseModel):
    """Partial update — omitted fields are untouched; ``null`` clears a field."""

    default_language: Literal["da", "en"] | None = Field(default=None, alias="defaultLanguage")
    default_persona_id: str | None = Field(default=None, alias="defaultPersonaId", max_length=64)
    features: dict[str, bool] | None = None

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


@router.get("/prefs")
async def get_prefs(user: User = Depends(get_current_user)) -> dict[str, Any]:  # noqa: B008
    """The caller's account defaults (``{}`` when unset)."""
    assert_teacher(user, detail="teacher account required")
    return get_teacher_prefs(user.uid)


@router.put("/prefs")
async def put_prefs(
    body: TeacherPrefsUpdate,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Partial-merge the caller's account defaults; returns the merged doc."""
    assert_teacher(user, detail="teacher account required")
    updates = body.model_dump(exclude_unset=True, by_alias=True)
    merged = merge_teacher_prefs(user.uid, updates)
    log.info("teacher-prefs: %s updated %s", user.uid, sorted(updates))
    return merged
