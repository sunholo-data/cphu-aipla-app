"""Curriculum-library routes (1.1.25).

M1 ships the ACL-filtered browse. Ingestion (``POST /ingest``, AILANG Parse →
ADK RAG) is M2; retrieval (the tutor grounding tool) is M3.

  GET /api/curriculum?level=B&topic=mechanics&scope=shared|mine — browse

Deny-by-default: browse is TEACHER-ONLY. Anonymous-group students never see the
open corpus — they only receive an activity's cited materials via the tutor.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException

from auth import User, get_current_user
from db.curriculum import list_curriculum_for_teacher
from db.models.curriculum import StxLevel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/curriculum", tags=["curriculum"])


@router.get("")
async def browse_curriculum(
    level: StxLevel | None = None,
    topic: str | None = None,
    scope: Literal["shared", "mine"] | None = None,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Browse the curriculum library, ACL-scoped to the teacher (shared + own).
    FastAPI validates ``level``/``scope`` against their Literals -> 422 on bad
    input, so no manual guard is needed."""
    if getattr(user, "group_id", None):
        # Students don't browse the open corpus (deny-by-default).
        raise HTTPException(status_code=403, detail="Curriculum browse is teacher-only.")
    docs = list_curriculum_for_teacher(user.uid, level=level, topic=topic, scope=scope)
    return {"docs": [d.model_dump(by_alias=True, mode="json") for d in docs]}
