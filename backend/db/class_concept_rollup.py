"""The class's concept picture across a year — a DISTRIBUTION, not a union.

CONCEPT-2 M4, executing [1.1.121] with one correction the design needed.

## Why not a union

1.1.121 M0 proposed that *"a class's progress on that concept is the union of
what any of its groups demonstrated"*. M, 2026-09-25: *"the class level may
disagree with group level mastery, and indeed we want to help link groups that
are mastering different trees."* A union destroys exactly that. If group A has
*vektorer* and group B does not, the union reports that the class has *vektorer*
and the teacher can no longer see the split — or which two groups to put
together (M7).

So the per-(group, concept) record in ``db.concept_progress`` stays the only
stored truth, and a class's view of a concept is **the spread of its groups'
statuses**, computed here and stored nowhere.

## Why the join is on labels

The same design assumed activities "share node ids". Template copies do — 55 of
the 56 activities carrying a map on prod on 2026-09-25 came from three
templates — but two independently authored maps never will: an id is minted per
activity from its own label (``_concept_slug``) or as ``node-<n>``. Joining on
ids would show a class a graph of duplicated nodes, one per activity, which is
the opposite of the point. So concepts are joined on a **normalised label**.

That join is deliberately conservative: it merges *"Vektorer"* and *"vektorer "*,
and does not merge *"Vektorer"* with *"Vektorregning"*. Merging synonyms is an
aliasing problem, and guessing at it would silently overstate a class's
coverage — the failure mode worth avoiding here, since the number is read as
evidence.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

from db.activities import get_activity
from db.concept_progress import docs_for_class, states_from_stored

logger = logging.getLogger(__name__)

#: Order used when reporting counts, weakest first.
STATUSES = ("not_yet", "partial", "demonstrated")


def normalise_concept(label: str) -> str:
    """The join key: case-folded, whitespace-collapsed. Nothing cleverer."""
    return " ".join(label.lower().split())


def suggest_activity_links(
    activity_id: str,
    candidate_ids: list[str],
) -> list[dict[str, Any]]:
    """Candidate links from shared concepts — the cheap proposal (M4).

    Two activities whose maps carry the same normalised label are a candidate
    link, with no NLP required. Proposed, never written: a link is the teacher's
    statement about their own curriculum.
    """
    own = _concepts_by_label(activity_id)
    if not own:
        return []
    out: list[dict[str, Any]] = []
    for other_id in candidate_ids:
        if other_id == activity_id:
            continue
        shared = sorted(set(own) & set(_concepts_by_label(other_id)))
        if shared:
            out.append({"toActivityId": other_id, "viaConcepts": [own[k] for k in shared]})
    return out


def _concepts_by_label(activity_id: str) -> dict[str, str]:
    """``{normalised: teacher's label}`` for one activity's map, or ``{}``."""
    activity = get_activity(activity_id)
    if activity is None or not activity.concept_map:
        return {}
    return {normalise_concept(n.label): n.label for n in activity.concept_map[0].nodes if n.label.strip()}


def _node_labels(activity_id: str) -> dict[str, str]:
    """``{node_id: label}`` for one activity's map, or ``{}``."""
    activity = get_activity(activity_id)
    if activity is None or not activity.concept_map:
        return {}
    return {n.id: n.label for n in activity.concept_map[0].nodes}


def class_concept_distribution(class_id: str) -> dict[str, Any]:
    """Every concept this class's activities have mapped, with its spread.

    Returns::

        {
          "classId": ...,
          "groups": [group_id, ...],        # groups with ANY record in this class
          "concepts": [
            {"concept": "Vektorer",          # the teacher's label, first seen
             "byGroup": {group_id: status},  # one entry per group WITH a record
             "counts": {"demonstrated": 3, "partial": 2, "not_yet": 0},
             "activityIds": [...],           # every activity that mapped it
             "nodeIds": [...]},              # its id in each of those
            ...
          ],
        }

    A group with no record for a concept is simply absent from ``byGroup``. It
    is NOT reported as ``not_yet``: "has not shown it" and "never met it" are
    different facts about a class, and flattening them here would make the
    weakest reading the default one. The caller has the class's group codes and
    can name the difference (1.1.121 open question 5).
    """
    docs = docs_for_class(class_id)
    if not docs:
        return {"classId": class_id, "groups": [], "concepts": []}

    labels_cache: dict[str, dict[str, str]] = {}
    by_concept: dict[str, dict[str, Any]] = {}
    groups: set[str] = set()

    for doc in docs:
        group_id = doc.get("groupId") or ""
        activity_id = doc.get("activityId") or ""
        if not group_id or not activity_id:
            continue
        groups.add(group_id)
        if activity_id not in labels_cache:
            labels_cache[activity_id] = _node_labels(activity_id)
        labels = labels_cache[activity_id]

        for node_id, state in states_from_stored(doc.get("nodeStates", {})).items():
            # An activity whose map was edited after a group worked on it can
            # leave a record whose node no longer exists. Keep it under the id
            # rather than dropping the evidence — it is still something that
            # happened, and a silently shorter aggregate is the worse error.
            label = labels.get(node_id, node_id)
            key = normalise_concept(label)
            entry = by_concept.setdefault(
                key,
                {"concept": label, "byGroup": {}, "activityIds": [], "nodeIds": []},
            )
            if activity_id not in entry["activityIds"]:
                entry["activityIds"].append(activity_id)
            if node_id not in entry["nodeIds"]:
                entry["nodeIds"].append(node_id)
            entry["byGroup"][group_id] = _stronger(entry["byGroup"].get(group_id), state.get("status"))

    concepts = []
    for entry in by_concept.values():
        counts: dict[str, int] = defaultdict(int)
        for status in entry["byGroup"].values():
            counts[status] += 1
        entry["counts"] = {s: counts.get(s, 0) for s in STATUSES}
        concepts.append(entry)
    concepts.sort(key=lambda e: e["concept"].lower())

    logger.info(
        "class rollup: class=%s groups=%d concepts=%d from %d document(s)",
        class_id,
        len(groups),
        len(concepts),
        len(docs),
    )
    return {"classId": class_id, "groups": sorted(groups), "concepts": concepts}


def _stronger(current: str | None, incoming: str | None) -> str:
    """The better of one group's two readings of the SAME concept.

    This is the one place a union is right, and its scope is one group: the
    group met the concept in two activities and got it in one of them. Across
    groups the spread is the answer, which is why this never runs there.
    """
    order = {s: i for i, s in enumerate(STATUSES)}
    if current is None:
        return incoming or "not_yet"
    if incoming is None:
        return current
    return incoming if order.get(incoming, 0) > order.get(current, 0) else current


__all__ = [
    "STATUSES",
    "class_concept_distribution",
    "normalise_concept",
    "suggest_activity_links",
]
