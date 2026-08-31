"""Tests for the activity-context-document loader + injector callbacks (1.1.87 M1).

Mirrors ``test_activity_image_callbacks`` (the twin this copies): the stored-content
read (``db.curriculum.get_curriculum_content``) is patched, and the session
``save_artifact``/``load_artifact`` are backed by an in-memory dict so the injector
sees what the loader saved.

The load-bearing assertions are the two that encode the 21-August report: a
``kind="curriculum"`` material must NOT be injected (the two kinds must not merge),
and the injected text must arrive in ``llm_request.contents`` — asserted on the
request, not on a mock's call count.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from google.genai.types import Content, Part

from adk.callbacks.activity_documents import (
    _STATE_DOCS_IN_CONTEXT,
    CONTEXT_CHAR_CAP,
    make_activity_document_injector,
    make_activity_document_loader,
)


def _ctx_material(doc_id: str, *, title: str = "", origin: str = ""):
    return SimpleNamespace(kind="context", doc_id=doc_id, title=title, origin=origin, material_id="")


def _curr_material(doc_id: str):
    return SimpleNamespace(kind="curriculum", doc_id=doc_id, title="", origin="", material_id="")


def _img_material(material_id: str):
    return SimpleNamespace(kind="image", doc_id="", title="", origin="", material_id=material_id)


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
    ctx._artifacts = arts
    return ctx


def _content_mock(text: str):
    return lambda doc_id: {"text": text, "chars": len(text)}


def _llm_request(user_text: str = "what is question 5 asking?") -> SimpleNamespace:
    return SimpleNamespace(contents=[Content(role="user", parts=[Part.from_text(text=user_text)])])


def _all_text(req) -> str:
    out = []
    for c in req.contents:
        for p in c.parts or []:
            if getattr(p, "text", None):
                out.append(p.text)
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


class TestActivityDocumentLoader:
    @pytest.mark.asyncio
    async def test_copies_stored_content_into_session(self, monkeypatch):
        monkeypatch.setattr(
            "db.curriculum.get_curriculum_content",
            _content_mock("Question 5: a ball is thrown at 30 degrees."),
        )
        loader = make_activity_document_loader(_cfg([_ctx_material("doc-a", title="Exam 2019")]))
        ctx = _make_ctx()
        await loader(ctx)

        ctx.save_artifact.assert_awaited_once()
        kw = ctx.save_artifact.call_args.kwargs
        assert kw["filename"] == "activity-doc:doc-a.json"
        payload = json.loads(kw["artifact"].inline_data.data.decode("utf-8"))
        assert payload["docId"] == "doc-a"
        assert payload["title"] == "Exam 2019"
        assert "30 degrees" in payload["text"]
        assert payload["truncated"] is False
        assert ctx.state[_STATE_DOCS_IN_CONTEXT] == ["doc-a"]

    @pytest.mark.asyncio
    async def test_curriculum_material_is_not_loaded(self, monkeypatch):
        """The two kinds must not merge — a RAG material stays on the RAG path."""
        content = MagicMock(side_effect=_content_mock("text"))
        monkeypatch.setattr("db.curriculum.get_curriculum_content", content)
        loader = make_activity_document_loader(_cfg([_curr_material("doc-a"), _img_material("img-1")]))
        ctx = _make_ctx()
        await loader(ctx)
        ctx.save_artifact.assert_not_called()
        content.assert_not_called()

    @pytest.mark.asyncio
    async def test_noop_when_cfg_none(self):
        loader = make_activity_document_loader(None)
        ctx = _make_ctx()
        await loader(ctx)
        ctx.save_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_idempotent_second_turn(self, monkeypatch):
        monkeypatch.setattr("db.curriculum.get_curriculum_content", _content_mock("Question 5"))
        loader = make_activity_document_loader(_cfg([_ctx_material("doc-a")]))
        ctx = _make_ctx()
        await loader(ctx)
        ctx.save_artifact.reset_mock()
        await loader(ctx)
        ctx.save_artifact.assert_not_called()
        assert ctx.state[_STATE_DOCS_IN_CONTEXT] == ["doc-a"]

    @pytest.mark.asyncio
    async def test_orphan_in_loaded_set_recopies(self, monkeypatch):
        """An id in state whose session artifact has vanished must re-copy."""
        monkeypatch.setattr("db.curriculum.get_curriculum_content", _content_mock("Question 5"))
        loader = make_activity_document_loader(_cfg([_ctx_material("doc-a")]))
        ctx = _make_ctx(state={_STATE_DOCS_IN_CONTEXT: ["doc-a"]})  # claims loaded, no artifact
        await loader(ctx)
        ctx.save_artifact.assert_awaited_once()
        assert ctx.state[_STATE_DOCS_IN_CONTEXT] == ["doc-a"]

    @pytest.mark.asyncio
    async def test_missing_stored_content_is_skipped_not_faked(self, monkeypatch):
        """A doc with no parsed content must NOT produce an artifact — the tutor
        proceeding as if it had the task is the failure this feature removes."""
        monkeypatch.setattr("db.curriculum.get_curriculum_content", lambda doc_id: None)
        loader = make_activity_document_loader(_cfg([_ctx_material("doc-a")]))
        ctx = _make_ctx()
        await loader(ctx)
        ctx.save_artifact.assert_not_called()
        assert ctx.state[_STATE_DOCS_IN_CONTEXT] == []

    @pytest.mark.asyncio
    async def test_over_cap_truncates_head_and_tail(self, monkeypatch):
        head = "HEAD-MARKER " + ("a" * CONTEXT_CHAR_CAP)
        text = head + "TAIL-MARKER"
        monkeypatch.setattr("db.curriculum.get_curriculum_content", _content_mock(text))
        loader = make_activity_document_loader(_cfg([_ctx_material("doc-a")]))
        ctx = _make_ctx()
        await loader(ctx)

        payload = json.loads(ctx.save_artifact.call_args.kwargs["artifact"].inline_data.data.decode("utf-8"))
        assert payload["truncated"] is True
        assert payload["text"].startswith("HEAD-MARKER")
        assert payload["text"].endswith("TAIL-MARKER")
        assert "omitted" in payload["text"]

    @pytest.mark.asyncio
    async def test_loader_survives_a_read_failure(self, monkeypatch):
        def _boom(doc_id):
            raise RuntimeError("firestore down")

        monkeypatch.setattr("db.curriculum.get_curriculum_content", _boom)
        loader = make_activity_document_loader(_cfg([_ctx_material("doc-a")]))
        ctx = _make_ctx()
        await loader(ctx)  # must not raise — a lesson does not stop for this
        assert ctx.state[_STATE_DOCS_IN_CONTEXT] == []


# ---------------------------------------------------------------------------
# Injector
# ---------------------------------------------------------------------------


class TestActivityDocumentInjector:
    async def _loaded_ctx(self, monkeypatch, text: str, *, title: str = "Exam 2019"):
        monkeypatch.setattr("db.curriculum.get_curriculum_content", _content_mock(text))
        cfg = _cfg([_ctx_material("doc-a", title=title)])
        ctx = _make_ctx()
        await make_activity_document_loader(cfg)(ctx)
        return cfg, ctx

    @pytest.mark.asyncio
    async def test_inlines_the_task_text_into_the_request(self, monkeypatch):
        cfg, ctx = await self._loaded_ctx(monkeypatch, "Question 5: a ball is thrown at 30 degrees.")
        req = _llm_request()
        await make_activity_document_injector(cfg)(ctx, req)

        text = _all_text(req)
        assert "Question 5: a ball is thrown at 30 degrees." in text
        assert "Exam 2019" in text  # names WHICH paper — the wrong-Question-5 fix
        assert "never ask the student to paste it in" in text
        # The student's own message stays last.
        assert req.contents[-1].parts[0].text == "what is question 5 asking?"

    @pytest.mark.asyncio
    async def test_truncation_is_declared_to_the_tutor(self, monkeypatch):
        cfg, ctx = await self._loaded_ctx(monkeypatch, "x" * (CONTEXT_CHAR_CAP + 500))
        req = _llm_request()
        await make_activity_document_injector(cfg)(ctx, req)
        assert "too long to include in full" in _all_text(req)

    @pytest.mark.asyncio
    async def test_noop_when_nothing_loaded(self, monkeypatch):
        cfg = _cfg([_ctx_material("doc-a")])
        ctx = _make_ctx()
        req = _llm_request()
        await make_activity_document_injector(cfg)(ctx, req)
        assert len(req.contents) == 1

    @pytest.mark.asyncio
    async def test_curriculum_only_activity_injects_nothing(self, monkeypatch):
        cfg = _cfg([_curr_material("doc-a")])
        ctx = _make_ctx(state={_STATE_DOCS_IN_CONTEXT: ["doc-a"]})
        req = _llm_request()
        await make_activity_document_injector(cfg)(ctx, req)
        assert len(req.contents) == 1

    @pytest.mark.asyncio
    async def test_skips_mid_turn_tool_roundtrip(self, monkeypatch):
        cfg, ctx = await self._loaded_ctx(monkeypatch, "Question 5")
        req = SimpleNamespace(
            contents=[
                Content(role="user", parts=[Part.from_text(text="hi")]),
                Content(
                    role="user",
                    parts=[Part.from_function_response(name="curriculum_retrieve", response={"chunks": []})],
                ),
            ]
        )
        await make_activity_document_injector(cfg)(ctx, req)
        assert len(req.contents) == 2

    @pytest.mark.asyncio
    async def test_reinjects_every_turn(self, monkeypatch):
        """The request is rebuilt from session events each turn, so the task must
        be re-inlined rather than persisted into history."""
        cfg, ctx = await self._loaded_ctx(monkeypatch, "Question 5")
        injector = make_activity_document_injector(cfg)
        for _ in range(2):
            req = _llm_request()
            await injector(ctx, req)
            assert "Question 5" in _all_text(req)
