"""Teacher privacy notice — has the caller acknowledged the current version?

``GET  /api/teacher/privacy-notice``      → ``{version, acknowledged, acknowledgedAt}``
``POST /api/teacher/privacy-notice/ack``  → records it for the CURRENT version

Own-uid only (from the verified token). Students are rejected: they have no
teacher account, and their notice is the one in the chat's welcome box.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from auth import get_current_user
from auth.firebase_auth import User
from auth.guards import assert_teacher
from db.privacy_ack import PRIVACY_NOTICE_VERSION, get_acknowledgement, record_acknowledgement

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/teacher", tags=["privacy-notice"])


class PrivacyAckBody(BaseModel):
    """The version the teacher was SHOWN. A stale tab must not acknowledge a
    newer notice it never displayed."""

    version: str

    model_config = ConfigDict(extra="forbid")


@router.get("/privacy-notice")
async def get_privacy_notice(user: User = Depends(get_current_user)) -> dict[str, Any]:  # noqa: B008
    assert_teacher(user, detail="teacher account required")
    ack = get_acknowledgement(user.uid)
    return {
        "version": PRIVACY_NOTICE_VERSION,
        "acknowledged": ack is not None,
        "acknowledgedAt": (ack or {}).get("acknowledgedAt"),
    }


@router.post("/privacy-notice/ack")
async def ack_privacy_notice(
    body: PrivacyAckBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    assert_teacher(user, detail="teacher account required")
    if body.version != PRIVACY_NOTICE_VERSION:
        raise HTTPException(
            status_code=409,
            detail=f"notice version {body.version!r} is not current ({PRIVACY_NOTICE_VERSION}); reload the page",
        )
    doc = record_acknowledgement(user.uid, user.email, PRIVACY_NOTICE_VERSION)
    log.info("privacy-notice: %s acknowledged %s", user.uid, PRIVACY_NOTICE_VERSION)
    return {"version": PRIVACY_NOTICE_VERSION, "acknowledged": True, "acknowledgedAt": doc.get("acknowledgedAt")}
