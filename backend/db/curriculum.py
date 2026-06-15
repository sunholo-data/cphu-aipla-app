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


def _utcnow() -> datetime:
    return datetime.now(UTC)


def create_curriculum_doc(doc: CurriculumDoc) -> None:
    set_document(_COLLECTION, doc.doc_id, doc.model_dump(by_alias=True, mode="json"))


def get_curriculum_doc(doc_id: str) -> CurriculumDoc | None:
    raw = get_document(_COLLECTION, doc_id)
    return CurriculumDoc.model_validate(raw) if raw else None


def delete_curriculum_doc(doc_id: str) -> None:
    delete_document(_COLLECTION, doc_id)


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
        docs = [d for d in docs if (d.topic or "").lower() == topic.lower()]
    # Level-less (unfiled) docs sort after A/B/C; None can't compare to str.
    docs.sort(key=lambda d: (d.level or "Z", d.title.lower()))
    return docs
