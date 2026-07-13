"""Load a scored session's uploaded evidence for the rubric judges (RUBRIC-2 M2).

A competency judge should see the same material the tutor did — the uploaded
worksheet PDF, the teacher-attached diagram — not just the text transcript.
This module reconstructs that evidence for an OFFLINE scoring job (the judge is
not the live chat session) from the two durable stores the live pipeline wrote:

* **Documents** — parsed and stored in Firestore ``parsed_documents``, linked to
  the session via ``chat_sessions/{id}.documentIds``. Re-read with
  ``build_document_context`` (the same call the live document loader uses).
* **Activity images** — teacher-attached image materials in the MIME-agnostic
  durable artifact slot (keyed by ``material_id`` alone). The session's loaded
  material ids are recorded in ADK session state (``app:activity_images_loaded``);
  we read them from there and load each Part from the slot.

Everything is best-effort: a session with no uploads (or an unreachable store)
yields empty evidence and the judge scores the transcript alone — never an error.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

#: ADK session-state key the activity-image loader writes (mirror of
#: ``adk.callbacks.activity_images._STATE_IMAGES_LOADED``).
_STATE_IMAGES_LOADED = "app:activity_images_loaded"


@dataclass
class RubricEvidence:
    """The uploaded material a judge may reference for one session."""

    doc_texts: list[str] = field(default_factory=list)
    doc_refs: list[str] = field(default_factory=list)
    image_parts: list[Any] = field(default_factory=list)  # google.genai Part objects
    image_refs: list[str] = field(default_factory=list)

    @property
    def refs(self) -> list[str]:
        """Stable ids of every piece of evidence included (for provenance)."""
        return [f"doc:{d}" for d in self.doc_refs] + [f"image:{m}" for m in self.image_refs]

    def has_any(self) -> bool:
        return bool(self.doc_texts or self.image_parts)


async def _image_material_ids(session_id: str, owner_uid: str) -> list[str]:
    """Material ids of the activity images this session loaded (best-effort).

    Read from ADK session state; returns ``[]`` when the session/state can't be
    reached (an ended session whose state was compacted, no GCP creds, etc.).
    """
    try:
        from adk.agui import APP_NAME
        from adk.session import get_session_service

        session = await get_session_service().get_session(app_name=APP_NAME, user_id=owner_uid, session_id=session_id)
        if session is None:
            return []
        ids = (session.state or {}).get(_STATE_IMAGES_LOADED) or []
        return [str(i) for i in ids]
    except Exception as exc:
        logger.warning("rubric evidence: image-material lookup failed for %s: %s", session_id, exc)
        return []


async def load_session_evidence(session_id: str, activity_id: str = "") -> RubricEvidence:
    """Reconstruct a session's uploaded documents + images for the judge.

    Never raises — a store miss degrades to empty evidence.
    """
    from db.chat_sessions import get_session_index

    ev = RubricEvidence()
    idx = get_session_index(session_id)
    if idx is None:
        return ev

    # --- documents (re-read the parsed blocks the live loader saw) ---
    from tools.documents.context import build_document_context

    for doc_id in list(idx.document_ids):
        try:
            content, _blocks = build_document_context(doc_id, mode="blocks")
            if content:
                ev.doc_texts.append(content)
                ev.doc_refs.append(doc_id)
        except Exception as exc:
            logger.warning("rubric evidence: doc %s load failed: %s", doc_id, exc)

    # --- activity images (durable slot, keyed by material_id) ---
    from adk.activity_images import load_activity_image

    for material_id in await _image_material_ids(session_id, idx.owner_uid):
        try:
            part = await load_activity_image(
                teacher_uid=idx.owner_uid, activity_id=activity_id or idx.skill_id, material_id=material_id
            )
            if part is not None:
                ev.image_parts.append(part)
                ev.image_refs.append(material_id)
        except Exception as exc:
            logger.warning("rubric evidence: image %s load failed: %s", material_id, exc)

    return ev


def format_document_evidence(ev: RubricEvidence) -> str:
    """The document evidence as a prompt block (empty string when none)."""
    if not ev.doc_texts:
        return ""
    joined = "\n\n---\n\n".join(ev.doc_texts)
    return (
        "UPLOADED MATERIAL the student worked with (documents attached to this "
        "session — reference it as evidence where relevant):\n" + joined
    )


__all__ = ["RubricEvidence", "format_document_evidence", "load_session_evidence"]
