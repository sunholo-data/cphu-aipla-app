"""Which teaching framework a researcher has assigned to a tutor (1.1.91 TUTOR-4).

One Firestore doc per tutor at ``tutor_framework_assignments/{tutor_id}``,
holding nothing but the framework a researcher chose for it and who chose it.

**Why this is its own store rather than a field on the tutor.** ``db.tutors``
already layers an authored tutor over the YAML base, and assigning a framework
by writing one of those would have worked — for the six persona tutors. It would
have quietly broken the four ``SKILL.md`` ones: ``admin.tutor_migration``
deliberately skips any tutor a human has edited, so the first assignment would
have cut ``led-planck-tutor`` off from every future ``SKILL.md`` change, with no
error and no way to notice until a template edit failed to appear. A separate
one-field record keeps the tutor itself untouched, so the seed keeps flowing.

**This is where the pedagogical claim gets made, and that is the point.** Base
tutors ship with ``framework_id: null`` because "Sofie teaches with ESRU" is a
claim, and the catalogue does not get to make claims nobody signed off. An
assignment made here is signed off — by a named researcher, in the running app,
with ``updated_by`` recorded. The YAML stays null; the claim lives where its
author does.

Deleting the row restores whatever the tutor itself said, which for a base tutor
is "no framework" — so a mistaken assignment is one delete from gone.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from db.firestore import delete_document, get_document, query_documents, set_document

log = logging.getLogger(__name__)

_COLLECTION = "tutor_framework_assignments"

#: Firestore's query helper stamps the document id onto each row.
_ID_KEY = "__id"


def get_assignment(tutor_id: str | None) -> dict[str, Any] | None:
    """The assignment row for this tutor, or None if a researcher never made one.

    ⚠️ A row whose ``frameworkId`` is ``None`` is NOT the same as no row. It is a
    researcher explicitly saying "this tutor teaches with no framework", which
    has to be able to override a tutor that carries one. Callers must therefore
    test for the row, never for the truthiness of its framework id.
    """
    if not tutor_id:
        return None
    row = get_document(_COLLECTION, tutor_id)
    if not row:
        return None
    return {
        "tutorId": tutor_id,
        "frameworkId": row.get("frameworkId"),
        "updatedBy": row.get("updatedBy"),
        "updatedAt": row.get("updatedAt"),
    }


def list_assignments() -> dict[str, str | None]:
    """Every assignment, as ``{tutor_id: framework_id_or_None}``.

    Small, human-curated collection — one row per tutor a researcher has
    deliberately configured, never per-session data.
    """
    out: dict[str, str | None] = {}
    for row in query_documents(_COLLECTION) or []:
        tutor_id = row.get(_ID_KEY) or row.get("tutorId")
        if tutor_id:
            out[str(tutor_id)] = row.get("frameworkId")
    return out


def set_assignment(tutor_id: str, framework_id: str | None, *, updated_by: str) -> dict[str, Any]:
    """Assign ``framework_id`` to ``tutor_id``; ``None`` means "explicitly none".

    ``updated_by`` is the VERIFIED caller uid. Provenance on a research
    instrument is not optional and the route never lets the client supply it —
    the same rule ``save_framework_override`` follows.
    """
    row = {
        "tutorId": tutor_id,
        "frameworkId": framework_id,
        "updatedBy": updated_by,
        "updatedAt": datetime.now(UTC).isoformat(),
    }
    set_document(_COLLECTION, tutor_id, row, merge=False)
    log.info(
        "tutor_assignments: %s -> framework=%s by %s",
        tutor_id,
        framework_id or "(none)",
        updated_by,
    )
    return row


def clear_assignment(tutor_id: str) -> None:
    """Remove the assignment, restoring whatever the tutor itself declares."""
    if tutor_id:
        delete_document(_COLLECTION, tutor_id)


__all__ = ["clear_assignment", "get_assignment", "list_assignments", "set_assignment"]
