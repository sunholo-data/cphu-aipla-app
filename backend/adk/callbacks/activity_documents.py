"""before_agent + before_model callbacks for activity CONTEXT materials (1.1.87).

The third twin. The pattern already runs on two paths:

  1. ``adk/callbacks/document.py``        — a student's attached document (text).
  2. ``adk/callbacks/activity_images.py`` — a teacher's activity image (image Part).

This is the missing one: **a teacher's activity document**, the task the student is
actually working on. A ``MaterialRef`` with ``kind="context"`` is copied into the
student's session at session start and inlined as text on every turn, so the tutor
HAS it rather than being able to look it up.

Why it exists: a teacher built a lesson on "students work past Physics A exam
questions with the tutor" and cited the papers as materials. Materials are
``kind="curriculum"``, which reaches the tutor as a ``VertexAiRagRetrieval`` tool it
must *choose* to call, over similarity-ranked chunks. So the tutor did not look, and
when pushed it discussed a **different paper's** Question 5 — three papers, three
Question 5s, and nothing for embedding distance to prefer the cited one by. No 500,
no log line: the activity simply did not do the thing it was built to do. Retrieval
is right for a reference corpus and wrong for the task at hand.

**Where the bytes come from — ``doc_id``, not a second store.** 1.1.33 M3 already
persists each curriculum doc's parsed text at ``curriculum_content/{doc_id}``
(``db.curriculum.get_curriculum_content``), so a context material is the SAME
uploaded document as a curriculum one, attached by a different mechanism. The
teacher flips a toggle; nothing is re-uploaded and no bytes are duplicated. This is
also why the durable-slot key question that bit 1.1.44 on 2026-06-30 does not arise
here: ``doc_id`` is the document's identity everywhere in the system, and both the
citation and the loader hold that same id.

Why copy into the session rather than read Firestore every turn: it makes the task a
normal session artifact — observable in the ADK web UI and to ``adk eval``, and one
read per session instead of one per turn. Same rationale as 1.1.44.

**Truncation.** An always-injected document is a cost on *every* turn for the rest of
the session (Axiom 4). Over-cap text is truncated head-plus-tail and the tutor is
TOLD it was, reusing the 1.1.73 student-writing shape — a tutor that knows it is
holding half a paper says so; one that does not comments confidently on the half it
has, which is the failure this whole doc exists to remove.

State key:
  ``app:activity_docs_loaded`` — list[str] of doc_ids copied into this session.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

_STATE_DOCS_IN_CONTEXT = "app:activity_docs_loaded"

# Per-material character cap. A context material is re-inlined on EVERY turn, so
# this is a per-turn prompt cost multiplied by the length of the session, not a
# one-off. ~24k chars is roughly a 10-page exam paper — comfortably more than any
# single task, and well short of a textbook someone attached by mistake. The
# head-plus-tail split mirrors WRITING_PUSH_CHAR_CAP (1.1.73): the beginning and
# the end of a paper both carry structure worth keeping.
CONTEXT_CHAR_CAP = 24_000
_HEAD_SHARE = 0.7

_TRUNCATION_MARKER = "\n\n[… middle of this document omitted — it exceeded the in-context size limit …]\n\n"


def _context_materials(active_cfg: Any) -> list[Any]:
    """The activity's context materials (empty when no config / none attached)."""
    if active_cfg is None:
        return []
    return [
        m
        for m in (active_cfg.materials or [])
        if getattr(m, "kind", "curriculum") == "context" and getattr(m, "doc_id", "")
    ]


def _session_filename(doc_id: str) -> str:
    return f"activity-doc:{doc_id}.json"


def _truncate(text: str) -> tuple[str, bool]:
    """Head-plus-tail truncation to ``CONTEXT_CHAR_CAP`` (1.1.73 shape).

    Returns ``(text, truncated)`` — the flag is what lets the injector tell the
    tutor it is holding a partial document.
    """
    if len(text) <= CONTEXT_CHAR_CAP:
        return text, False
    head = int(CONTEXT_CHAR_CAP * _HEAD_SHARE)
    tail = CONTEXT_CHAR_CAP - head
    return text[:head] + _TRUNCATION_MARKER + text[-tail:], True


def make_activity_document_loader(active_cfg: Any) -> Any:
    """Return a ``before_agent_callback`` that copies the activity's context
    materials into this student's session artifacts.

    ``active_cfg`` is the already-resolved ``ActivityConfig`` (or ``None``) — the
    agent factory resolves it once for ``{teacher_focus}`` + curriculum, so we reuse
    it (no extra Firestore read for the config itself).

    Idempotent across turns and orphan-recovering, mirroring the document and image
    loaders: an id whose session artifact has vanished is dropped so it re-copies.
    """
    materials = _context_materials(active_cfg)

    async def _loader(callback_context: Any) -> None:
        if not materials:
            return
        state = getattr(callback_context, "state", None)
        if state is None:
            return

        loaded_raw: list[str] = list(state.get(_STATE_DOCS_IN_CONTEXT) or [])

        # Orphan recovery: drop ids whose session artifact has vanished so they
        # re-copy (mirrors the document + image loaders' self-heal).
        loaded: list[str] = []
        for doc_id in loaded_raw:
            try:
                art = await callback_context.load_artifact(filename=_session_filename(doc_id))
            except Exception as exc:
                logger.warning("activity doc loader: orphan probe error for %s: %s", doc_id, exc)
                continue
            if art is None or getattr(art, "inline_data", None) is None:
                continue
            loaded.append(doc_id)
        loaded_set = set(loaded)

        to_load = [m for m in materials if m.doc_id not in loaded_set]
        if not to_load:
            state[_STATE_DOCS_IN_CONTEXT] = loaded
            return

        from google.genai.types import Blob, Part

        from db.curriculum import get_curriculum_content

        for m in to_load:
            doc_id = m.doc_id
            try:
                content = get_curriculum_content(doc_id)
                text = ((content or {}).get("text") or "").strip()
                if not text:
                    # Graceful degradation (Axiom 5): a doc ingested before parsed
                    # content was stored, or one whose parse produced nothing. Say
                    # so loudly — the tutor proceeding as if it had the task is
                    # exactly the failure 1.1.87 removes.
                    logger.warning(
                        "activity doc loader: no stored content for doc=%s (activity=%s) — "
                        "the tutor will NOT have this task. Re-upload the document.",
                        doc_id,
                        getattr(active_cfg, "activity_id", "?"),
                    )
                    continue
                text, truncated = _truncate(text)
                payload = {
                    "docId": doc_id,
                    "title": (getattr(m, "title", "") or getattr(m, "origin", "") or doc_id),
                    "text": text,
                    "truncated": truncated,
                }
                artifact = Part(
                    inline_data=Blob(
                        data=json.dumps(payload).encode("utf-8"),
                        mime_type="application/json",
                    )
                )
                await callback_context.save_artifact(filename=_session_filename(doc_id), artifact=artifact)
                loaded.append(doc_id)
                logger.info(
                    "activity context doc copied into session: %s (activity=%s, %d chars, truncated=%s)",
                    doc_id,
                    getattr(active_cfg, "activity_id", "?"),
                    len(text),
                    truncated,
                )
            except Exception as exc:
                logger.warning("activity doc loader failed for %s: %s", doc_id, exc)

        state[_STATE_DOCS_IN_CONTEXT] = loaded

    return _loader


def make_activity_document_injector(active_cfg: Any) -> Any:
    """Return a ``before_model_callback`` that inlines loaded context materials as
    text (twin of ``make_activity_image_injector``, which inlines image Parts).

    Per-turn: only the first model call of a turn (trailing content is the user's
    text, not a tool response). The request is rebuilt from session events each
    turn, so we re-inject every turn rather than persist the task into history.
    """
    materials = _context_materials(active_cfg)

    async def _injector(callback_context: Any, llm_request: Any) -> None:
        if not materials:
            return
        state = getattr(callback_context, "state", None)
        if state is None:
            return
        loaded: list[str] = list(state.get(_STATE_DOCS_IN_CONTEXT) or [])
        if not loaded:
            return

        contents = getattr(llm_request, "contents", None)
        if not contents:
            return
        last = contents[-1]
        if getattr(last, "role", None) != "user":
            return
        last_parts = getattr(last, "parts", None) or []
        if any(getattr(p, "function_response", None) for p in last_parts):
            return  # mid-turn tool round-trip

        from google.genai.types import Content, Part

        injected = 0
        for doc_id in loaded:
            try:
                art = await callback_context.load_artifact(filename=_session_filename(doc_id))
            except Exception as exc:
                logger.warning("activity doc injector: load failed for %s: %s", doc_id, exc)
                continue
            if not art or not getattr(art, "inline_data", None):
                continue
            data = art.inline_data.data
            if not data:
                continue
            try:
                payload = json.loads(data.decode("utf-8") if isinstance(data, bytes | bytearray) else str(data))
            except Exception as exc:
                logger.warning("activity doc injector: unreadable artifact for %s: %s", doc_id, exc)
                continue

            title = payload.get("title") or doc_id
            # The label is doing real work: it names WHICH document this is, so a
            # student asking about "Question 5" gets this paper's Question 5 rather
            # than a similar-looking one, and it says plainly that the tutor already
            # has the task — the tutor asking students to paste the text in was half
            # the original report.
            header = (
                f"[Task material for this activity: {title} — attached by the teacher. "
                f"This is the task the student is working on; you already have it, "
                f"so never ask the student to paste it in.]"
            )
            if payload.get("truncated"):
                header += (
                    "\n[NOTE: this document was too long to include in full — the middle is "
                    "missing. If the student asks about a part you cannot see, say so rather "
                    "than guessing.]"
                )
            doc_content = Content(
                role="user",
                parts=[Part.from_text(text=f"{header}\n{payload.get('text') or ''}")],
            )
            contents.insert(-1, doc_content)
            injected += 1

        logger.info("activity doc injector: inlined %d/%d context material(s)", injected, len(loaded))

    return _injector
