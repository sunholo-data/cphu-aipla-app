"""Concept-map progress: an append-only evidence record per (group, concept).

Firestore document at ``concept_progress/{group_id}:{activity_id}`` — what the
tutor's checkpoints and passive marks write, and what the student's map light-up
and the tutor's ambient context read. GROUP-keyed, never per-student (ADR-001:
no individual profiling; progress is group-level and formative).

Shape::

    {
      "groupId": ..., "activityId": ..., "classId": ...,
      "nodeStates": {
        "<node_id>": {
          "evidence": [                       # append-only, oldest first
            {"kind": "checkpoint", "status": "partial",
             "summary": "...", "activityId": "act-…", "at": <iso8601>},
            ...
          ],
          "updatedAt": <iso8601>,
        }
      },
      "updatedAt": <iso8601>,
    }

## Why a list and not a slot (CONCEPT-2 M2)

Until 2026-09-25 a node held ONE ``{status, evidence, updatedAt}`` slot, replaced
on every write. One writer (``run_checkpoint``) made that survivable. A second
writer — the passive ``mark_concept`` — makes it lossy in a way that matters:
the teacher cannot see that a deliberate checkpoint said *partial* in September
and a passive read said *demonstrated* in February, which is the single most
interesting thing a year of a class's concept map contains. There were **two
documents in prod** when this changed, so the list cost nothing then and a
migration later.

Old-shape documents are migrated ON READ (``_records``), not by a script: the
helper is the one place that has to know both shapes, and a script leaves a
window where some documents are one shape and some the other.

## Status is derived, never stored

``status`` is a pure reduction over the records, computed on read. Nothing
writes it, so nothing can disagree with the evidence:

* **``teacher`` wins, permanently.** ``teacher_focus`` has promised the teacher
  since CONCEPT-1 that *"this is the AI's read — the teacher can override it"*;
  this is the half that makes that true.
* Otherwise the **most recent** record wins, so a re-check can lower a concept a
  group has since gone cold on.
* **Except** that an ``observed`` record may raise but never lower what a
  ``checkpoint`` established. A passive misread must not undo a deliberate pass;
  a passive read of genuine progress should still be allowed to move a node on,
  because the alternative is a map that goes stale between checkpoints.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from db.firestore import get_document, set_document

_COLLECTION = "concept_progress"

NodeStatus = Literal["not_yet", "partial", "demonstrated"]

#: Provenance of one record. ``teacher`` is a human override, ``checkpoint`` a
#: deliberate tutor-run check against the teacher's questions / definition of
#: done, ``observed`` a passive mark from the conversation.
EvidenceKind = Literal["teacher", "checkpoint", "observed"]

_STATUS_RANK: dict[str, int] = {"not_yet": 0, "partial": 1, "demonstrated": 2}
_KIND_RANK: dict[str, int] = {"observed": 0, "checkpoint": 1, "teacher": 2}

#: Records kept per node. A class revisiting a concept all year must not grow
#: the document without bound; the trim keeps the newest of EACH kind first, so
#: it can never silently drop the record the derived status rests on.
MAX_RECORDS_PER_NODE = 8


def _doc_id(group_id: str, activity_id: str) -> str:
    return f"{group_id}:{activity_id}"


def _records(node_state: Any) -> list[dict[str, Any]]:
    """The node's evidence records, migrating the pre-CONCEPT-2 slot on read."""
    if not isinstance(node_state, dict):
        return []
    evidence = node_state.get("evidence")
    if isinstance(evidence, list):
        return [r for r in evidence if isinstance(r, dict)]
    # Old shape: one {status, evidence: {kind, summary}, updatedAt} slot.
    status = node_state.get("status")
    if not status:
        return []
    old = evidence if isinstance(evidence, dict) else {}
    return [
        {
            "kind": old.get("kind") or "checkpoint",
            "status": status,
            "summary": old.get("summary") or "",
            "activityId": node_state.get("activityId") or "",
            "at": node_state.get("updatedAt") or "",
        }
    ]


def _latest_of_kind(records: list[dict[str, Any]], kind: str) -> dict[str, Any] | None:
    return next((r for r in reversed(records) if r.get("kind") == kind), None)


def derive_status(records: list[dict[str, Any]]) -> NodeStatus:
    """Reduce a node's evidence to its current status. See the module docstring."""
    if not records:
        return "not_yet"
    teacher = _latest_of_kind(records, "teacher")
    if teacher is not None:
        return teacher.get("status") or "not_yet"  # type: ignore[return-value]
    latest = records[-1]
    if latest.get("kind") == "observed":
        checkpoint = _latest_of_kind(records, "checkpoint")
        if checkpoint is not None and _STATUS_RANK.get(str(latest.get("status")), 0) < _STATUS_RANK.get(
            str(checkpoint.get("status")), 0
        ):
            return checkpoint.get("status") or "not_yet"  # type: ignore[return-value]
    return latest.get("status") or "not_yet"  # type: ignore[return-value]


def _trim(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the newest ``MAX_RECORDS_PER_NODE``, never dropping the newest
    record of any kind — dropping one could silently change ``derive_status``."""
    if len(records) <= MAX_RECORDS_PER_NODE:
        return records
    keep = {id(r) for r in (_latest_of_kind(records, k) for k in _KIND_RANK) if r is not None}
    for record in reversed(records):
        if len(keep) >= MAX_RECORDS_PER_NODE:
            break
        keep.add(id(record))
    return [r for r in records if id(r) in keep]


def states_from_stored(stored: Any) -> dict[str, dict[str, Any]]:
    """A document's ``nodeStates`` field → the derived, migrated view.

    The ONE place a stored document becomes a status. Anything that reaches a
    ``concept_progress`` document by another route — the teacher's coverage
    query, the class rollup — goes through this rather than reading ``status``
    off the document, which after CONCEPT-2 M2 is not there to read. Two
    readers deriving separately is how they come to disagree.
    """
    if not isinstance(stored, dict):
        return {}
    states: dict[str, dict[str, Any]] = {}
    for node_id, node_state in stored.items():
        records = _records(node_state)
        if not records:
            continue
        states[node_id] = {
            "status": derive_status(records),
            "evidence": records,
            "updatedAt": records[-1].get("at") or (node_state or {}).get("updatedAt") or "",
        }
    return states


def get_node_states(group_id: str, activity_id: str) -> dict[str, dict[str, Any]]:
    """The group's node states for one activity — ``{}`` when nothing is
    recorded yet (every node reads ``not_yet``).

    Each value is ``{"status": <derived>, "evidence": [<record>, ...],
    "updatedAt": ...}``. ``status`` is computed, not read from the document.
    """
    if not group_id or not activity_id:
        return {}
    doc = get_document(_COLLECTION, _doc_id(group_id, activity_id))
    return states_from_stored((doc or {}).get("nodeStates", {}))


def record_concept_evidence(
    group_id: str,
    activity_id: str,
    node_id: str,
    status: NodeStatus,
    evidence_summary: str,
    *,
    kind: EvidenceKind = "checkpoint",
    class_id: str = "",
) -> dict[str, dict[str, Any]]:
    """Append one evidence record and return the updated state map.

    Merge-write: other nodes are untouched, and this node's earlier records are
    kept. The caller supplies ``group_id`` AND ``class_id`` from the VERIFIED
    session identity (the signed ``class:<owner>:<id>`` group tag) — neither may
    ever be a model-controlled parameter.

    ``class_id`` (CONCEPT-2 M4) is what makes the class rollup ONE indexed query.
    It is stamped rather than derived at read time on purpose: a revoked group
    code is removed from its class, so deriving the class from the class's
    CURRENT codes would erase that group's year from the aggregate the moment a
    teacher tidied up. Empty for an unbound group (a workshop session), which
    then simply does not appear in any class's rollup.
    """
    now = datetime.now(UTC).isoformat()
    doc = get_document(_COLLECTION, _doc_id(group_id, activity_id))
    stored = (doc or {}).get("nodeStates", {})
    stored = stored if isinstance(stored, dict) else {}

    records = _trim(
        [
            *_records(stored.get(node_id)),
            {
                "kind": kind,
                "status": status,
                "summary": evidence_summary[:500],
                "activityId": activity_id,
                "at": now,
            },
        ]
    )
    # Rewrite every node in the new shape: a merge-write leaves the others'
    # stored slots alone otherwise, so a document would sit half-migrated and
    # the next reader would have to handle both shapes for longer than needed.
    next_states = {nid: {"evidence": _records(st), "updatedAt": now} for nid, st in stored.items()}
    next_states[node_id] = {"evidence": records, "updatedAt": now}

    doc_fields: dict[str, Any] = {
        "groupId": group_id,
        "activityId": activity_id,
        "nodeStates": next_states,
        "updatedAt": now,
    }
    if class_id:
        doc_fields["classId"] = class_id
    set_document(_COLLECTION, _doc_id(group_id, activity_id), doc_fields, merge=True)
    return states_from_stored(next_states)


def record_checkpoint_state(
    group_id: str,
    activity_id: str,
    node_id: str,
    status: NodeStatus,
    evidence_summary: str,
    *,
    class_id: str = "",
) -> dict[str, dict[str, Any]]:
    """Record a deliberate checkpoint outcome (``kind="checkpoint"``)."""
    return record_concept_evidence(
        group_id, activity_id, node_id, status, evidence_summary, kind="checkpoint", class_id=class_id
    )


def docs_for_class(class_id: str) -> list[dict[str, Any]]:
    """Every ``concept_progress`` document stamped with this class (M4).

    Documents written before the stamp existed carry no ``classId`` and are
    invisible here until ``scripts/backfill_concept_progress_class_id.py`` runs.
    That is deliberate: a rollup that silently guessed at unstamped history
    would be the "checker answers when it could not read its subject" failure,
    and the script is idempotent.
    """
    from db.firestore import query_documents

    if not class_id:
        return []
    return query_documents(collection=_COLLECTION, filters=[("classId", "==", class_id)])


def clear_progress_for_group(group_id: str, activity_id: str | None = None) -> int:
    """Clear a group's concept-map progress. Returns how many docs went.

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


__all__ = [
    "MAX_RECORDS_PER_NODE",
    "EvidenceKind",
    "NodeStatus",
    "clear_progress_for_group",
    "derive_status",
    "docs_for_class",
    "get_node_states",
    "record_checkpoint_state",
    "record_concept_evidence",
    "states_from_stored",
]
