"""before_agent_callback and before_model_callback for document context.

  * ``make_document_loader``  — loads attached document blocks into ADK
    session artifacts on the first turn they appear (incremental, idempotent).
  * ``make_document_injector`` — inlines loaded document artifacts directly
    into the LLM request so Gemini can't skip them via flaky tool-discovery.

State keys written to session state (shared with session.py consumers):
  _STATE_DOCS_LOADED     — list[str] of successfully loaded doc_ids
  _STATE_DOC_LOAD_ERROR  — dict[str, str] per-doc error strings
  _STATE_RESUMED_SESSION — bool set by frontend when resuming a thread
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Frontend sets this to True when the user enters a chat by clicking a
# conversation thread from the per-document Conversations panel.
_STATE_RESUMED_SESSION = "app:resumed_session"
# Tracks which doc ids have been *successfully loaded as artifacts*.
_STATE_DOCS_LOADED = "app:docs_loaded"
# Map of doc_id -> error string for any doc that failed to load.
_STATE_DOC_LOAD_ERROR = "app:doc_load_error"


def make_document_loader() -> Any:
    """Return a before_agent_callback that loads document blocks into session artifacts.

    Reads ``document_ids`` (list[str]) from session state — set by skill_processor
    when one or more documents are attached to the request. Saves each as a
    separate session-scoped artifact ``doc:{id}.json`` (application/json) which
    ``load_artifacts_tool`` auto-injects into the model's context.

    Incremental: tracks loaded ids in ``app:docs_loaded`` so when the user adds
    a tab mid-session we only load the *new* doc, and a failed doc isn't retried
    every turn. Failures are recorded per-doc in ``app:doc_load_error`` — non-fatal.
    """

    async def _loader(callback_context: Any) -> None:
        state = getattr(callback_context, "state", None)
        if state is None:
            logger.info("doc loader: skipped — callback_context.state is None")
            return

        document_ids: list[str] = list(state.get("document_ids") or [])
        loaded_raw: list[str] = list(state.get(_STATE_DOCS_LOADED) or [])

        # WARNING level (not INFO) so this single forensic line surfaces in
        # .dev-logs/backend.log without re-configuring Python's root logger.
        # See docs/design/v6.1.0/multi-doc-context-fix.md (1.22) — D1.
        logger.warning(
            "doc loader: turn start — document_ids=%s prior loaded=%s",
            document_ids,
            loaded_raw,
        )

        # Self-heal sessions stranded by the pre-2026-04-28 loader, where a
        # failed load still appended the id to _STATE_DOCS_LOADED. Probe each
        # prior-loaded id; drop ones whose artifact is missing so they re-load.
        loaded: list[str] = []
        orphans: list[str] = []
        for doc_id in loaded_raw:
            try:
                art = await callback_context.load_artifact(filename=f"doc:{doc_id}.json")
            except Exception as exc:
                logger.warning("doc loader: orphan probe error for %s: %s", doc_id, exc)
                orphans.append(doc_id)
                continue
            if art is None or getattr(art, "inline_data", None) is None:
                orphans.append(doc_id)
                continue
            loaded.append(doc_id)
        if orphans:
            logger.warning(
                "doc loader: dropping %d orphaned id(s) from app:docs_loaded "
                "(no artifact behind them) — will re-load: %s",
                len(orphans),
                orphans,
            )
        loaded_set = set(loaded)

        to_load = [d for d in document_ids if d and d not in loaded_set]
        if not to_load:
            state[_STATE_DOCS_LOADED] = loaded
            logger.info("doc loader: nothing to load — verified loaded=%s", loaded)
            return

        logger.info("doc loader: will load %d new doc(s): %s", len(to_load), to_load)

        from google.genai.types import Blob, Part

        from tools.documents.context import build_document_context

        errors: dict[str, str] = dict(state.get(_STATE_DOC_LOAD_ERROR) or {})
        successfully_loaded: list[str] = []

        for doc_id in to_load:
            try:
                _content, blocks = build_document_context(doc_id, mode="blocks")
                if not blocks:
                    errors[doc_id] = (
                        "Document has no parsed content. Re-upload the document to make it available to the AI."
                    )
                    logger.warning("document loader: no blocks for doc:%s — skipping artifact", doc_id)
                    continue
                artifact = Part(
                    inline_data=Blob(
                        data=json.dumps(blocks).encode("utf-8"),
                        mime_type="application/json",
                    )
                )
                await callback_context.save_artifact(
                    filename=f"doc:{doc_id}.json",
                    artifact=artifact,
                )
                successfully_loaded.append(doc_id)
                errors.pop(doc_id, None)
                logger.info(
                    "document artifact saved: doc:%s.json (%d blocks)",
                    doc_id,
                    len(blocks),
                )
            except Exception as exc:
                logger.warning("document loader failed for %s: %s", doc_id, exc)
                errors[doc_id] = str(exc)

        loaded.extend(successfully_loaded)
        state[_STATE_DOCS_LOADED] = loaded
        if errors:
            state[_STATE_DOC_LOAD_ERROR] = errors
        elif _STATE_DOC_LOAD_ERROR in state:
            state[_STATE_DOC_LOAD_ERROR] = {}

        # Stranded-session-prevention (1.23) Option 2: when turn 1 requests docs
        # and EVERY one fails, this single ERROR is the greppable signal.
        if to_load and not successfully_loaded and not loaded_raw:
            session_for_log = getattr(callback_context, "session", None)
            session_id_for_log = getattr(session_for_log, "id", "?") if session_for_log else "?"
            logger.error(
                "doc loader: TURN-1 INVARIANT VIOLATED — session=%s requested %d doc(s) "
                "%s but every load failed (%s). Session row will have documentIds=[] "
                "and will not appear in any per-doc Conversations panel until a "
                "subsequent turn succeeds.",
                session_id_for_log,
                len(to_load),
                to_load,
                list(errors),
            )

        if successfully_loaded:
            session = getattr(callback_context, "session", None)
            session_id = getattr(session, "id", None) if session else None
            if session_id:
                try:
                    from db.chat_sessions import add_session_documents

                    add_session_documents(session_id, successfully_loaded)
                except Exception as exc:
                    logger.warning(
                        "failed to update chat_sessions/%s documentIds: %s",
                        session_id,
                        exc,
                    )

    return _loader


def make_document_injector() -> Any:
    """Return a ``before_model_callback`` that eagerly inlines loaded
    documents into the LLM request whenever any documents are attached
    to the session.

    Why: ADK's standard ``load_artifacts_tool`` makes the agent decide
    whether to call it — and Gemini sometimes calls it with empty
    ``artifact_names``, in which case nothing actually reaches the model
    and the agent confidently says "you haven't provided a document".
    The user has *signalled* intent by attaching the document (clicking
    a doc tab, or resuming a thread that had docs attached), so we skip
    that gamble and put the blocks directly in the LLM request.

    Per-turn behaviour: only fires for the first model call of each turn
    (when the trailing content is the user's text, not a tool
    function_response) so we don't re-inject during in-turn tool
    roundtrips. Each turn's request is rebuilt from session events, so
    we have to inject again on every user turn — the alternative
    (persisting injected content into events) would bloat history.
    """

    async def _injector(callback_context: Any, llm_request: Any) -> None:
        # TTFT: mark the end of the before-model chain on every entry.
        from observability.timing import STAGE_BEFORE_MODEL_DONE, get_current_tracker

        get_current_tracker().mark(STAGE_BEFORE_MODEL_DONE, user_label="Thinking…")

        state = getattr(callback_context, "state", None)
        if state is None:
            logger.info("doc injector: skipped — state is None")
            return

        loaded: list[str] = list(state.get(_STATE_DOCS_LOADED) or [])
        if not loaded:
            logger.info(
                "doc injector: skipped — app:docs_loaded is empty (document_ids=%s)",
                state.get("document_ids"),
            )
            return

        contents = getattr(llm_request, "contents", None)
        if not contents:
            logger.info("doc injector: skipped — llm_request.contents empty")
            return
        last = contents[-1]
        if getattr(last, "role", None) != "user":
            logger.info(
                "doc injector: skipped — trailing content role=%s (not 'user')",
                getattr(last, "role", None),
            )
            return
        last_parts = getattr(last, "parts", None) or []
        if any(getattr(p, "function_response", None) for p in last_parts):
            logger.info("doc injector: skipped — mid-turn tool round-trip")
            return

        from google.genai.types import Content, Part

        injected = 0
        for doc_id in loaded:
            try:
                artifact = await callback_context.load_artifact(filename=f"doc:{doc_id}.json")
            except Exception as exc:
                logger.warning("doc injector: load_artifact failed for %s: %s", doc_id, exc)
                continue
            if not artifact or not getattr(artifact, "inline_data", None):
                logger.warning(
                    "doc injector: artifact missing for %s — orphan in app:docs_loaded "
                    "(loader's orphan recovery will retry next turn)",
                    doc_id,
                )
                continue
            data = artifact.inline_data.data
            if not data:
                logger.warning("doc injector: artifact empty for %s", doc_id)
                continue
            blocks_json = data.decode("utf-8", errors="replace") if isinstance(data, bytes | bytearray) else str(data)
            doc_content = Content(
                role="user",
                parts=[
                    Part.from_text(
                        text=(f"[Attached document: doc:{doc_id}.json — provided by the user]\n{blocks_json}")
                    )
                ],
            )
            contents.insert(-1, doc_content)
            injected += 1

        logger.info(
            "doc injector: prepended %d/%d document(s) to LLM request (loaded=%s)",
            injected,
            len(loaded),
            loaded,
        )

    return _injector
