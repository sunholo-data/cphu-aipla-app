"""Student writing — the text a group has written into a writing element (1.1.73).

Firestore document at ``writing_progress/{group_id}:{activity_id}``. Sibling of
``db/checklist_progress.py`` and ``db/concept_progress.py``, and deliberately the
same shape: one idiom for per-group student state, not a third bespoke store.

GROUP-keyed, never per-student (ADR-001: no individual profiling). Whether an
essay *should* be group-shared is a real pedagogical question and is open with JB
(design doc, human gate 3) — but a per-student store would be the first
individual-level student record in the system, so the default stays group-level
until that conversation happens, not after it is quietly pre-empted by code.

**Why this is not sessionStorage.** ``WorkbenchTable`` keys its cells by
``sessionStorage``, per browser. ``checklist_progress`` records what that costs,
in as many words: *"three group members had three private checklists and none of
them survived a closed tab."* A draft written across two lessons on two devices
has exactly that shape, only with more to lose.

**Why there is no clear-on-reset here, unlike the checklist.** PILOT-1 M0 made
the teacher's [Reset session] clear ``checklist_progress`` — right, because a tick
is a formative marker of a conversation that no longer exists. A student's prose
is not a marker of anything; it is the student's own work, and Axiom 2 says they
own it. A reset that silently deletes an essay is a data-loss bug wearing the
costume of a feature. If clearing written work ever becomes wanted, it needs to
be a separate, explicitly-labelled action with the student's knowledge.

Shape::

    {
      "groupId": ..., "activityId": ...,
      "docs": {
        "<element_id>": {
          "text": "...",
          "words": 142,
          "revision": 7,        # monotonic; the conflict NOTICE keys on it
          "updatedAt": <iso8601>,
        }
      },
      "updatedAt": <iso8601>,
    }

``words`` is computed HERE, on write, rather than trusted from the client: the
tutor's fill-state block reports it as evidence (``element_state.py``), and a
count the client could pick would be a number the student can talk the tutor
past. ``revision`` is a counter for the "someone else edited this" notice, not a
merge base — real collaborative editing is explicitly out of scope.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from db.firestore import get_document, set_document

_COLLECTION = "writing_progress"

# Hard ceiling, mirroring ``WritingElement.max_chars``'s own upper bound. The
# per-element ``max_chars`` may be lower; the route enforces that one. This is
# the backstop that holds even if an element is authored (or migrated) oddly.
MAX_TEXT_CHARS = 20000


def _doc_id(group_id: str, activity_id: str) -> str:
    return f"{group_id}:{activity_id}"


def count_words(text: str) -> int:
    """Whitespace-delimited word count — the one definition of "how much have
    they written", used by the store, the routes and the tutor's fill state."""
    return len((text or "").split())


def get_docs(group_id: str, activity_id: str) -> dict[str, dict[str, Any]]:
    """The group's written text for one activity, keyed by element id.

    ``{}`` when nothing is recorded yet — which reads as every writing element
    being empty, and is the *normal* state before a student types.
    """
    if not group_id or not activity_id:
        return {}
    doc = get_document(_COLLECTION, _doc_id(group_id, activity_id))
    docs = (doc or {}).get("docs", {})
    return docs if isinstance(docs, dict) else {}


def record_doc(
    group_id: str,
    activity_id: str,
    element_id: str,
    *,
    text: str,
) -> dict[str, Any]:
    """Save one writing element's text and return the updated entry.

    Merge-write: other elements on the same activity are untouched. The caller
    supplies ``group_id`` from the VERIFIED session identity — never a request
    field (the same rule as ``checklist_progress``; ``user.email`` / ``domain``
    are empty strings for anonymous-group students and would key a Firestore
    path to ``400 invalid document path``).
    """
    now = datetime.now(UTC).isoformat()
    docs = get_docs(group_id, activity_id)
    previous = docs.get(element_id) or {}
    clipped = (text or "")[:MAX_TEXT_CHARS]
    entry: dict[str, Any] = {
        "text": clipped,
        "words": count_words(clipped),
        "revision": int(previous.get("revision", 0) or 0) + 1,
        "updatedAt": now,
    }
    docs[element_id] = entry
    set_document(
        _COLLECTION,
        _doc_id(group_id, activity_id),
        {"groupId": group_id, "activityId": activity_id, "docs": docs, "updatedAt": now},
        merge=True,
    )
    return entry
