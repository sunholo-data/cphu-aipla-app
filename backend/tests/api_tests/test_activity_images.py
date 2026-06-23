"""Activity image upload endpoint tests (1.1.44 M1).

Teacher-only; type/size gated; the happy path saves into the durable activity
slot (verified via load_activity_image) and returns an image MaterialRef.
"""

from __future__ import annotations

import io
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import protocols.activity_image_routes as routes
from adk.activity_images import load_activity_image
from adk.session import _reset_artifact_service_for_tests
from auth import User, build_access_context, get_current_user

TEACHER_UID = "teacher-42"


@pytest.fixture(autouse=True)
def _fresh_artifact_service(monkeypatch):
    monkeypatch.delenv("ADK_ARTIFACT_BUCKET", raising=False)
    _reset_artifact_service_for_tests()
    yield
    _reset_artifact_service_for_tests()


def _client(group_id: str = "", group_tags: list[str] | None = None) -> TestClient:
    app = FastAPI()
    app.include_router(routes.router)

    async def _override(request: Request) -> User:
        if group_id:
            u = User(uid=f"anon-{group_id}", email="", group_id=group_id, group_tags=group_tags or [])
        else:
            u = User(uid=TEACHER_UID, email="t@school.dk", group_id="")
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _png(name: str = "diagram.png", content: bytes = b"\x89PNG fake bytes") -> dict:
    return {
        "files": {"file": (name, io.BytesIO(content), "image/png")},
        "data": {"activityId": "act-1", "alt": "free-body diagram"},
    }


def test_upload_student_forbidden():
    resp = _client(group_id="grp-1").post("/api/activity-images", **_png())
    assert resp.status_code == 403
    assert "teacher-only" in resp.json()["detail"].lower()


def test_upload_rejects_non_image_extension():
    resp = _client().post(
        "/api/activity-images",
        files={"file": ("notes.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
        data={"activityId": "act-1"},
    )
    assert resp.status_code == 422
    assert "unsupported" in resp.json()["detail"].lower()


def test_upload_rejects_oversize():
    big = b"x" * (routes.IMAGE_MAX_BYTES + 1)
    resp = _client().post("/api/activity-images", **_png(content=big))
    assert resp.status_code == 422
    assert "too large" in resp.json()["detail"].lower()


def test_upload_rejects_empty():
    resp = _client().post("/api/activity-images", **_png(content=b""))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upload_happy_path_saves_slot_and_returns_ref():
    resp = _client().post("/api/activity-images", **_png(content=b"\x89PNG real"))
    assert resp.status_code == 201
    ref = resp.json()["materialRef"]
    assert ref["kind"] == "image"
    assert ref["mimeType"] == "image/png"
    assert ref["alt"] == "free-body diagram"
    assert ref["studentVisible"] is False
    material_id = ref["materialId"]
    assert material_id

    # The bytes really landed in the durable activity slot.
    part = await load_activity_image(teacher_uid=TEACHER_UID, activity_id="act-1", material_id=material_id)
    assert part is not None
    assert part.inline_data.data == b"\x89PNG real"


@pytest.mark.asyncio
async def test_delete_removes_slot():
    resp = _client().post("/api/activity-images", **_png(content=b"\x89PNG real"))
    material_id = resp.json()["materialRef"]["materialId"]

    del_resp = _client().delete(f"/api/activity-images/act-1/{material_id}")
    assert del_resp.status_code == 204

    part = await load_activity_image(teacher_uid=TEACHER_UID, activity_id="act-1", material_id=material_id)
    assert part is None


def test_delete_student_forbidden():
    resp = _client(group_id="grp-1").delete("/api/activity-images/act-1/whatever")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET — dual-audience (1.1.44 M4)
# ---------------------------------------------------------------------------


def _upload_one() -> str:
    """Upload an image as the teacher; return its materialId."""
    resp = _client().post("/api/activity-images", **_png(content=b"\x89PNG bytes"))
    return resp.json()["materialRef"]["materialId"]


def _img_material(material_id: str, *, student_visible: bool):
    from db.models.activity_config import MaterialRef

    return MaterialRef(kind="image", materialId=material_id, mimeType="image/png", studentVisible=student_visible)


def _cfg_with(materials):
    from types import SimpleNamespace

    return SimpleNamespace(teacher_uid=TEACHER_UID, activity_id="act-1", materials=materials)


def test_teacher_get_returns_image_bytes():
    material_id = _upload_one()
    resp = _client().get(f"/api/activity-images/act-1/{material_id}")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/png")
    assert resp.content == b"\x89PNG bytes"


def test_student_get_allowed_when_visible():
    material_id = _upload_one()
    cfg = _cfg_with([_img_material(material_id, student_visible=True)])
    with patch.object(routes, "resolve_active_config", return_value=cfg):
        resp = _client(group_id="grp-1", group_tags=["class:teacher-42:7b"]).get(
            f"/api/activity-images/act-1/{material_id}"
        )
    assert resp.status_code == 200
    assert resp.content == b"\x89PNG bytes"


def test_student_get_forbidden_when_not_visible():
    material_id = _upload_one()
    cfg = _cfg_with([_img_material(material_id, student_visible=False)])
    with patch.object(routes, "resolve_active_config", return_value=cfg):
        resp = _client(group_id="grp-1", group_tags=["class:teacher-42:7b"]).get(
            f"/api/activity-images/act-1/{material_id}"
        )
    assert resp.status_code == 403


def test_student_get_forbidden_when_not_cited():
    material_id = _upload_one()
    cfg = _cfg_with([])  # activity cites no image materials
    with patch.object(routes, "resolve_active_config", return_value=cfg):
        resp = _client(group_id="grp-1", group_tags=["class:teacher-42:7b"]).get(
            f"/api/activity-images/act-1/{material_id}"
        )
    assert resp.status_code == 403


def test_get_missing_image_404():
    resp = _client().get("/api/activity-images/act-1/does-not-exist")
    assert resp.status_code == 404
