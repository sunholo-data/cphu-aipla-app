"""1.1.122 — a student's workbench IMAGE reaches the tutor as pixels.

One loader/injector pair (adk/callbacks/document.py) routes by type: a parsed
document becomes a JSON-blocks artifact inlined as text; an image record
becomes an image artifact inlined as an image Part with a label. The student
never picks the route — the record's ``mediaKind`` does.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.genai.types import Blob, Content, Part

from adk.callbacks import _STATE_DOCS_LOADED, make_document_injector, make_document_loader
from adk.callbacks.document import _STATE_DOC_IMAGE_LABELS, _image_artifact_name, _text_artifact_name

_PNG = b"\x89PNG\r\n\x1a\nfake-pixels"

_IMAGE_ROW = {
    "mediaKind": "image",
    "sourceFormat": "png",
    "originalFilename": "ligning.png",
    "sourceUrl": "gs://bucket/users/anon-g/docs/f/ligning.png",
    "parseStatus": "parsed",
    "blocks": [],
}
_TEXT_ROW = {
    "mediaKind": "document",
    "sourceFormat": "pdf",
    "originalFilename": "rapport.pdf",
    "parseStatus": "parsed",
}
_BLOCKS = [{"type": "paragraph", "text": "F = ma", "page": 1, "block_id": "p1"}]


def _make_ctx(state: dict, artifacts: dict[str, Part] | None = None) -> MagicMock:
    arts: dict[str, Part] = dict(artifacts or {})
    ctx = MagicMock()
    ctx.state = state
    ctx.session = SimpleNamespace(id="sess-1")

    async def _load(*, filename: str):
        return arts.get(filename)

    async def _save(*, filename: str, artifact):
        arts[filename] = artifact

    ctx.load_artifact = AsyncMock(side_effect=_load)
    ctx.save_artifact = AsyncMock(side_effect=_save)
    ctx._arts = arts
    return ctx


def _request() -> SimpleNamespace:
    return SimpleNamespace(contents=[Content(role="user", parts=[Part.from_text(text="Er min udledning rigtig?")])])


class TestLoaderRoutesByType:
    @pytest.mark.asyncio
    async def test_image_record_becomes_an_image_artifact_and_never_touches_the_parser(self):
        ctx = _make_ctx({"document_ids": ["img1"]})
        with (
            patch("db.firestore.get_document", return_value=_IMAGE_ROW),
            patch("tools.documents.context.read_document_bytes", AsyncMock(return_value=_PNG)),
            patch("tools.documents.context.build_document_context") as build,
            patch("db.chat_sessions.add_session_documents"),
        ):
            await make_document_loader()(ctx)

        build.assert_not_called()
        art = ctx._arts[_image_artifact_name("img1")]
        assert art.inline_data.mime_type == "image/png"
        assert art.inline_data.data == _PNG
        assert _text_artifact_name("img1") not in ctx._arts
        assert ctx.state[_STATE_DOCS_LOADED] == ["img1"]
        assert ctx.state[_STATE_DOC_IMAGE_LABELS] == {"img1": "ligning.png"}

    @pytest.mark.asyncio
    async def test_a_pdf_tab_and_a_photo_tab_are_one_list(self):
        ctx = _make_ctx({"document_ids": ["pdf1", "img1"]})
        rows = {"pdf1": _TEXT_ROW, "img1": _IMAGE_ROW}
        with (
            patch("db.firestore.get_document", side_effect=lambda _c, d: rows[d]),
            patch("tools.documents.context.read_document_bytes", AsyncMock(return_value=_PNG)),
            patch("tools.documents.context.build_document_context", return_value=("", _BLOCKS)),
            patch("db.chat_sessions.add_session_documents"),
        ):
            await make_document_loader()(ctx)

        assert ctx.state[_STATE_DOCS_LOADED] == ["pdf1", "img1"]
        assert ctx._arts[_text_artifact_name("pdf1")].inline_data.mime_type == "application/json"
        assert ctx._arts[_image_artifact_name("img1")].inline_data.mime_type == "image/png"

    @pytest.mark.asyncio
    async def test_orphan_recovery_sees_an_image_artifact_as_present(self):
        # A prior-loaded image must not be dropped as an orphan just because
        # there is no doc:{id}.json behind it.
        img = Part(inline_data=Blob(data=_PNG, mime_type="image/png"))
        ctx = _make_ctx({"document_ids": ["img1"], _STATE_DOCS_LOADED: ["img1"]}, {_image_artifact_name("img1"): img})
        with patch("db.firestore.get_document") as get_doc:
            await make_document_loader()(ctx)
        get_doc.assert_not_called()  # nothing to (re)load
        assert ctx.state[_STATE_DOCS_LOADED] == ["img1"]


class TestInjectorRoutesByType:
    @pytest.mark.asyncio
    async def test_image_artifact_is_inlined_as_an_image_part_with_a_label(self):
        img = Part(inline_data=Blob(data=_PNG, mime_type="image/png"))
        ctx = _make_ctx(
            {_STATE_DOCS_LOADED: ["img1"], _STATE_DOC_IMAGE_LABELS: {"img1": "ligning.png"}},
            {_image_artifact_name("img1"): img},
        )
        req = _request()
        await make_document_injector()(ctx, req)

        # [label, pixels, the student's message]
        assert len(req.contents) == 3
        assert "ligning.png" in req.contents[0].parts[0].text
        assert "uploaded by the student" in req.contents[0].parts[0].text
        assert req.contents[1].parts[0].inline_data.mime_type == "image/png"
        assert req.contents[1].parts[0].inline_data.data == _PNG
        assert req.contents[-1].parts[0].text == "Er min udledning rigtig?"

    @pytest.mark.asyncio
    async def test_text_and_image_artifacts_coexist_in_one_request(self):
        text = Part(inline_data=Blob(data=json.dumps(_BLOCKS).encode(), mime_type="application/json"))
        img = Part(inline_data=Blob(data=_PNG, mime_type="image/png"))
        ctx = _make_ctx(
            {_STATE_DOCS_LOADED: ["pdf1", "img1"], _STATE_DOC_IMAGE_LABELS: {"img1": "ligning.png"}},
            {_text_artifact_name("pdf1"): text, _image_artifact_name("img1"): img},
        )
        req = _request()
        await make_document_injector()(ctx, req)

        texts = [p.text for c in req.contents for p in c.parts if p.text]
        assert any("F = ma" in t for t in texts), "the PDF's blocks were inlined as text"
        assert any(p.inline_data and p.inline_data.mime_type == "image/png" for c in req.contents for p in c.parts)

    @pytest.mark.asyncio
    async def test_the_grounding_strip_sees_the_injected_image(self):
        # agent.py strips grounding tools when the request carries an image
        # Part (Gemini 400s otherwise). The injected pixels must count.
        from adk.agent import _request_has_image_part

        img = Part(inline_data=Blob(data=_PNG, mime_type="image/png"))
        ctx = _make_ctx({_STATE_DOCS_LOADED: ["img1"]}, {_image_artifact_name("img1"): img})
        req = _request()
        assert not _request_has_image_part(req)
        await make_document_injector()(ctx, req)
        assert _request_has_image_part(req)
