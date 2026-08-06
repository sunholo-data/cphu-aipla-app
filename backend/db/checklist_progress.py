"""Checklist (ILO) tick state (1.1.62 M3).

Firestore document at ``checklist_progress/{group_id}:{activity_id}`` — the
per-group record of which teacher-authored checklist items are done, who marked
them, and (for AI ticks) why. Sibling of ``db/concept_progress.py`` and
deliberately the same shape: one idiom for per-group formative progress, not a
third bespoke store.

GROUP-keyed, never per-student (ADR-001: no individual profiling; progress is
group-level and formative).

**Why this store exists at all.** Student ticks used to live in the browser's
``sessionStorage``, keyed by skill id — so they were per BROWSER. 1.1.53
(group-shared-session-sync) shipped on the premise that the primary classroom
shape is *several students in one group working the same activity on separate
devices*, which made that storage already wrong: three group members had three
private checklists and none of them survived a closed tab. M3 could have added
AI ticks in group scope alongside it, but two stores with different scopes and
lifetimes would diverge on the first device switch — the AI's ticks following
the group while the student's own vanished. Both live here now.

Shape::

    {
      "groupId": ..., "activityId": ...,
      "itemStates": {
        "<item_id>": {
          "done": true | false,
          "by": "student" | "ai",
          "evidence": "one sentence"   # AI ticks only
          "updatedAt": <iso8601>,
        }
      },
      "updatedAt": <iso8601>,
    }

``by`` is the provenance, and it is what keeps "the AI helps auto-grade" (M,
2026-08-06) compatible with Axiom 2. An ``ai`` tick is the tutor's read, shown
to the student with its evidence and overridable; the moment the student
disagrees the entry flips to ``student`` and stops being presented as the AI's.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from db.firestore import get_document, set_document

_COLLECTION = "checklist_progress"

TickedBy = Literal["student", "ai"]

# The evidence sentence is rendered in the student's trust card and read by the
# teacher. One concrete sentence is the contract; this is the backstop.
_EVIDENCE_MAX = 500


def _doc_id(group_id: str, activity_id: str) -> str:
    return f"{group_id}:{activity_id}"


def get_item_states(group_id: str, activity_id: str) -> dict[str, dict[str, Any]]:
    """The group's checklist state for one activity — ``{}`` when nothing is
    recorded yet (every item reads not-done)."""
    if not group_id or not activity_id:
        return {}
    doc = get_document(_COLLECTION, _doc_id(group_id, activity_id))
    states = (doc or {}).get("itemStates", {})
    return states if isinstance(states, dict) else {}


def record_item_state(
    group_id: str,
    activity_id: str,
    item_id: str,
    *,
    done: bool,
    by: TickedBy,
    evidence_summary: str = "",
) -> dict[str, dict[str, Any]]:
    """Record one item's tick state and return the updated map.

    Merge-write: other items are untouched. The caller supplies ``group_id``
    from the VERIFIED session identity — it must never be a model-controlled
    parameter (see ``adk/checklist_tools.py``).
    """
    now = datetime.now(UTC).isoformat()
    states = get_item_states(group_id, activity_id)
    entry: dict[str, Any] = {"done": done, "by": by, "updatedAt": now}
    if by == "ai" and evidence_summary:
        entry["evidence"] = evidence_summary[:_EVIDENCE_MAX]
    states[item_id] = entry
    set_document(
        _COLLECTION,
        _doc_id(group_id, activity_id),
        {"groupId": group_id, "activityId": activity_id, "itemStates": states, "updatedAt": now},
        merge=True,
    )
    return states


__all__ = ["TickedBy", "get_item_states", "record_item_state"]
