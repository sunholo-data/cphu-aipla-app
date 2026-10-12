"""Custom teaching approaches, authored in the app (1.1.110).

A **custom approach** is free-text pedagogy someone wrote — no constructs, no
literature, no claim to either. It is the honest replacement for the
hand-written-instruction editor removed from the seven published frameworks:
the capability survives, the false claim to a theory does not.

One Firestore doc per approach at ``authored_frameworks/{id}``. Distinct from
``framework_overrides``, which holds edits *to* a published framework — these
are approaches that exist only here, which is why the model carries
``source="firestore"`` and the loader has to consult both.

## Who may do what

|                                   | Researcher | Teacher |
|-----------------------------------|:----------:|:-------:|
| Edit the seven published frameworks | ✅       | ❌      |
| Create a custom approach            | ✅       | ✅      |
| Edit / delete **their own** custom  | ✅       | ✅      |
| Edit / delete **anyone's** custom   | ✅       | ❌      |

This is M1's two-tier model with one deliberate departure. M1 said teachers get
*variants, not blank frameworks*, reasoning that "a tutor with a theory field and
no theory in it is worse than no theory field: it makes an unfounded claim look
founded". That reasoning is about the CLAIM, not about the free text — and a
custom approach makes no such claim: it is labelled as authored, renders under
its own heading, and carries no provenance. So the danger M1 was guarding
against is absent here, and teachers get the one thing on this screen they can
edit.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from db.firestore import delete_document, get_document, query_documents, set_document
from db.models.authorship import CreatedVia
from db.models.teaching_framework import ApproachSource, TeachingFramework

log = logging.getLogger(__name__)

COLLECTION = "authored_frameworks"

#: Custom ids are namespaced so they can never collide with a YAML framework id
#: — and so that reading an id tells you which store answers for it.
ID_PREFIX = "custom-"

_SLUG_RE = re.compile(r"[^a-z0-9]+")

#: Row bookkeeping that is NOT part of the framework model. ``TeachingFramework``
#: sets ``extra="forbid"``, so these must be stripped before validating a row —
#: otherwise every read fails validation and the store returns nothing while
#: looking like an empty collection.
_ROW_ONLY = ("updatedBy", "updatedAt", "version", "__id")


def make_framework_id(label: str) -> str:
    """A stable, namespaced id from a human label."""
    slug = _SLUG_RE.sub("-", label.strip().lower()).strip("-")[:40] or "approach"
    return f"{ID_PREFIX}{slug}"


def is_custom_id(framework_id: str | None) -> bool:
    return bool(framework_id) and str(framework_id).startswith(ID_PREFIX)


def _row_to_framework(row: dict[str, Any] | None) -> TeachingFramework | None:
    if not row:
        return None
    try:
        data = {k: v for k, v in row.items() if k not in _ROW_ONLY}
        data["source"] = "firestore"
        data["layer"] = "custom"
        return TeachingFramework.model_validate(data)
    except Exception as exc:
        log.warning("authored_frameworks: row %s is malformed, skipping: %s", row.get("id"), exc)
        return None


def get_authored_framework(framework_id: str | None) -> TeachingFramework | None:
    """One custom approach, or None. Never raises on a malformed row — this sits
    on the agent path and a bad row must not take a lesson down (Axiom 5)."""
    if not is_custom_id(framework_id):
        return None
    return _row_to_framework(get_document(COLLECTION, str(framework_id)))


def list_authored_frameworks(
    for_uid: str | None = None,
    *,
    see_all: bool = False,
) -> list[TeachingFramework]:
    """Custom approaches this caller may see; malformed rows skipped, not fatal.

    ``for_uid`` omitted keeps the pre-TUTOR-2 behaviour (everything), because
    the agent path and the framework loader are not a person and must never be
    filtered — a student's lesson resolving a framework has no uid to filter by,
    and filtering it would silently change what a tutor was taught with.
    """
    rows = query_documents(COLLECTION) or []
    out = [f for f in (_row_to_framework(r) for r in rows) if f]
    if for_uid is not None:
        out = [f for f in out if f.visible_to(for_uid, see_all=see_all)]
    return sorted(out, key=lambda f: f.label.lower())


def save_authored_framework(
    framework: TeachingFramework,
    *,
    author_uid: str,
    author_role: str,
    set_visibility: str | None = None,
    created_via: CreatedVia | None = None,
) -> TeachingFramework:
    """Create or replace a custom approach.

    ``author_uid``/``author_role`` come from the VERIFIED token, never the body
    — the same rule the framework-override store follows, for the same reason:
    who authored a thing a class will be taught with is not a client-supplied
    field.

    The author of an EXISTING row is preserved: an edit by a researcher must not
    quietly reassign a teacher's approach to the researcher.

    1.1.150 M2 — so is its creation record. ``createdBy`` / ``createdVia`` /
    ``createdAt`` are stamped HERE on create, from the verified caller, and an
    existing row's values are carried over untouched (None included: a row that
    predates them is the backfill's to fill, never a later save's to guess).
    """
    existing = get_authored_framework(framework.id)
    row = framework.model_dump(by_alias=True, mode="json")
    row["layer"] = "custom"
    row["source"] = "firestore"
    row["authorUid"] = existing.author_uid if existing else author_uid
    row["authorRole"] = existing.author_role if existing else author_role
    if existing is not None:
        row["createdBy"] = existing.created_by
        row["createdVia"] = existing.created_via
        row["createdAt"] = existing.created_at.isoformat() if existing.created_at else None
    else:
        row["createdBy"] = author_uid
        row["createdVia"] = created_via
        row["createdAt"] = datetime.now(UTC).isoformat()
    # TUTOR-2 M0 — a NEW approach is private explicitly; an edit keeps whatever
    # the author chose. Never re-derived from the incoming body: sharing is its
    # own deliberate act, not something a save can do by accident.
    # TUTOR-2 M0 — a NEW approach is private explicitly; an edit keeps whatever
    # the author chose. Changing it takes the dedicated visibility endpoint
    # (``set_visibility``), because an edit that could change who sees a thing
    # is an edit that shares it by accident.
    if set_visibility is not None:
        row["visibility"] = set_visibility
    else:
        row["visibility"] = (existing.visibility if existing else None) or "private"
    row["updatedBy"] = author_uid
    row["updatedAt"] = datetime.now(UTC).isoformat()
    row["version"] = int((get_document(COLLECTION, framework.id) or {}).get("version") or 0) + 1
    set_document(COLLECTION, framework.id, row, merge=False)
    saved = _row_to_framework(row)
    if saved is None:
        # Never return the INPUT as if it had been stored. The row is already
        # written at this point, so a failure here means the store holds
        # something that cannot be read back — and answering with the caller's
        # own object would report success for a write that is unreadable.
        raise ValueError(f"authored_frameworks: {framework.id} was written but cannot be read back")
    return saved


def stamp_sources(
    incoming: list[ApproachSource],
    existing: list[ApproachSource] | None,
    *,
    uid: str,
) -> list[ApproachSource]:
    """Server-stamp ``addedBy`` / ``addedAt`` on a custom approach's sources (1.1.150 M3).

    Whatever the body said about who added a source is discarded. A source the
    approach already carried — same citation, ignoring case and spacing — keeps
    its original ``addedBy`` / ``addedAt``, so a teacher re-saving their
    approach does not make every source look freshly added by them, and a
    researcher's edit does not make a teacher's sources the researcher's.
    """

    def _key(src: ApproachSource) -> str:
        return " ".join(src.citation.split()).casefold()

    prior = {_key(s): s for s in (existing or [])}
    now = datetime.now(UTC)
    out: list[ApproachSource] = []
    for src in incoming:
        before = prior.get(_key(src))
        out.append(
            src.model_copy(
                update={
                    "added_by": before.added_by if before else uid,
                    "added_at": before.added_at if before else now,
                }
            )
        )
    return out


def delete_authored_framework(framework_id: str) -> None:
    if is_custom_id(framework_id):
        delete_document(COLLECTION, framework_id)


def may_edit(framework: TeachingFramework, *, uid: str, is_researcher: bool) -> bool:
    """Whether ``uid`` may edit this approach.

    A researcher may edit any of them. A teacher may edit only their own. A
    published (YAML) framework is never editable through this store at all — it
    is not one of these.
    """
    if not framework.is_custom:
        return False
    if is_researcher:
        return True
    return bool(framework.author_uid) and framework.author_uid == uid


__all__ = [
    "COLLECTION",
    "ID_PREFIX",
    "delete_authored_framework",
    "get_authored_framework",
    "is_custom_id",
    "list_authored_frameworks",
    "make_framework_id",
    "may_edit",
    "save_authored_framework",
    "stamp_sources",
]
