"""Firestore CRUD for the curriculum library (1.1.25 M1).

Metadata only — the parsed text lives in the ADK RAG corpus (M2). ACL is
deny-by-default and applied at query time: a teacher sees ``shared`` + their
OWN docs; students never browse the open corpus (they only get an activity's
cited materials via the tutor, M3).
"""

from __future__ import annotations

from datetime import UTC, datetime

from db.firestore import delete_document, get_document, query_documents, set_document
from db.models.curriculum import SHARED_SCOPE, CurriculumDoc, StxLevel

_COLLECTION = "curriculum_docs"
# 1.1.33 M3 — the parsed text, kept SEPARATE from the metadata doc so browse/list
# queries stay light. Read on demand when a student opens a shared doc.
_CONTENT_COLLECTION = "curriculum_content"
# Cap the stored text well under Firestore's 1 MB doc limit. The full length is
# stored too, so the viewer can flag truncation.
_CONTENT_CAP = 200_000


def _utcnow() -> datetime:
    return datetime.now(UTC)


def set_curriculum_content(doc_id: str, text: str) -> None:
    """Store the parsed text for *doc_id* (capped) so it can be displayed later.

    Separate from the metadata doc — only fetched when a student opens the doc.
    """
    set_document(
        _CONTENT_COLLECTION,
        doc_id,
        {"text": text[:_CONTENT_CAP], "chars": len(text)},
    )


def get_curriculum_content(doc_id: str) -> dict | None:
    """Return ``{text, chars}`` for *doc_id*, or None if no content was stored
    (e.g. a doc ingested before content storage existed — re-upload to view)."""
    return get_document(_CONTENT_COLLECTION, doc_id)


def create_curriculum_doc(doc: CurriculumDoc) -> None:
    set_document(_COLLECTION, doc.doc_id, doc.model_dump(by_alias=True, mode="json"))


def get_curriculum_doc(doc_id: str) -> CurriculumDoc | None:
    raw = get_document(_COLLECTION, doc_id)
    return CurriculumDoc.model_validate(raw) if raw else None


def delete_curriculum_doc(doc_id: str) -> None:
    delete_document(_COLLECTION, doc_id)


def delete_curriculum_content(doc_id: str) -> None:
    """Remove the stored parsed text for *doc_id* (the M3 display copy)."""
    delete_document(_CONTENT_COLLECTION, doc_id)


def list_curriculum_for_teacher(
    teacher_uid: str,
    *,
    level: StxLevel | None = None,
    topic: str | None = None,
    scope: str | None = None,
) -> list[CurriculumDoc]:
    """ACL-scoped browse for a teacher: ``shared`` + their own docs.

    ``scope`` narrows within that allow-set: ``"shared"`` → only shared,
    ``"mine"`` → only the teacher's own, ``None`` → both. ``level`` / ``topic``
    filter the result. Sorted by (level, title).
    """
    raw: list[dict] = []
    if scope in (None, "shared"):
        raw += query_documents(_COLLECTION, filters=[("ownerScope", "==", SHARED_SCOPE)])
    if scope in (None, "mine"):
        raw += query_documents(_COLLECTION, filters=[("ownerScope", "==", teacher_uid)])

    docs = [CurriculumDoc.model_validate(d) for d in raw]
    if level:
        docs = [d for d in docs if d.level == level]
    if topic:
        # Free-text search: case-insensitive SUBSTRING match across the fields a
        # teacher would expect a search box to cover — title, topic, and the
        # catalogue summary. NOT an exact equality on `topic` alone (the old bug:
        # "atomer" never matched "Atomer og molekyler", and topic-less uploads —
        # every teacher upload — were unsearchable). Content isn't searched here;
        # that's the RAG path. Multi-word queries match when EVERY term appears
        # somewhere in the haystack (AND), so "atom kemi" narrows rather than ORs.
        needles = topic.lower().split()
        docs = [d for d in docs if all(term in f"{d.title} {d.topic or ''} {d.summary}".lower() for term in needles)]
    # Level-less (unfiled) docs sort after A/B/C; None can't compare to str.
    docs.sort(key=lambda d: (d.level or "Z", d.title.lower()))
    return docs
