"""Authored tutors and variants (1.1.91 M1).

Firestore ``tutors/{tutor_id}``, layered over the YAML base catalogue exactly as
``db/framework_overrides.py`` layers over the framework YAML: git holds the
defaults, Firestore holds only what a human deliberately made.

**Variants are the mechanism, and the research finding.** A researcher does not
edit "Sofie" to teach with ESRU — they create *a variant of* Sofie that does,
and the parent is untouched. Lineage means the question *"SDT as designed versus
SDT as thirty teachers actually adapted it"* is answerable, which 1.1.91 names as
the reason to record it at all.

**Versioning.** Editing an authored tutor bumps ``version``; 1.1.92 attributes a
scored session to ``(tutor_id, version)``, so an in-place edit with no bump would
orphan every earlier session.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from db.firestore import delete_document, get_document, query_documents, set_document
from db.models.authorship import CreatedVia
from db.models.tutor import Tutor, TutorLineage
from tutors.loader import load_base_tutor, load_base_tutors

log = logging.getLogger(__name__)

_COLLECTION = "tutors"

#: Firestore's query helper stamps the document id onto every row. ``Tutor`` is
#: ``extra="forbid"`` (deliberately — it is what makes writing an avatar onto a
#: tutor fail loudly), so the bookkeeping key has to come off before validation.
_FIRESTORE_META = ("__id",)


def _row_to_tutor(row: dict[str, Any]) -> Tutor | None:
    """Validate one stored row, or None if it is malformed.

    A single bad row must not take the whole catalogue down — but it must not
    vanish silently either. Swallowing the error is how "the tutor I created is
    not in the list" becomes an unexplainable bug: the read succeeds, the row is
    there, and the list is just short. So the failure is logged with the id.
    """
    payload = {k: v for k, v in row.items() if k not in _FIRESTORE_META}
    try:
        return Tutor.model_validate(payload)
    except Exception as exc:
        log.warning("tutors: skipping malformed row id=%s: %s", row.get("__id") or row.get("id"), exc)
        return None


def get_authored_tutor(tutor_id: str) -> Tutor | None:
    if not tutor_id:
        return None
    row = get_document(_COLLECTION, tutor_id)
    return _row_to_tutor(row) if row else None


def set_visibility(tutor_id: str, visibility: str) -> Tutor | None:
    """Share an authored tutor, or take it back (TUTOR-2 M0).

    Only an AUTHORED tutor can carry visibility — a YAML base has no Firestore
    row to write it on, and a base is shared by definition. Returns None when
    there is nothing authored under that id, which the route turns into a 404.
    """
    tutor = get_authored_tutor(tutor_id)
    if tutor is None:
        return None
    updated = tutor.model_copy(update={"visibility": visibility, "updated_at": datetime.now(UTC)})
    set_document(_COLLECTION, tutor_id, updated.model_dump(by_alias=True, mode="json"))
    log.info("tutors: visibility set id=%s -> %s", tutor_id, visibility)
    return updated


def list_authored_tutors() -> list[Tutor]:
    # No filters — the whole collection. Authored tutors are a small,
    # human-curated set, not per-session data.
    rows = query_documents(_COLLECTION) or []
    out = [t for t in (_row_to_tutor(r) for r in rows) if t is not None]
    return sorted(out, key=lambda t: t.id)


def _with_assignment(tutor: Tutor | None) -> Tutor | None:
    """Apply the researcher's framework assignment, if there is one.

    Layered on TOP of both the authored tutor and the YAML base, deliberately:
    an assignment must work for the four ``SKILL.md`` tutors as well as the six
    persona ones, and writing it into the tutor document would make
    ``admin.tutor_migration`` skip that tutor forever after. See
    ``db/tutor_assignments.py`` for the whole reason this is a separate store.

    ⚠️ Tests the ROW, not the framework id. A row with ``frameworkId: None`` is a
    researcher saying "no framework", which has to be able to clear one the
    tutor carries.
    """
    if tutor is None:
        return None
    from db.tutor_assignments import get_assignment

    row = get_assignment(tutor.id)
    if row is None:
        return tutor
    assigned = row.get("frameworkId")
    if assigned == tutor.framework_id:
        return tutor
    return tutor.model_copy(update={"framework_id": assigned})


def resolve_tutor(tutor_id: str | None) -> Tutor | None:
    """The tutor by id: an authored one if it exists, else the YAML base, with
    any researcher framework assignment applied over the top.

    Authored wins so a researcher can supersede a base tutor without a deploy;
    None for an unknown id, because an unknown tutor must degrade to "no tutor"
    rather than raise on the agent path (Axiom 5).

    ⚠️ The passthrough guarantee is unaffected. It is about a class or activity
    with NO tutor selected, which never reaches this function — an assignment
    can only change a tutor somebody deliberately picked.
    """
    if not tutor_id:
        return None
    return _with_assignment(get_authored_tutor(tutor_id) or load_base_tutor(tutor_id))


def resolve_tutor_for(tutor_id: str | None, uid: str | None, *, see_all: bool = False) -> Tutor | None:
    """``resolve_tutor`` as a PERSON sees it (TUTOR-2 M0).

    ⚠️ Deliberately separate from ``resolve_tutor``, which must stay unfiltered:
    that one is the AGENT path. A student's lesson resolving the tutor its class
    was given has no uid to filter by, and filtering there would change what a
    class is taught with — the passthrough guarantee, broken from a new angle.
    Visibility is a question about a chooser, so it is asked where there is one.

    An authored tutor the caller cannot see FALLS BACK to the YAML base of the
    same id rather than disappearing. An authored row shadowing a base is one
    person's override of a shared thing; keeping it private must not delete
    "Sofie" for everybody else.
    """
    if not tutor_id:
        return None
    authored = get_authored_tutor(tutor_id)
    if authored is not None and authored.visible_to(uid, see_all=see_all):
        return _with_assignment(authored)
    return _with_assignment(load_base_tutor(tutor_id))


def list_tutor_catalogue(for_uid: str | None = None, *, see_all: bool = False) -> list[Tutor]:
    """Every tutor this caller may select — bases plus authored, authored
    shadowing a base of the same id, with researcher framework assignments
    applied.

    Assignments are applied here as well as in ``resolve_tutor`` so the teacher's
    picker shows the same teaching approach the tutor will actually run with. A
    catalogue that disagreed with the resolver would be the "two lists" bug in a
    different costume — and TUTOR-2 M0 adds visibility to exactly that list of
    things both must agree about, which is why ``visible_to`` lives on the model
    and not in either caller.

    ``for_uid`` omitted keeps the old behaviour (everything), because plenty of
    internal callers — the migration, the docs generator, analytics — are not
    a person and must not be filtered.
    """
    from db.tutor_assignments import list_assignments

    bases = {t.id: t for t in load_base_tutors()}
    authored = {t.id: t for t in list_authored_tutors()}
    if for_uid is not None:
        # An authored row the caller cannot see falls back to its base rather
        # than removing the id — same reason as ``resolve_tutor_for``.
        authored = {tid: t for tid, t in authored.items() if t.visible_to(for_uid, see_all=see_all) or tid not in bases}
    merged = bases | authored
    assigned = list_assignments()
    out = [
        t.model_copy(update={"framework_id": assigned[t.id]})
        if t.id in assigned and assigned[t.id] != t.framework_id
        else t
        for t in merged.values()
    ]
    if for_uid is not None:
        out = [t for t in out if t.visible_to(for_uid, see_all=see_all)]
    return sorted(out, key=lambda t: (t.is_variant, t.display_name.lower()))


def save_tutor(tutor: Tutor, *, updated_by: str, created_via: CreatedVia | None = None) -> Tutor:
    """Write an authored tutor, bumping the version of an existing one.

    1.1.150 F4 — the AUTHOR of an existing row is preserved, as
    ``save_authored_framework`` and ``save_custom_persona`` always did. This
    used to set ``author_uid = updated_by`` on every write, so the next edit
    route would have quietly made a teacher's tutor the editor's. Who touched
    it last is ``updated_by``; who it belongs to does not change on a save.

    ``created_by`` / ``created_via`` / ``created_at`` are stamped on CREATE
    only and never rewritten. On an existing row they are carried over as they
    are — including None on a row that predates them, which the backfill
    (``scripts/backfill_authored_provenance.py``) fills from what is certain.
    """
    existing = get_authored_tutor(tutor.id)
    now = datetime.now(UTC)
    if existing is not None:
        provenance = {
            "author_uid": existing.author_uid,
            "author_role": existing.author_role,
            "created_by": existing.created_by,
            "created_via": existing.created_via,
            "created_at": existing.created_at,
        }
    else:
        provenance = {
            "author_uid": updated_by,
            "created_by": updated_by,
            "created_via": created_via,
            "created_at": now,
        }
    row = tutor.model_copy(
        update={
            **provenance,
            "version": (existing.version + 1) if existing else tutor.version,
            "updated_by": updated_by,
            "updated_at": now,
        }
    )
    set_document(_COLLECTION, row.id, row.model_dump(by_alias=True, mode="json"), merge=False)
    return row


def create_variant(
    parent_id: str,
    *,
    variant_id: str,
    display_name: str,
    created_by: str,
    author_role: str = "researcher",
    visibility: str = "private",
    created_via: CreatedVia = "ui",
    framework_id: str | None = None,
    persona_id: str | None = None,
    interaction_style: str | None = None,
    summary: str | None = None,
) -> Tutor:
    """Fork ``parent_id`` into a new tutor, carrying lineage.

    Unspecified fields inherit from the parent — a variant states its DELTA, and
    the delta is what makes the lineage worth recording. The parent is never
    written to.
    """
    parent = resolve_tutor(parent_id)
    if parent is None:
        raise ValueError(f"unknown parent tutor: {parent_id}")

    variant = parent.model_copy(
        update={
            "id": variant_id,
            "display_name": display_name,
            "summary": summary if summary is not None else parent.summary,
            "persona_id": persona_id if persona_id is not None else parent.persona_id,
            "framework_id": framework_id if framework_id is not None else parent.framework_id,
            "interaction_style": interaction_style or parent.interaction_style,
            "lineage": TutorLineage(kind="variant-of", parent_tutor_id=parent.id),
            "version": 1,
            "status": "draft",
            "author_role": author_role,
            # TUTOR-2 M0 — a NEW tutor is private EXPLICITLY, which is what
            # keeps it distinguishable from the absent-means-shared rows that
            # predate the field. Never inherited from the parent: forking a
            # shared tutor must not publish your draft of it.
            "visibility": visibility,
            "created_at": None,
            "updated_at": None,
            # Never inherited from the parent: the variant is a new record with
            # its own maker. ``save_tutor`` stamps these on create.
            "author_uid": None,
            "created_by": None,
            "created_via": None,
            "updated_by": None,
        }
    )
    return save_tutor(variant, updated_by=created_by, created_via=created_via)


def delete_authored_tutor(tutor_id: str) -> None:
    """Remove an authored tutor; a base of the same id becomes visible again."""
    if tutor_id:
        delete_document(_COLLECTION, tutor_id)


__all__ = [
    "create_variant",
    "delete_authored_tutor",
    "get_authored_tutor",
    "list_authored_tutors",
    "list_tutor_catalogue",
    "resolve_tutor",
    "resolve_tutor_for",
    "save_tutor",
    "set_visibility",
]
