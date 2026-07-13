"""Firestore CRUD for the curriculum library (1.1.25 M1).

Metadata only — the parsed text lives in the ADK RAG corpus (M2). ACL is
deny-by-default and applied at query time: a teacher sees ``shared`` + their
OWN docs; students never browse the open corpus (they only get an activity's
cited materials via the tutor, M3).
"""

from __future__ import annotations

import logging
import os
import time
from datetime import UTC, datetime

from db.firestore import delete_document, get_document, query_documents, set_document
from db.models.curriculum import SHARED_SCOPE, CurriculumDoc, CurriculumFolder, StxLevel, normalize_tags

logger = logging.getLogger(__name__)

_COLLECTION = "curriculum_docs"
# 1.1.58 M3 — flat folders, keyed by ownerScope like the docs themselves.
_FOLDER_COLLECTION = "curriculum_folders"
# Sentinel folder filter value → docs with NO folder ("Unfiled" rail chip).
UNFILED = "__unfiled__"
# 1.1.33 M3 — the parsed text, kept SEPARATE from the metadata doc so browse/list
# queries stay light. Read on demand when a student opens a shared doc.
_CONTENT_COLLECTION = "curriculum_content"
# Cap the stored text well under Firestore's 1 MB doc limit. The full length is
# stored too, so the viewer can flag truncation.
_CONTENT_CAP = 200_000

# 1.1.59 — read-through cache for the SHARED corpus only. The shared cleared
# library grows to thousands, is read-mostly (admin ingest/delete), and is
# identical for every teacher — so re-reading + re-deserialising it on every
# browse is the dominant cost. We cache ONLY ``ownerScope == SHARED_SCOPE`` docs;
# a teacher's private docs are fetched live and unioned per request, so this
# process-global cache can never hold or leak private data (SECURE BY
# CONSTRUCTION). A short TTL bounds cross-instance staleness; any shared write
# invalidates the same instance immediately. Set the TTL env to 0 to disable.
_SHARED_TTL_S = float(os.getenv("CURRICULUM_SHARED_CACHE_TTL_S", "120"))
_shared_cache: dict = {"docs": None, "expires": 0.0}


def _monotonic() -> float:
    """Indirection so tests can advance the clock without real sleeps."""
    return time.monotonic()


def _load_shared() -> list[CurriculumDoc]:
    """Return the validated shared corpus, from cache when warm (0 Firestore
    reads) or a single ``ownerScope == shared`` query on miss/expiry."""
    cached = _shared_cache["docs"]
    if cached is not None and _monotonic() < _shared_cache["expires"]:
        return cached
    raw = query_documents(_COLLECTION, filters=[("ownerScope", "==", SHARED_SCOPE)])
    docs = [CurriculumDoc.model_validate(d) for d in raw]
    _shared_cache["docs"] = docs
    _shared_cache["expires"] = _monotonic() + _SHARED_TTL_S
    logger.info("curriculum shared cache MISS: cached %d docs (ttl=%ss)", len(docs), _SHARED_TTL_S)
    return docs


def invalidate_shared_cache() -> None:
    """Drop the cached shared corpus — call after any write/delete of a SHARED doc
    so the next browse re-reads it."""
    _shared_cache["docs"] = None
    _shared_cache["expires"] = 0.0


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
    # 1.1.59 — a write to a SHARED doc (ingest / tag-edit / summary backfill) must
    # invalidate the cached corpus so the next browse reflects it. Own-doc writes
    # never touch the cache (own docs aren't cached).
    if doc.owner_scope == SHARED_SCOPE:
        invalidate_shared_cache()


def get_curriculum_doc(doc_id: str) -> CurriculumDoc | None:
    raw = get_document(_COLLECTION, doc_id)
    return CurriculumDoc.model_validate(raw) if raw else None


def delete_curriculum_doc(doc_id: str) -> None:
    delete_document(_COLLECTION, doc_id)
    # 1.1.59 — deletes are rare; invalidate unconditionally rather than plumb the
    # doc's scope to every call site. Worst case is one extra cache miss.
    invalidate_shared_cache()


def delete_curriculum_content(doc_id: str) -> None:
    """Remove the stored parsed text for *doc_id* (the M3 display copy)."""
    delete_document(_CONTENT_COLLECTION, doc_id)


def list_curriculum_for_teacher(
    teacher_uid: str,
    *,
    level: StxLevel | None = None,
    topic: str | None = None,
    tags: list[str] | None = None,
    subject: str | None = None,
    folder_id: str | None = None,
    scope: str | None = None,
) -> list[CurriculumDoc]:
    """ACL-scoped browse for a teacher: ``shared`` + their own docs.

    ``scope`` narrows within that allow-set: ``"shared"`` → only shared,
    ``"mine"`` → only the teacher's own, ``None`` → both. ``level`` / ``topic`` /
    ``tags`` / ``subject`` / ``folder_id`` filter the result. ``topic`` is a
    free-text search; ``tags`` is an AND facet; ``subject`` / ``folder_id`` are
    exact-match facets. Sorted by (level, title).
    """
    # 1.1.59 — shared corpus from the read-through cache (0 reads when warm); own
    # docs always live (few, and a just-uploaded doc must show immediately).
    docs: list[CurriculumDoc] = []
    if scope in (None, "shared"):
        docs += _load_shared()
    if scope in (None, "mine"):
        raw_own = query_documents(_COLLECTION, filters=[("ownerScope", "==", teacher_uid)])
        docs += [CurriculumDoc.model_validate(d) for d in raw_own]

    if level:
        docs = [d for d in docs if d.level == level]
    if subject:
        docs = [d for d in docs if d.subject == subject]
    if folder_id:
        if folder_id == UNFILED:
            docs = [d for d in docs if not d.folder_id]
        else:
            docs = [d for d in docs if d.folder_id == folder_id]
    if tags:
        # AND facet: a doc matches only if it carries EVERY selected tag. Tags in
        # the store are canonical (lowercased) — normalize the query side too so a
        # chip click and a CLI flag compare identically.
        want = set(normalize_tags(tags))
        docs = [d for d in docs if want <= set(d.tags)]
    if topic:
        # Free-text search: case-insensitive SUBSTRING match across the fields a
        # teacher would expect a search box to cover — title, topic, the catalogue
        # summary, and tags. NOT an exact equality on `topic` alone (the old bug:
        # "atomer" never matched "Atomer og molekyler", and topic-less uploads —
        # every teacher upload — were unsearchable). Content isn't searched here;
        # that's the RAG path. Multi-word queries match when EVERY term appears
        # somewhere in the haystack (AND), so "atom kemi" narrows rather than ORs.
        needles = topic.lower().split()
        docs = [
            d
            for d in docs
            if all(term in f"{d.title} {d.topic or ''} {d.summary} {' '.join(d.tags)}".lower() for term in needles)
        ]
    # Level-less (unfiled) docs sort after A/B/C; None can't compare to str.
    docs.sort(key=lambda d: (d.level or "Z", d.title.lower()))
    return docs


def distinct_tags_for_teacher(teacher_uid: str, *, scope: str | None = None) -> list[str]:
    """Distinct, sorted tags across the docs a teacher can see (for facet chips).

    Computed from the same ACL-scoped set as the browse — so the chip row can
    never offer a tag the teacher isn't allowed to see.
    """
    docs = list_curriculum_for_teacher(teacher_uid, scope=scope)
    return sorted({t for d in docs for t in d.tags})


def distinct_subjects_for_teacher(teacher_uid: str, *, scope: str | None = None) -> list[str]:
    """Distinct, sorted subjects present across the docs a teacher can see (1.1.58
    M2) — the facet-chip source, ACL-scoped like the tags variant."""
    docs = list_curriculum_for_teacher(teacher_uid, scope=scope)
    return sorted({d.subject for d in docs if d.subject})


# ---------------------------------------------------------------------------
# 1.1.58 M3 — folders (flat, keyed by ownerScope like the docs)
# ---------------------------------------------------------------------------


def create_curriculum_folder(folder: CurriculumFolder) -> None:
    set_document(_FOLDER_COLLECTION, folder.folder_id, folder.model_dump(by_alias=True, mode="json"))


def get_curriculum_folder(folder_id: str) -> CurriculumFolder | None:
    raw = get_document(_FOLDER_COLLECTION, folder_id)
    return CurriculumFolder.model_validate(raw) if raw else None


def list_curriculum_folders_for_teacher(teacher_uid: str, *, scope: str | None = None) -> list[CurriculumFolder]:
    """Folders visible to a teacher: shared + their own, ACL-scoped exactly like
    the docs. ``doc_count`` is computed here from the visible doc set (never
    stored → can't drift). Sorted by name."""
    raw: list[dict] = []
    if scope in (None, "shared"):
        raw += query_documents(_FOLDER_COLLECTION, filters=[("ownerScope", "==", SHARED_SCOPE)])
    if scope in (None, "mine"):
        raw += query_documents(_FOLDER_COLLECTION, filters=[("ownerScope", "==", teacher_uid)])

    folders = [CurriculumFolder.model_validate(f) for f in raw]
    # Count docs per folder from the same ACL-scoped set (cheap: shared is cached).
    docs = list_curriculum_for_teacher(teacher_uid, scope=scope)
    counts: dict[str, int] = {}
    for d in docs:
        if d.folder_id:
            counts[d.folder_id] = counts.get(d.folder_id, 0) + 1
    for f in folders:
        f.doc_count = counts.get(f.folder_id, 0)
    folders.sort(key=lambda f: f.name.lower())
    return folders
