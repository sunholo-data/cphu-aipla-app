"""Unit tests for adk.callbacks.image — multimodal image injection (1.1.7)."""

from __future__ import annotations

import asyncio
import base64
from types import SimpleNamespace

import adk.callbacks.image as mod
from adk.callbacks.image import make_image_injector, stash_attachments

IMG_B64 = base64.b64encode(b"\x89PNG-fake-bytes-but-valid-base64").decode()


def _ctx(state: dict) -> SimpleNamespace:
    return SimpleNamespace(state=state)


def _req_with_user_text() -> SimpleNamespace:
    last = SimpleNamespace(role="user", parts=[SimpleNamespace(text="look at this", function_response=None)])
    return SimpleNamespace(contents=[last])


def _run(coro):
    asyncio.run(coro)


def test_injects_image_part_then_clears_for_non_retention():
    token = "tok-inject"
    stash_attachments(token, [{"mimeType": "image/png", "data": IMG_B64, "name": "x.png"}])
    ctx = _ctx({"image_attach_token": token})
    req = _req_with_user_text()

    _run(make_image_injector()(ctx, req))

    # an image Content was inserted before the student's text turn
    assert len(req.contents) == 2
    img = req.contents[0]
    assert img.role == "user"
    assert img.parts[0].inline_data is not None
    assert img.parts[0].inline_data.mime_type == "image/png"

    # NON-RETENTION: the bytes are popped from the transient cache; state holds
    # only the token, never the image data.
    assert token not in mod._PENDING
    assert "data" not in ctx.state  # no bytes leaked into state


def test_round_tripped_token_does_not_re_inject():
    token = "tok-once"
    stash_attachments(token, [{"mimeType": "image/png", "data": IMG_B64}])
    injector = make_image_injector()

    _run(injector(_ctx({"image_attach_token": token}), _req_with_user_text()))
    # second turn carries the same (stale, round-tripped) token but the cache
    # was already popped -> no image injected.
    req2 = _req_with_user_text()
    _run(injector(_ctx({"image_attach_token": token}), req2))
    assert len(req2.contents) == 1


def test_no_token_is_a_noop():
    req = _req_with_user_text()
    _run(make_image_injector()(_ctx({}), req))
    assert len(req.contents) == 1


def test_bad_base64_is_skipped():
    token = "tok-bad"
    stash_attachments(token, [{"mimeType": "image/png", "data": "!!!not base64!!!"}])
    req = _req_with_user_text()
    _run(make_image_injector()(_ctx({"image_attach_token": token}), req))
    assert len(req.contents) == 1  # nothing injected


def test_non_image_mime_is_skipped():
    token = "tok-doc"
    stash_attachments(token, [{"mimeType": "application/pdf", "data": IMG_B64}])
    req = _req_with_user_text()
    _run(make_image_injector()(_ctx({"image_attach_token": token}), req))
    assert len(req.contents) == 1  # docs go through docparse, not here


def test_mid_turn_tool_roundtrip_is_skipped():
    token = "tok-tool"
    stash_attachments(token, [{"mimeType": "image/png", "data": IMG_B64}])
    tool_content = SimpleNamespace(role="user", parts=[SimpleNamespace(function_response={"x": 1})])
    req = SimpleNamespace(contents=[tool_content])
    _run(make_image_injector()(_ctx({"image_attach_token": token}), req))
    assert len(req.contents) == 1


def test_skillconfig_multimodal_input_defaults_false():
    from db.models import SkillConfig

    cfg = SkillConfig(skill_id="s", name="n", instructions="i")
    assert cfg.multimodal_input is False
    cfg2 = SkillConfig(skill_id="s", name="n", instructions="i", multimodalInput=True)
    assert cfg2.multimodal_input is True
