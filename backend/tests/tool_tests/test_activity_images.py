"""adk/activity_images.py (1.1.44) — the durable activity-image slot.

These exercise the slot helper against the in-process ``InMemoryArtifactService``
(no ``ADK_ARTIFACT_BUCKET`` → in-memory; the singleton is the same store the
upload endpoint and the ADK runner share by design). The slot is keyed by
(teacher_uid, activity_id, material_id) — NOT by a chat session — so it persists
across every student's session.
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
async def test_distinct_activities_do_not_collide():
    await save_activity_image(teacher_uid="t", activity_id="a1", material_id="m", data=b"one", mime_type="image/png")
    await save_activity_image(teacher_uid="t", activity_id="a2", material_id="m", data=b"two", mime_type="image/png")
    p1 = await load_activity_image(teacher_uid="t", activity_id="a1", material_id="m")
    p2 = await load_activity_image(teacher_uid="t", activity_id="a2", material_id="m")
    assert p1.inline_data.data == b"one"
    assert p2.inline_data.data == b"two"
