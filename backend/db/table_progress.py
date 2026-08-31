"""Student table data — the readings a group has entered into a data table (1.1.88).

Firestore document at ``table_progress/{group_id}:{activity_id}``. Fourth sibling
of ``db/checklist_progress.py``, ``db/concept_progress.py`` and
``db/writing_progress.py``, and deliberately the same shape: one idiom for
per-group student state, not a fourth bespoke store.

GROUP-keyed, never per-student (ADR-001: no individual profiling). Which member
typed a given cell is deliberately NOT recorded — that would be the first
individual-level student record in the system, and it is item 27's conversation,
not this one.

**Why this exists.** ``WorkbenchTable`` was the last fillable element still
keying its cells by ``window.sessionStorage`` — per browser TAB. The other three
migrated years ago, and ``writing_progress.py`` names the table, by name, as the
one left behind, quoting the cost ``checklist_progress`` had already paid:
*"three group members had three private checklists and none of them survived a
closed tab."* A teacher reported the same cost from a real lesson on 2026-08-21:

    "We each saw the numbers we typed, but the AI only 'saw' the most recently
    entered values. As students, we couldn't accurately see what each other was
    doing."

That is the canonical physics-lab shape — two people taking readings into one
table — and it did not work. Two students recording measurements is not two
scratchpads; it is one artifact. (The 2026-07-01 "the group shares one
conversation, not one mouse" reasoning in 1.1.53 still holds for SIMS, where two
students poking their own simulation genuinely is not a conflict.)

Shape::

    {
      "groupId": ..., "activityId": ...,
      "cells": {
        "<table_id>::<row>::<col_id>": "3.42",
      },
      "revision": 7,          # monotonic; the client's "someone else edited" check
      "updatedAt": <iso8601>,
    }

**Per-CELL merge, not per-grid.** ``record_cells`` merges the cells it is given
into whatever is stored, so two students filling different rows never clobber
each other — which is the shape a lab actually has, and the shape a per-grid
last-write-wins handles worst. Two students typing the SAME cell is rare and
still defined: last write wins, and the bumped ``revision`` is what lets the
losing author's client notice and re-read rather than sit on a value the group
no longer has. A silent overwrite is the defect this module removes; a smaller
silent overwrite inside the fix would be the obvious way to fail.

The cell key is ``{table_id}::{row}::{col_id}`` — the same key the client has
always used for its value map, unchanged, so nothing about the client's own
addressing had to migrate to get here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from db.firestore import delete_document, get_document, query_documents, set_document

_COLLECTION = "table_progress"

# Backstops, not the primary bound. The route validates against the AUTHORED
# table (a cell key must name a real table/row/column), which is the check that
# actually matters; these stop a pathological client from writing a document
# Firestore would reject or that would cost a fortune to read on every turn.
MAX_CELLS = 2000
MAX_CELL_CHARS = 200


def _doc_id(group_id: str, activity_id: str) -> str:
    return f"{group_id}:{activity_id}"


def get_cells(group_id: str, activity_id: str) -> dict[str, str]:
    """The group's entered cells for one activity, keyed ``table::row::col``.

    ``{}`` when nothing is recorded — which reads as every table being empty, and
    is the *normal* state before a student types anything.
    """
    if not group_id or not activity_id:
        return {}
    doc = get_document(_COLLECTION, _doc_id(group_id, activity_id))
    cells = (doc or {}).get("cells", {})
    return {k: str(v) for k, v in cells.items()} if isinstance(cells, dict) else {}


def get_state(group_id: str, activity_id: str) -> dict[str, Any]:
    """``{"cells": ..., "revision": ...}`` — what a client needs to sync.

    Separate from ``get_cells`` because the tutor-side readers want only the
    cells, and handing them a revision they must remember to ignore is how a
    number ends up in a prompt.
    """
    if not group_id or not activity_id:
        return {"cells": {}, "revision": 0}
    doc = get_document(_COLLECTION, _doc_id(group_id, activity_id)) or {}
    cells = doc.get("cells", {})
    return {
        "cells": {k: str(v) for k, v in cells.items()} if isinstance(cells, dict) else {},
        "revision": int(doc.get("revision", 0) or 0),
    }


def record_cells(group_id: str, activity_id: str, cells: dict[str, str]) -> dict[str, Any]:
    """Merge *cells* into the group's table and return the new full state.

    The caller supplies ``group_id`` from the VERIFIED session identity — never a
    request field (the same rule as the three siblings; ``user.email`` /
    ``user.domain`` are empty strings for anonymous-group students and would key
    a Firestore path to ``400 invalid document path``).

    Returns the whole merged state rather than just what changed, so the caller's
    next push to the tutor carries the WHOLE GROUP's grid. That is the half of
    the teacher's report about the AI: it saw the last writer's values because
    the last writer's browser was the only thing that had them.

    An empty-string value CLEARS a cell rather than recording an empty one — a
    student deleting a wrong reading must be able to un-share it, and a stored
    "" would otherwise linger as a filled-looking cell forever.
    """
    now = datetime.now(UTC).isoformat()
    doc = get_document(_COLLECTION, _doc_id(group_id, activity_id)) or {}
    stored = doc.get("cells", {})
    merged: dict[str, str] = {k: str(v) for k, v in stored.items()} if isinstance(stored, dict) else {}

    for key, value in (cells or {}).items():
        text = str(value or "")[:MAX_CELL_CHARS]
        if text.strip() == "":
            merged.pop(key, None)
        else:
            merged[key] = text

    if len(merged) > MAX_CELLS:
        # Keep the oldest-known set rather than truncating arbitrarily mid-write:
        # dropping a student's existing readings to make room for a runaway
        # client is the wrong trade. The route's authored-table validation is
        # what should have stopped this.
        merged = dict(list(merged.items())[:MAX_CELLS])

    revision = int(doc.get("revision", 0) or 0) + 1
    set_document(
        _COLLECTION,
        _doc_id(group_id, activity_id),
        {
            "groupId": group_id,
            "activityId": activity_id,
            "cells": merged,
            "revision": revision,
            "updatedAt": now,
        },
        merge=True,
    )
    return {"cells": merged, "revision": revision}


def clear_progress_for_group(group_id: str, activity_id: str | None = None) -> int:
    """Delete the group's table data — for one activity, or all of them.

    Mirrors ``db.checklist_progress.clear_progress_for_group`` and
    ``db.concept_progress.clear_progress_for_group`` so the teacher's [Reset
    session] clears every per-group store rather than three of four. A table left
    behind by a reset is a stale grid the next lesson inherits without anyone
    having entered it.

    Unlike ``writing_progress`` (deliberately NOT cleared, because a student's
    prose is their own work), a table of readings belongs to the activity run
    that produced it — the same argument that makes a checklist tick clearable.
    """
    if not group_id:
        return 0
    if activity_id is not None:
        if get_document(_COLLECTION, _doc_id(group_id, activity_id)) is None:
            return 0
        delete_document(_COLLECTION, _doc_id(group_id, activity_id))
        return 1

    docs = query_documents(collection=_COLLECTION, filters=[("groupId", "==", group_id)])
    for d in docs:
        doc_id = d.get("__id")
        if doc_id:
            delete_document(_COLLECTION, doc_id)
    return len(docs)


__all__ = [
    "MAX_CELLS",
    "MAX_CELL_CHARS",
    "clear_progress_for_group",
    "get_cells",
    "get_state",
    "record_cells",
]
