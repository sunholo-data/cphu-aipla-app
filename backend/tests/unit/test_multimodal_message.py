"""Native multimodal turn plumbing (1.1.7).

Images ride the turn as native AG-UI ``ImageInputContent`` parts in the user
message content — NOT a side-channel. These tests pin the two seams that keep
that content intact end-to-end:

  * ``skill_processor._message_text`` — flattens content to text for the
    thinking router/logs while leaving image parts for ADK.
  * ``_StreamSkillRequest.effective_content`` — preserves the multimodal list
    on the wire (vs ``effective_message`` which is text-only).

The actual image→ADK Part conversion + session retention is owned by
``ag_ui_adk`` (verified to accept this exact wire shape), so it isn't re-tested
here.
"""

from __future__ import annotations

from skills.skill_processor import _message_text

_IMG_PART = {"type": "image", "source": {"type": "data", "value": "QUJD", "mimeType": "image/jpeg"}}


def test_message_text_passthrough_for_plain_string():
    assert _message_text("hello") == "hello"


def test_message_text_extracts_text_parts_only():
    content = [{"type": "text", "text": "what is this?"}, _IMG_PART]
    assert _message_text(content) == "what is this?"


def test_message_text_empty_for_image_only_turn():
    assert _message_text([_IMG_PART]) == ""


def test_message_text_joins_multiple_text_parts():
    content = [{"type": "text", "text": "a"}, _IMG_PART, {"type": "text", "text": "b"}]
    assert _message_text(content) == "a\nb"


def _body(**kw):
    from fast_api_app import _StreamSkillRequest

    return _StreamSkillRequest(**kw)


def test_effective_content_preserves_multimodal_list():
    content = [{"type": "text", "text": "look"}, _IMG_PART]
    body = _body(messages=[{"role": "user", "content": content}])
    # effective_content keeps the list intact for UserMessage(content=…)
    assert body.effective_content == content
    # effective_message stays text-only for callers that need a string
    assert body.effective_message == "look"


def test_effective_content_plain_string_turn():
    body = _body(messages=[{"role": "user", "content": "hi"}])
    assert body.effective_content == "hi"
    assert body.effective_message == "hi"


def test_effective_content_prefers_simple_message_field():
    body = _body(message="cli-shape", messages=[{"role": "user", "content": "ignored"}])
    assert body.effective_content == "cli-shape"
