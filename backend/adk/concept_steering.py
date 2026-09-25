"""The concept map as a boundary and a frontier, not just a record (CONCEPT-2 M0).

**The report.** M, 2026-09-25: *"tutors stray from the lesson plans despite
keeping character."* The 1 September meeting said the same thing five ways —
*"AI goes off on a tangent not related to what we want"*, *"we want to steer the
AI to only talk around the cognitive map"* ([1.1.90
bounded-tutoring-answer-trees](../../docs/design/aipla/v1.1.0-feedback/bounded-tutoring-answer-trees.md)).

**What the tutor already had**, contrary to what 1.1.90's "what already exists"
table says:

* the map's nodes, prerequisite edges and the checkpoint contract —
  ``teacher_focus.compose_teacher_focus`` (CONCEPT-1 M3);
* the group's CURRENT node statuses, labelled and dated, refreshed **every
  turn** — ``progress_context.compose_progress_context`` via
  ``checkpoint_tools.checkpoint_state_summary``. (``create_agent_with_thinking``
  runs per request, so what reads like a build-time block is a per-turn block;
  ``progress_context``'s own docstring records the same correction against
  1.1.70.)

So the tutor could see the map and the progress against it, and still had no
reason to treat either as a limit. This module adds the two things that were
actually missing:

1. **A boundary.** These concepts are what the lesson is for. The transcript is
   explicit that this must permit *"limited deviation"* — a student's tangent is
   often the teachable moment, and a tutor that refuses every off-map remark is
   a worse tutor. So the block licenses the excursion and requires the return,
   rather than forbidding departure.
2. **A frontier.** Given the prerequisite DAG and what this group has
   demonstrated, the concepts whose prerequisites are all met and which are not
   yet demonstrated. Without it the map is a record; with it the map is a plan.

**Status is never inferred here.** The frontier is a pure function of the
authored edges and the stored states — this module reads the concept store and
writes nothing.

Composed for **group students only**, like ``checkpoint_state_summary``: a
teacher using the authoring co-pilot is not inside the lesson and must not be
bounded by its map.
"""

from __future__ import annotations

import logging

from adk.prompt_budget import fit_lines
from auth.firebase_auth import User
from db.class_concept_rollup import frontier_nodes
from db.concept_progress import get_node_states
from db.models.activity_config import ActivityConfig, ConceptMapElement

logger = logging.getLogger(__name__)

# This block's share of the per-turn prompt budget. The boundary paragraph is a
# constant (~700 chars), so the only growth vector is the frontier line — a
# handful of labels even on a 30-node map, because a frontier is an antichain of
# the DAG rather than the whole map, and ``_FRONTIER_CAP`` bounds it anyway.
# ``CONCEPT_STEERING_CAP`` sits just above that structural maximum — it is the
# "something went unbounded" alarm, the same idea as
# ``teacher_focus._TOTAL_FOCUS_CAP``, and not a working limit.
CONCEPT_STEERING_CAP = 1300
_FRONTIER_CAP = 300

_DEMONSTRATED = "demonstrated"

_BOUNDARY = (
    "## The edges of this lesson\n"
    "The concepts in the concept map above are what this activity is for. Treat them as the boundary "
    "of the conversation — not as a script, and not as an order to teach in.\n"
    "- If the student raises something outside them, take it seriously for a turn: answer briefly or "
    "acknowledge it, then bring the conversation back. Never refuse a question, and never lecture the "
    "student about staying on topic.\n"
    "- A tangent that leads back into one of these concepts is not a digression. Follow it.\n"
    "- Do not open concepts of your own that are not on the map, and do not widen the lesson because "
    "the student is doing well. Going deeper on these concepts is the goal; covering more is not."
)


def _frontier(cmap: ConceptMapElement, states: dict[str, dict]) -> list[str]:
    """This activity's frontier for this group.

    The graph rule itself lives in ``db.class_concept_rollup.frontier_nodes``
    and is shared with the class-level pairing (CONCEPT-2 M7), which asks the
    same question — what is this group ready for — across every activity a class
    has run. Two implementations that could drift apart is the split this repo
    keeps paying for; this function is the per-activity adapter and nothing
    more.
    """
    done = {node_id for node_id, s in states.items() if (s or {}).get("status") == _DEMONSTRATED}
    return frontier_nodes(
        [n.id for n in cmap.nodes],
        [(e.from_, e.to) for e in cmap.edges],
        done,
    )


def build_concept_steering_block(cfg: ActivityConfig | None, user: User) -> str:
    """The boundary + frontier block, or ``""`` when it does not apply.

    Empty for an activity with no concept map and for any caller who is not a
    group student, so the 224 prod activities without a map (measured
    2026-09-25) compose byte-identically to before.

    A read failure must never cost a session — the same rule
    ``compose_progress_context`` applies: the boundary still composes, and only
    the frontier is lost.
    """
    if cfg is None or not cfg.concept_map or not user.group_id:
        return ""
    cmap = cfg.concept_map[0]
    if not cmap.nodes:
        return ""

    try:
        states = get_node_states(user.group_id, cfg.activity_id)
    except Exception:
        logger.exception("concept steering: node states unreadable — composing the boundary alone")
        states = {}

    labels = {n.id: n.label for n in cmap.nodes}
    frontier = _frontier(cmap, states)

    if not frontier:
        # Every node demonstrated. Naming no frontier would leave the tutor to
        # infer what to do with a finished map; the likeliest inference is to
        # wrap up, which is the 1.1.70 failure in a different costume.
        line = (
            "Every concept on this map is recorded as demonstrated for this group. Consolidate: connect "
            "them to each other and to the student's own examples rather than opening new ground, and "
            "revisit anything they sound unsure of."
        )
    else:
        kept, dropped = fit_lines([f'"{labels[node_id]}"' for node_id in frontier], _FRONTIER_CAP)
        more = f" (+{dropped} more)" if dropped else ""
        line = (
            f"Where this can go next: {', '.join(kept)}{more} — every concept these build on is already "
            "demonstrated by this group. This is where the map says the ground is open; it is a "
            "suggestion for your next move, not an order to work through."
        )

    block = f"\n\n{_BOUNDARY}\n{line}"
    if len(block) > CONCEPT_STEERING_CAP:
        logger.warning("concept steering: block is %d chars, over the %d cap", len(block), CONCEPT_STEERING_CAP)
    return block


__all__ = ["CONCEPT_STEERING_CAP", "build_concept_steering_block"]
