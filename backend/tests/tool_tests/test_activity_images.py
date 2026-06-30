"""adk/activity_images.py (1.1.44) — the durable activity-image slot.

These exercise the slot helper against the in-process ``InMemoryArtifactService``
(no ``ADK_ARTIFACT_BUCKET`` → in-memory; the singleton is the same store the
upload endpoint and the ADK runner share by design). The slot is keyed by
**material_id ONLY** (the 2026-06-30 fix) — NOT by teacher_uid/activity_id and
NOT by a chat session — so a save and a later load always agree even when the
upload's activity_id (sometimes the skill id) differs from the loader's canonical
``active_cfg.activity_id``.
"""

from __future__ import annotations

import pytest

from adk.activity_images import (
    delete_activity_image,
    load_activity_image,
    save_activity_image,
)
from adk.session import _reset_artifact_service_for_tests


@pytest.fixture(autouse=True)
def _fresh_artifact_service(monkeypatch):
    monkeypatch.delenv("ADK_ARTIFACT_BUCKET", raising=False)
    _reset_artifact_service_for_tests()
    yield
    _reset_artifact_service_for_tests()


_KW = {"teacher_uid": "teacher-1", "activity_id": "act-1", "material_id": "img-1"}


@pytest.mark.asyncio
async def test_save_then_load_roundtrips_bytes_and_mime():
    await save_activity_image(**_KW, data=b"\x89PNG fake", mime_type="image/png")
    part = await load_activity_image(**_KW)
    assert part is not None
    assert part.inline_data is not None
    assert part.inline_data.data == b"\x89PNG fake"
    assert part.inline_data.mime_type == "image/png"


@pytest.mark.asyncio
async def test_load_missing_returns_none():
    part = await load_activity_image(teacher_uid="t", activity_id="a", material_id="nope")
    assert part is None


@pytest.mark.asyncio
async def test_delete_removes_slot():
    await save_activity_image(**_KW, data=b"x", mime_type="image/jpeg")
    await delete_activity_image(**_KW)
    assert await load_activity_image(**_KW) is None


@pytest.mark.asyncio
async def test_load_finds_image_when_activity_id_and_uid_diverge_from_save():
    """The bug this fixes (2026-06-30). The teacher upload saved the slot under
    the client-sent activity_id — which was sometimes the SKILL id (``f45dc300…``)
    — and the uploader's uid; the student-session loader reconstructs the
    CANONICAL ``active_cfg.activity_id`` (``act-…``) and the OWNER uid. The old
    (teacher_uid, activity_id, material_id) key diverged → ``load`` returned
    ``None`` → "durable slot missing" → the tutor never saw the image.

    The mocked callback tests never caught it (they stub ``load_activity_image``).
    This drives the REAL save→load round-trip with DIFFERENT uid + activity_id on
    each side, which must still resolve because the key is material_id-only.
    """
    await save_activity_image(
        teacher_uid="uploader-uid",
        activity_id="f45dc300-4b90-4162-8f28-07fb42989378",  # skill id, as seen in prod
        material_id="84c41864fa05461e840082addee6a746",
        data=b"\x89PNG real",
        mime_type="image/png",
    )
    # Loader side: canonical activity id + the owner uid — both differ from save.
    part = await load_activity_image(
        teacher_uid="owner-uid",
        activity_id="act-54fd3b543539a86",
        material_id="84c41864fa05461e840082addee6a746",
    )
    assert part is not None, "image must load even when activity_id/uid differ from save-time"
    assert part.inline_data.data == b"\x89PNG real"
    assert part.inline_data.mime_type == "image/png"
