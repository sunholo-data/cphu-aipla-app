"""Tests for the activity-image loader + injector callbacks (1.1.44 M2).

Mirrors test_document_loader's fake-CallbackContext pattern. The durable slot read
(``load_activity_image``) is patched; the session ``save_artifact``/``load_artifact``
are backed by an in-memory dict so the injector sees what the loader saved.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from google.genai.types import Content, Part

from adk.callbacks.activity_images import (
    _STATE_IMAGES_LOADED,
    make_activity_image_injector,
    make_activity_image_loader,
)


def _img_material(material_id: str, *, mime: str = "image/png", alt: str = ""):
    return SimpleNamespace(kind="image", material_id=material_id, mime_type=mime, alt=alt)


def _curr_material(doc_id: str):
    return SimpleNamespace(kind="curriculum", material_id="", mime_type="", alt="", doc_id=doc_id)


def _cfg(materials, *, teacher_uid="teacher-1", activity_id="act-1"):
    return SimpleNamespace(teacher_uid=teacher_uid, activity_id=activity_id, materials=materials)


def _make_ctx(state: dict | None = None, artifacts: dict[str, object] | None = None) -> MagicMock:
    arts: dict[str, object] = dict(artifacts or {})
    ctx = MagicMock()
    ctx.state = state if state is not None else {}

    async def _load_artifact(*, filename: str):
        return arts.get(filename)

    async def _save_artifact(*, filename: str, artifact):
        arts[filename] = artifact
        return None

    ctx.load_artifact = AsyncMock(side_effect=_load_artifact)
    ctx.save_artifact = AsyncMock(side_effect=_save_artifact)
    return ctx


def _png_part(data: bytes = b"\x89PNG real") -> Part:
    return Part.from_bytes(data=data, mime_type="image/png")


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


class TestActivityImageLoader:
    @pytest.mark.asyncio
    async def test_copies_image_into_session(self, monkeypatch):
        monkeypatch.setattr(
            "adk.callbacks.activity_images.load_activity_image",
            AsyncMock(return_value=_png_part()),
        )
        loader = make_activity_image_loader(_cfg([_img_material("img1", alt="diagram")]))
        ctx = _make_ctx()
        await loader(ctx)

        ctx.save_artifact.assert_awaited_once()
        kw = ctx.save_artifact.call_args.kwargs
        assert kw["filename"] == "activity-image:img1"
        assert kw["artifact"].inline_data.mime_type == "image/png"
        assert ctx.state[_STATE_IMAGES_LOADED] == ["img1"]

    @pytest.mark.asyncio
    async def test_noop_when_no_image_materials(self, monkeypatch):
        load_mock = AsyncMock(return_value=_png_part())
        monkeypatch.setattr("adk.callbacks.activity_images.load_activity_image", load_mock)
        loader = make_activity_image_loader(_cfg([_curr_material("doc-1")]))
        ctx = _make_ctx()
        await loader(ctx)
        ctx.save_artifact.assert_not_called()
        load_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_noop_when_cfg_none(self):
        loader = make_activity_image_loader(None)
        ctx = _make_ctx()
        await loader(ctx)
        ctx.save_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_idempotent_second_turn(self, monkeypatch):
        monkeypatch.setattr(
            "adk.callbacks.activity_images.load_activity_image",
            AsyncMock(return_value=_png_part()),
        )
        loader = make_activity_image_loader(_cfg([_img_material("img1")]))
        ctx = _make_ctx()
        await loader(ctx)  # turn 1 — copies
        ctx.save_artifact.reset_mock()
        await loader(ctx)  # turn 2 — already present, no re-copy
        ctx.save_artifact.assert_not_called()
        assert ctx.state[_STATE_IMAGES_LOADED] == ["img1"]

    @pytest.mark.asyncio
    async def test_orphan_in_loaded_set_recopies(self, monkeypatch):
        monkeypatch.setattr(
            "adk.callbacks.activity_images.load_activity_image",
            AsyncMock(return_value=_png_part()),
        )
        loader = make_activity_image_loader(_cfg([_img_material("img1")]))
        # Recorded as loaded but NO session artifact behind it (the strand).
        ctx = _make_ctx(state={_STATE_IMAGES_LOADED: ["img1"]}, artifacts={})
        await loader(ctx)
        ctx.save_artifact.assert_awaited_once()
        assert ctx.save_artifact.call_args.kwargs["filename"] == "activity-image:img1"
        assert ctx.state[_STATE_IMAGES_LOADED] == ["img1"]

    @pytest.mark.asyncio
    async def test_missing_durable_slot_skips_without_recording(self, monkeypatch):
        monkeypatch.setattr(
            "adk.callbacks.activity_images.load_activity_image",
            AsyncMock(return_value=None),  # durable slot gone
        )
        loader = make_activity_image_loader(_cfg([_img_material("img1")]))
        ctx = _make_ctx()
        await loader(ctx)
        ctx.save_artifact.assert_not_called()
        assert ctx.state[_STATE_IMAGES_LOADED] == []


# ---------------------------------------------------------------------------
# Injector
# ---------------------------------------------------------------------------


class TestActivityImageInjector:
    def _llm_request(self, user_text: str = "What does the diagram show?"):
        user = Content(role="user", parts=[Part.from_text(text=user_text)])
        return SimpleNamespace(contents=[user])

    @pytest.mark.asyncio
    async def test_inlines_image_part_before_user_turn(self):
        injector = make_activity_image_injector(_cfg([_img_material("img1", alt="free-body diagram")]))
        ctx = _make_ctx(
            state={_STATE_IMAGES_LOADED: ["img1"]},
            artifacts={"activity-image:img1": _png_part()},
        )
        req = self._llm_request()
        await injector(ctx, req)

        # label + image inserted ahead of the trailing user content.
        assert len(req.contents) == 3
        assert req.contents[-1].role == "user"
        image_parts = [
            p
            for c in req.contents
            for p in (c.parts or [])
            if getattr(p, "inline_data", None) and (p.inline_data.mime_type or "").startswith("image/")
        ]
        assert len(image_parts) == 1
        # the naming label mentions the alt text
        text_blob = " ".join(p.text or "" for c in req.contents for p in (c.parts or []) if getattr(p, "text", None))
        assert "free-body diagram" in text_blob

    @pytest.mark.asyncio
    async def test_noop_when_none_loaded(self):
        injector = make_activity_image_injector(_cfg([_img_material("img1")]))
        ctx = _make_ctx(state={})
        req = self._llm_request()
        await injector(ctx, req)
        assert len(req.contents) == 1  # unchanged

    @pytest.mark.asyncio
    async def test_skips_mid_turn_tool_roundtrip(self):
        injector = make_activity_image_injector(_cfg([_img_material("img1")]))
        ctx = _make_ctx(
            state={_STATE_IMAGES_LOADED: ["img1"]},
            artifacts={"activity-image:img1": _png_part()},
        )
        # Trailing content is a tool function_response, not the user's text.
        fn_part = SimpleNamespace(function_response={"name": "x"}, text=None, inline_data=None)
        req = SimpleNamespace(contents=[Content(role="user", parts=[fn_part])])
        await injector(ctx, req)
        assert len(req.contents) == 1  # unchanged
