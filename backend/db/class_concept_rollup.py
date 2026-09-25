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


def frontier_nodes(
    node_ids: list[str],
    edges: list[tuple[str, str]],
    demonstrated: set[str],
) -> list[str]:
    """Nodes not demonstrated whose prerequisites all are — the "what's next".

    ONE definition, used twice: by the tutor's steering block for one group in
    one activity (``adk.concept_steering``), and by the class-level pairing
    below across every activity a class has run. Two implementations of "what is
    this group ready for" that could drift apart is the kind of split this repo
    keeps paying for.

    With nothing demonstrated this returns the roots, which needs no special
    case: a root has no prerequisites, so "all of them are demonstrated" is
    vacuously true. A ``partial`` node is not demonstrated, so it stays ON the
    frontier — half-understood is exactly where the work still is.
    """
    prereqs: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for src, dst in edges:
        if dst in prereqs:
            prereqs[dst].append(src)
    return [n for n in node_ids if n not in demonstrated and all(p in demonstrated for p in prereqs[n])]


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


def _label_edges(activity_id: str) -> list[tuple[str, str]]:
    """One activity's prerequisite edges, keyed by normalised label.

    Translated out of node ids for the same reason the concepts are: across
    activities an id means nothing. Each activity's own map is cycle-guarded
    server-side, but the UNION of several is not — two teachers can legitimately
    disagree about which of two concepts comes first. The renderer tolerates
    that (``conceptLayers`` relaxes a bounded number of passes), so a
    disagreement is left visible rather than one activity's ordering being
    silently dropped to satisfy a layout.
    """
    activity = get_activity(activity_id)
    if activity is None or not activity.concept_map:
        return []
    cmap = activity.concept_map[0]
    labels = {n.id: normalise_concept(n.label) for n in cmap.nodes}
    out = []
    for edge in cmap.edges:
        src, dst = labels.get(edge.from_), labels.get(edge.to)
        if src and dst and src != dst:
            out.append((src, dst))
    return out


def class_concept_distribution(class_id: str) -> dict[str, Any]:
    """Every concept this class's activities have mapped, with its spread.

    Returns::

        {
          "classId": ...,
          "groups": [group_id, ...],        # groups with ANY record in this class
          "edges": [{"from": <normalised>, "to": <normalised>}, ...],
          "concepts": [
            {"concept": "Vektorer",          # the teacher's label, first seen
             "byGroup": {group_id: status},  # one entry per group WITH a record
             "counts": {"demonstrated": 3, "partial": 2, "not_yet": 0},
             "activityIds": [...],           # every activity that mapped it
             "key": "vektorer",              # the normalised join key (what edges name)
             "flags": [{"groupId": ..., "kind": "provenance"|"regressed"}],
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
        return {"classId": class_id, "groups": [], "concepts": [], "edges": []}

    labels_cache: dict[str, dict[str, str]] = {}
    by_concept: dict[str, dict[str, Any]] = {}
    groups: set[str] = set()
    edges: set[tuple[str, str]] = set()

    for doc in docs:
        group_id = doc.get("groupId") or ""
        activity_id = doc.get("activityId") or ""
        if not group_id or not activity_id:
            continue
        groups.add(group_id)
        if activity_id not in labels_cache:
            labels_cache[activity_id] = _node_labels(activity_id)
            edges.update(_label_edges(activity_id))
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
                {"concept": label, "key": key, "byGroup": {}, "activityIds": [], "nodeIds": [], "_records": {}},
            )
            if activity_id not in entry["activityIds"]:
                entry["activityIds"].append(activity_id)
            if node_id not in entry["nodeIds"]:
                entry["nodeIds"].append(node_id)
            entry["byGroup"][group_id] = _stronger(entry["byGroup"].get(group_id), state.get("status"))
            entry["_records"].setdefault(group_id, []).extend(state.get("evidence", []))

    concepts = []
    for entry in by_concept.values():
        counts: dict[str, int] = defaultdict(int)
        for status in entry["byGroup"].values():
            counts[status] += 1
        entry["counts"] = {s: counts.get(s, 0) for s in STATUSES}
        entry["flags"] = [
            {"groupId": gid, "kind": kind}
            for gid, records in sorted(entry.pop("_records").items())
            for kind in concept_flags(records)
        ]
        concepts.append(entry)
    concepts.sort(key=lambda e: e["concept"].lower())
    known = {c["key"] for c in concepts}
    graph_edges = [{"from": a, "to": b} for a, b in sorted(edges) if a in known and b in known]

    logger.info(
        "class rollup: class=%s groups=%d concepts=%d from %d document(s)",
        class_id,
        len(groups),
        len(concepts),
        len(docs),
    )
    return {"classId": class_id, "groups": sorted(groups), "concepts": concepts, "edges": graph_edges}


def targets_for_concept(cls: Any, concept_key: str) -> list[tuple[str, str]]:
    """Every ``(activity_id, node_id)`` in this class that maps one concept.

    A teacher's override is written to ALL of them, not one. The rollup takes a
    group's BEST showing across the activities that teach a concept (``_stronger``),
    so an override applied to a single activity while another still says
    ``demonstrated`` would read as having done nothing — the teacher would press
    the control and watch the node not move.
    """
    out: list[tuple[str, str]] = []
    for activity_id in getattr(cls, "activity_ids", []) or []:
        activity = get_activity(activity_id)
        if activity is None or not activity.concept_map:
            continue
        for node in activity.concept_map[0].nodes:
            if normalise_concept(node.label) == concept_key:
                out.append((activity_id, node.id))
    return out


def concept_flags(records: list[dict[str, Any]]) -> list[str]:
    """The genuine conflicts inside ONE group's evidence for one concept (M6).

    Not disagreements BETWEEN groups — those are the class's shape, and the
    whole point of the distribution. These are two readings that cannot both be
    the current one, and a teacher should not have to find them among thirty
    nodes:

    * ``provenance`` — a passive mark and a deliberate checkpoint disagree.
      Either the tutor read the room wrong, or the student has moved since.
    * ``regressed`` — a later record is weaker than an earlier one. Forgetting,
      or the same concept meaning something harder in a second activity.

    Ordered by ``at`` first, because records arrive here merged across several
    activities and a document's own order says nothing about the class's.
    """
    ordered = sorted(records, key=lambda r: str(r.get("at") or ""))
    flags: list[str] = []
    rank = {s: i for i, s in enumerate(STATUSES)}

    latest: dict[str, str] = {}
    for record in ordered:
        kind, status = str(record.get("kind") or ""), str(record.get("status") or "")
        if kind and status:
            latest[kind] = status
    if "observed" in latest and "checkpoint" in latest and latest["observed"] != latest["checkpoint"]:
        flags.append("provenance")

    best = -1
    for record in ordered:
        here = rank.get(str(record.get("status")), -1)
        if here < best:
            flags.append("regressed")
            break
        best = max(best, here)
    return flags


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
    "complementary_pairs",
    "concept_flags",
    "frontier_nodes",
    "normalise_concept",
    "suggest_activity_links",
    "targets_for_concept",
]


def complementary_pairs(class_id: str) -> dict[str, Any]:
    """Which groups in this class would have something to give each other (M7).

    *"We want to help link groups that are mastering different trees of the
    class levels"* (M, 2026-09-25). This is [2.9]'s capability 3 at class scope,
    and it is cheap only because the class rollup and ``frontier_nodes`` already
    exist: for each group, what it has DEMONSTRATED and what it is READY FOR;
    a pair is complementary when one group's demonstrated set covers something
    on the other's frontier.

    Mutual pairs — each has something for the other, on different concepts — are
    listed first, because that is an exchange rather than one group tutoring
    another, and it is the shape a teacher can act on without singling anyone
    out.

    ⚠️ **This must never become a ranking.** It names the CONCEPT a pair would
    exchange and no score, it is teacher-facing only, and nothing here reports
    how far ahead any group is. "Which groups are ahead" is one careless change
    from "which groups are behind", and a class can read that off a teacher's
    screen.
    """
    rollup = class_concept_distribution(class_id)
    concepts = rollup["concepts"]
    if not concepts:
        return {"classId": class_id, "pairs": []}

    keys = [c["key"] for c in concepts]
    label_of = {c["key"]: c["concept"] for c in concepts}
    edges = [(e["from"], e["to"]) for e in rollup["edges"]]

    demonstrated: dict[str, set[str]] = {}
    for concept in concepts:
        for group_id, status in concept["byGroup"].items():
            if status == "demonstrated":
                demonstrated.setdefault(group_id, set()).add(concept["key"])
    for group_id in rollup["groups"]:
        demonstrated.setdefault(group_id, set())

    frontier = {g: set(frontier_nodes(keys, edges, have)) for g, have in demonstrated.items()}

    pairs = []
    ordered = sorted(demonstrated)
    for i, a in enumerate(ordered):
        for b in ordered[i + 1 :]:
            a_gives = sorted(demonstrated[a] & frontier[b])
            b_gives = sorted(demonstrated[b] & frontier[a])
            if not a_gives and not b_gives:
                continue
            pairs.append(
                {
                    "groups": [a, b],
                    "aGives": [label_of[k] for k in a_gives],
                    "bGives": [label_of[k] for k in b_gives],
                    "mutual": bool(a_gives and b_gives),
                }
            )

    # Mutual first, then the larger exchange, then alphabetical so the list is
    # stable between reads. Ordering PAIRS by the shape of the exchange is not
    # ranking groups — nothing here says who is further on.
    pairs.sort(key=lambda p: (not p["mutual"], -(len(p["aGives"]) + len(p["bGives"])), p["groups"]))
    logger.info("class pairings: class=%s %d candidate pair(s)", class_id, len(pairs))
    return {"classId": class_id, "pairs": pairs}
