"""Concept-map checkpoint state (living-concept-map M3 / CONCEPT-1).

Firestore document at ``concept_progress/{group_id}:{activity_id}`` — the
per-group node-status record the tutor's chat-native checkpoints write and the
student's map light-up reads. GROUP-keyed, never per-student (ADR-001: no
individual profiling; progress is group-level and formative).

Shape::

    {
      "groupId": ..., "activityId": ...,
      "nodeStates": {
        "<node_id>": {
          "status": "not_yet" | "partial" | "demonstrated",
          "evidence": {"kind": "checkpoint", "summary": "..."},
          "updatedAt": <iso8601>,
        }
      },
      "updatedAt": <iso8601>,
    }

``evidence.kind`` is the provenance class: ``"checkpoint"`` (deliberate,
tutor-run check questions — this module's writers) is STRONGER than
``"observed"`` (the passive LLM-judge check-off, out of scope until the M3-eval
calibration gate — see living-concept-map.md). The BigQuery emit for the Year-2
longitudinal record is a later bridge, not written here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from db.firestore import get_document, set_document

_COLLECTION = "concept_progress"

NodeStatus = Literal["not_yet", "partial", "demonstrated"]


def _doc_id(group_id: str, activity_id: str) -> str:
    return f"{group_id}:{activity_id}"


def get_node_states(group_id: str, activity_id: str) -> dict[str, dict[str, Any]]:
    """The group's node-status map for one activity — ``{}`` when nothing is
    recorded yet (every node reads ``not_yet``)."""
    if not group_id or not activity_id:
        return {}
    doc = get_document(_COLLECTION, _doc_id(group_id, activity_id))
    states = (doc or {}).get("nodeStates", {})
    return states if isinstance(states, dict) else {}


def record_checkpoint_state(
    group_id: str,
    activity_id: str,
    node_id: str,
    status: NodeStatus,
    evidence_summary: str,
) -> dict[str, dict[str, Any]]:
    """Record one node's checkpoint outcome and return the updated state map.

    Merge-write: other nodes' states are untouched. The caller (the checkpoint
    tool) supplies ``group_id`` from the VERIFIED session identity — it must
    never be a model-controlled parameter.
    """
    now = datetime.now(UTC).isoformat()
    states = get_node_states(group_id, activity_id)
    states[node_id] = {
        "status": status,
        "evidence": {"kind": "checkpoint", "summary": evidence_summary[:500]},
        "updatedAt": now,
    }
    set_document(
        _COLLECTION,
        _doc_id(group_id, activity_id),
        {"groupId": group_id, "activityId": activity_id, "nodeStates": states, "updatedAt": now},
        merge=True,
    )
    return states


def clear_progress_for_group(group_id: str, activity_id: str | None = None) -> int:
    """Clear a group's concept-map checkpoints. Returns how many docs went.

    PILOT-1 M0 (2026-08-10) — the sibling of
    ``db.checklist_progress.clear_progress_for_group``. Both stores must clear
    together on a teacher reset; clearing one and not the other reproduces the
    same orphaned-progress state in a different element.
    """
    from db.firestore import delete_document, query_documents

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


__all__ = ["NodeStatus", "clear_progress_for_group", "get_node_states", "record_checkpoint_state"]
