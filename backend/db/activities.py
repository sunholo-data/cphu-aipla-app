"""Firestore repository for the class-independent ``Activity`` (ALS-1 M0).

All I/O goes through ``db.firestore`` helpers. The doc id is the activity's own
``act-…`` id (a flat top-level collection), NOT a composite key — an activity
exists independently of any class and is assigned to classes via
``Class.activity_ids``.

This is the M0 replacement for the per-class ``activity_configs`` composite-key
store. The legacy store stays in place through the dual-read window (M0.2); this
module never deletes from it.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from db.firestore import get_document, query_documents, set_document, update_document
from db.models.activity import Activity, mint_activity_id
from db.models.curriculum import CurriculumDoc
from db.models.taxonomy import UNLEVELLED, UNLEVELLED_LABEL, normalize_tags

logger = logging.getLogger(__name__)

_COLLECTION = "activities"

# An empty facet set, shared so callers can treat "no materials" and "materials
# we cannot see" identically without allocating.
_NO_FACETS: dict[str, set[str]] = {"subjects": set(), "levels": set(), "tags": set()}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _to_firestore(activity: Activity) -> dict[str, Any]:
    """Pydantic → Firestore dict (camelCase keys, ISO timestamps)."""
    return activity.model_dump(by_alias=True, mode="json")


def _from_firestore(data: dict[str, Any]) -> Activity:
    """Firestore dict → Pydantic. Accepts both alias and snake_case."""
    return Activity.model_validate(data)


def save_activity(activity: Activity) -> Activity:
    """Create or overwrite an activity, stamping timestamps.

    The workhorse write used by create (caller mints the id), the backfill
    (M0.2 passes a fully-built ``Activity``), and edits. ``created_at`` is set
    once (preserved on re-save); ``updated_at`` is bumped every time.
    """
    now = _utcnow()
    stored = activity.model_copy(
        update={
            "created_at": activity.created_at or now,
            "updated_at": now,
        }
    )
    set_document(_COLLECTION, stored.activity_id, _to_firestore(stored))
    return stored


def create_activity(activity: Activity) -> Activity:
    """Persist a NEW activity, minting an ``act-…`` id when the caller left it blank.

    Convenience over ``save_activity`` for the create path: a route builds an
    ``Activity`` from the request body without knowing the id, and the repo mints
    one. An explicit id (e.g. an adopt-copy that wants provenance preserved) is
    honoured.
    """
    activity_id = activity.activity_id or mint_activity_id()
    return save_activity(activity.model_copy(update={"activity_id": activity_id}))


def copy_activity(source: Activity, *, new_owner_uid: str) -> Activity:
    """Deep-copy an activity into ``new_owner_uid``'s library — the shared
    primitive behind **duplicate** (own/published → your library) and **adopt**
    (another teacher's published → your library), ALS-SHARE M2/M3.3.

    Mints a fresh ``act-…`` id, sets ``owner_uid = new_owner_uid``, records
    provenance (``source_activity_id`` / ``source_owner_uid`` → the source), and
    resets to ``visibility = draft`` with fresh timestamps. Content (skill,
    artefact, elements, materials) is deep-copied; **class assignment is NOT
    carried** — a copy is an unassigned draft in its new owner's library.
    """
    copy = source.model_copy(
        deep=True,
        update={
            "activity_id": "",  # create_activity mints a fresh id
            "owner_uid": new_owner_uid,
            "source_activity_id": source.activity_id,
            "source_owner_uid": source.owner_uid,
            "visibility": "draft",
            "created_at": None,
            "updated_at": None,
            "deleted_at": None,
        },
    )
    return create_activity(copy)


def get_activity(activity_id: str, *, include_deleted: bool = False) -> Activity | None:
    """Return the activity, or ``None`` if missing (or soft-deleted, unless asked)."""
    data = get_document(_COLLECTION, activity_id)
    if data is None:
        return None
    activity = _from_firestore(data)
    if activity.deleted_at is not None and not include_deleted:
        return None
    return activity


def list_activities_by_owner(owner_uid: str, *, include_deleted: bool = False) -> list[Activity]:
    """List a teacher's activities (newest first), soft-deleted excluded by default.

    Owner-scoped by construction (``ownerUid ==``) so it can never leak another
    teacher's activities. Backs the activities-library index (M1).
    """
    rows = [_from_firestore(d) for d in query_documents(_COLLECTION, filters=[("ownerUid", "==", owner_uid)])]
    if not include_deleted:
        rows = [a for a in rows if a.deleted_at is None]
    rows.sort(key=lambda a: a.updated_at or datetime.min.replace(tzinfo=UTC), reverse=True)
    return rows


def list_all_activities(*, include_deleted: bool = False) -> list[Activity]:
    """List every activity across all owners (newest first), soft-deleted excluded.

    The cross-owner scan that backs the researcher "Research view" (1.1.5) of the
    activities library. Callers MUST gate this on the researcher claim before
    invoking — like ``db.classes.list_all_classes``, this performs NO
    authorization; it is the bypass target, not the bypass check.
    """
    rows = [_from_firestore(d) for d in query_documents(_COLLECTION)]
    if not include_deleted:
        rows = [a for a in rows if a.deleted_at is None]
    rows.sort(key=lambda a: a.updated_at or datetime.min.replace(tzinfo=UTC), reverse=True)
    return rows


def list_published_activities() -> list[Activity]:
    """Every ``published`` activity across all owners (newest first) — the
    cross-teacher shared catalogue (ALS-SHARE M3.2). No authorization: being
    ``published`` IS the share gate, so this is open to any teacher (unlike
    ``list_all_activities``, which is researcher-only)."""
    rows = [_from_firestore(d) for d in query_documents(_COLLECTION, filters=[("visibility", "==", "published")])]
    rows = [a for a in rows if a.deleted_at is None]
    rows.sort(key=lambda a: a.updated_at or datetime.min.replace(tzinfo=UTC), reverse=True)
    return rows


# --- Facets: inherited from cited materials (1.1.61) ------------------------
#
# An activity's organising facets are mostly NOT stored on the activity. They are
# derived, on each read, from the curriculum documents it cites. File a document
# and every activity using it files itself: no backfill, no staleness when a
# document is re-tagged, and no reconciliation job to drift.
#
# The three functions below are PURE — they take the activities and a doc lookup
# and do no I/O — so the route resolves documents once and the facet pass can
# call the filter repeatedly with one facet omitted (the narrowed-count trick
# `db.curriculum.facets_for_teacher` uses).


def inherited_facets_for(
    activities: list[Activity],
    docs_by_id: dict[str, CurriculumDoc],
) -> dict[str, dict[str, set[str]]]:
    """Per activity, the subjects/levels/tags unioned from the documents it cites.

    ``docs_by_id`` MUST be the CALLER's visible documents, never the owner's.
    That is what stops a published activity leaking the tags of the private
    upload it cites to another teacher browsing the shared catalogue — the
    citation resolves to nothing for someone who cannot see the document. The
    wrong version (resolving against the owner's corpus) is indistinguishable in
    single-teacher dev data, which is why there is a test for it.

    Note the plurals: a document has one subject and one level, but an activity
    citing several has a SET of each.
    """
    out: dict[str, dict[str, set[str]]] = {}
    for activity in activities:
        subjects: set[str] = set()
        levels: set[str] = set()
        tags: set[str] = set()
        for ref in activity.materials:
            # 1.1.87: any doc-backed material inherits facets — a task attached
            # as `context` is the same CurriculumDoc as one attached as
            # `curriculum`, so it carries the same subject/level/tags. Only
            # `image` materials have no document behind them.
            if ref.kind == "image" or not ref.doc_id:
                continue
            doc = docs_by_id.get(ref.doc_id)
            if doc is None:
                # A dangling docId is the normal result of deleting a document,
                # or of citing one the caller cannot see. Contribute nothing.
                continue
            if doc.subject:
                subjects.add(doc.subject)
            if doc.level:
                levels.add(doc.level)
            tags.update(doc.tags)
        out[activity.activity_id] = {"subjects": subjects, "levels": levels, "tags": tags}
    return out


def _facets_of(activity: Activity, inherited: dict[str, dict[str, set[str]]]) -> dict[str, set[str]]:
    """The activity's effective facets: what the teacher set UNION what it inherits.

    A union, not an override — an activity explicitly marked Matematik that cites
    a Fysik document is findable under both, because both are true of it.
    """
    inh = inherited.get(activity.activity_id, _NO_FACETS)
    return {
        "subjects": inh["subjects"] | ({activity.subject} if activity.subject else set()),
        "levels": inh["levels"] | ({activity.level} if activity.level else set()),
        "tags": inh["tags"] | set(activity.tags),
    }


def apply_activity_filters(
    activities: list[Activity],
    inherited: dict[str, dict[str, set[str]]],
    *,
    level: str | None = None,
    subject: str | None = None,
    tags: list[str] | None = None,
    q: str | None = None,
) -> list[Activity]:
    """Apply the browse facets to an already-ACL-scoped activity list.

    Pure (no I/O), so ``facets_for_activities`` can call it repeatedly with one
    facet omitted — that omission is what narrows each facet's counts to the rest
    of the selection while keeping its siblings countable. Mirrors
    ``db.curriculum._apply_filters``; keep the two in step.
    """
    rows = list(activities)
    if level:
        if level == UNLEVELLED:
            # Neither an own level nor an inherited one — the residue bucket, and
            # where most activities actually sit until someone files them.
            rows = [a for a in rows if not _facets_of(a, inherited)["levels"]]
        else:
            rows = [a for a in rows if level in _facets_of(a, inherited)["levels"]]
    if subject:
        rows = [a for a in rows if subject in _facets_of(a, inherited)["subjects"]]
    if tags:
        # AND facet, across BOTH sources: an activity matches only if every
        # selected tag is either its own or inherited. Normalise the query side so
        # a chip click and a CLI flag compare identically.
        want = set(normalize_tags(tags))
        rows = [a for a in rows if want <= _facets_of(a, inherited)["tags"]]
    if q:
        # Free-text: case-insensitive substring across what a teacher would expect
        # a search box over activities to cover — the title, the teaching goal, and
        # both tag sources. Element bodies are deliberately NOT searched (see the
        # design doc's Non-Goals). Multi-word queries AND, so terms narrow.
        needles = q.lower().split()
        rows = [
            a
            for a in rows
            if all(
                term in f"{a.title} {a.teaching_goal} {' '.join(sorted(_facets_of(a, inherited)['tags']))}".lower()
                for term in needles
            )
        ]
    return rows


def facets_for_activities(
    activities: list[Activity],
    inherited: dict[str, dict[str, set[str]]],
    *,
    level: str | None = None,
    subject: str | None = None,
    tags: list[str] | None = None,
    q: str | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Every facet's options, each COUNTED against the OTHER active facets.

    Same two rules as the curriculum rail, and for the same reasons:

    * **Which options exist** comes from the whole visible set, so the rail never
      reshuffles as you type — chips do not appear or vanish mid-filter.
    * **Each option's count** comes from the set filtered by every facet EXCEPT
      itself, so selecting a subject re-counts tags and levels against it while
      sibling subjects keep their counts and stay switchable.

    A zero count dims a chip; it never hides it. ``q`` is a search, not a facet,
    so it narrows every count.
    """

    def others(**omit: Any) -> list[Activity]:
        active: dict[str, Any] = {"level": level, "subject": subject, "tags": tags, "q": q}
        active.update(omit)
        return apply_activity_filters(activities, inherited, **active)

    def tally(rows: list[Activity], key: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for a in rows:
            # A set, so an activity citing two Fysik documents counts ONCE for
            # Fysik — a facet counts activities, not citations.
            for value in _facets_of(a, inherited)[key]:
                counts[value] = counts.get(value, 0) + 1
        return counts

    def level_key(rows: list[Activity]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for a in rows:
            levels = _facets_of(a, inherited)["levels"] or {UNLEVELLED}
            for value in levels:
                counts[value] = counts.get(value, 0) + 1
        return counts

    subject_vocab, subject_counts = tally(activities, "subjects"), tally(others(subject=None), "subjects")
    tag_vocab, tag_counts = tally(activities, "tags"), tally(others(tags=None), "tags")
    level_vocab, level_counts = level_key(activities), level_key(others(level=None))

    return {
        "subjects": [{"value": s, "label": s, "count": subject_counts.get(s, 0)} for s in sorted(subject_vocab)],
        "levels": [
            {"value": lv, "label": UNLEVELLED_LABEL if lv == UNLEVELLED else lv, "count": level_counts.get(lv, 0)}
            # Fixed A/B/C order, unlevelled last — a level rail must not reorder
            # itself as counts change.
            for lv in ("A", "B", "C", UNLEVELLED)
            if lv in level_vocab
        ],
        "tags": [{"value": t, "label": t, "count": tag_counts.get(t, 0)} for t in sorted(tag_vocab)],
    }


def soft_delete_activity(activity_id: str) -> None:
    """Soft-delete (sets ``deletedAt``). Idempotent — no-op if already gone.

    Soft, not hard: a deleted activity may still be referenced by a class's
    ``activity_ids`` mid-cutover, and provenance (``source_activity_id``) on a
    copy should survive the source's deletion.
    """
    update_document(_COLLECTION, activity_id, {"deletedAt": _utcnow().isoformat()})


__all__ = [
    "apply_activity_filters",
    "copy_activity",
    "create_activity",
    "facets_for_activities",
    "get_activity",
    "inherited_facets_for",
    "list_activities_by_owner",
    "list_all_activities",
    "list_published_activities",
    "save_activity",
    "soft_delete_activity",
]
