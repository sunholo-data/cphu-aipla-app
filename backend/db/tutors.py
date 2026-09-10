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


def list_authored_tutors() -> list[Tutor]:
    # No filters — the whole collection. Authored tutors are a small,
    # human-curated set, not per-session data.
    rows = query_documents(_COLLECTION) or []
    out = [t for t in (_row_to_tutor(r) for r in rows) if t is not None]
    return sorted(out, key=lambda t: t.id)


def resolve_tutor(tutor_id: str | None) -> Tutor | None:
    """The tutor by id: an authored one if it exists, else the YAML base.

    Authored wins so a researcher can supersede a base tutor without a deploy;
    None for an unknown id, because an unknown tutor must degrade to "no tutor"
    rather than raise on the agent path (Axiom 5).
    """
    if not tutor_id:
        return None
    return get_authored_tutor(tutor_id) or load_base_tutor(tutor_id)


def list_tutor_catalogue() -> list[Tutor]:
    """Every selectable tutor — bases plus authored, authored shadowing a base
    of the same id. This is what a teacher's picker shows."""
    authored = {t.id: t for t in list_authored_tutors()}
    merged = {t.id: t for t in load_base_tutors()} | authored
    return sorted(merged.values(), key=lambda t: (t.is_variant, t.display_name.lower()))


def save_tutor(tutor: Tutor, *, updated_by: str) -> Tutor:
    """Write an authored tutor, bumping the version of an existing one."""
    existing = get_authored_tutor(tutor.id)
    row = tutor.model_copy(
        update={
            "version": (existing.version + 1) if existing else tutor.version,
            "author_uid": updated_by,
            "created_at": existing.created_at if existing else datetime.now(UTC),
            "updated_at": datetime.now(UTC),
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
            "created_at": None,
            "updated_at": None,
        }
    )
    return save_tutor(variant, updated_by=created_by)


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
    "save_tutor",
]
