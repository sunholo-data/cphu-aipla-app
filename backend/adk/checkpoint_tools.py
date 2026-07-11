"""Chat-native checkpoint tools (living-concept-map M3 / CONCEPT-1).

Built PER SESSION at agent-build time (the ``build_curriculum_retrieval_tool``
precedent in ``agent.py``): the closures capture the session's resolved
``ActivityConfig`` and the VERIFIED student identity, so the model can never
name another group or activity — ``group_id`` is not a tool parameter.

The delivery principle (M, 2026-07-10): student assessment is CHAT-NATIVE. The
tutor asks a node's check questions in conversation, in its own voice, judges
the answers against the teacher's ``expected_answer`` rubric, and records the
outcome with ``evidence.kind="checkpoint"`` — the map element stays read-only
orientation and never becomes a quiz form.

Axiom-10 note (RESOLVED, STRIP-1): ``run_checkpoint`` returns the expected
answers TO THE MODEL as judging material. Tool results used to ride the SSE
stream readable by a devtools-savvy student; ``adk/stream_redaction.py`` now
redacts server-only tool results at the SSE boundary for anonymous-group
sessions (``record_checkpoint``'s card-safe return stays visible).
"""

from __future__ import annotations

import logging
from typing import Any

from google.adk.tools import FunctionTool

from auth.firebase_auth import User
from db.concept_progress import get_node_states, record_checkpoint_state
from db.models.activity_config import ActivityConfig, ConceptMapElement

logger = logging.getLogger(__name__)


def _node_list(cmap: ConceptMapElement) -> list[dict[str, str]]:
    return [{"id": n.id, "label": n.label} for n in cmap.nodes]


def build_checkpoint_tools(cfg: ActivityConfig | None, user: User) -> list[FunctionTool]:
    """The session's checkpoint tools — empty when they don't apply.

    Attached only when the activity carries a concept map AND the caller is an
    anonymous-group student (``user.group_id``). Teachers previewing an
    activity get no checkpoint tools: there is no group to record against.
    """
    if cfg is None or not cfg.concept_map or not user.group_id:
        return []

    cmap = cfg.concept_map[0]
    group_id = user.group_id
    activity_id = cfg.activity_id

    def run_checkpoint(node_id: str) -> dict[str, Any]:
        """Start a checkpoint on one concept: get its check questions to ask in chat.

        Ask the questions ONE AT A TIME, conversationally, in your own voice —
        never as a form or a quiz dump. Judge the student's answers against each
        question's expected answer, then record the outcome with
        ``record_checkpoint``. Use at a natural moment (the concept looks nearly
        understood, or an end-of-activity wrap-up), not mid-struggle.

        Args:
            node_id: the concept to check (see the concept map in your context).

        Returns:
            The node's questions + judging guidance, or the valid node ids.
        """
        node = next((n for n in cmap.nodes if n.id == node_id), None)
        if node is None:
            return {"ok": False, "error": f"unknown node {node_id!r}", "nodes": _node_list(cmap)}
        if not node.check_questions:
            return {
                "ok": False,
                "error": f"{node.label!r} has no check questions — assess it conversationally instead",
                "nodes": _node_list(cmap),
            }
        return {
            "ok": True,
            "node": {"id": node.id, "label": node.label},
            "questions": [
                {"prompt": q.prompt, "expectedAnswer": q.expected_answer, "explanation": q.explanation}
                for q in node.check_questions
            ],
            "guidance": (
                "Ask these one at a time in your own voice, in the session language. Judge each answer "
                "against its expectedAnswer. When done, call record_checkpoint with passed=true only if "
                "the student demonstrated the concept."
            ),
        }

    def record_checkpoint(node_id: str, passed: bool, evidence_summary: str) -> dict[str, Any]:
        """Record a finished checkpoint's outcome on the group's concept map.

        Call ONCE per run_checkpoint, after the student has answered. ``passed``
        marks the concept demonstrated and lights it up on the student's map;
        otherwise it is marked partial (progress, framed as "på vej" — never as
        failure). Keep ``evidence_summary`` to one concrete sentence about what
        the student showed (it is displayed to the student and the teacher).

        Args:
            node_id: the concept that was checked.
            passed: whether the student demonstrated the concept.
            evidence_summary: one sentence of evidence, e.g. "dekomponerede
                30°-kastet i vx og vy uden hjælp".

        Returns:
            The updated node-status map.
        """
        node = next((n for n in cmap.nodes if n.id == node_id), None)
        if node is None:
            return {"ok": False, "error": f"unknown node {node_id!r}", "nodes": _node_list(cmap)}
        status = "demonstrated" if passed else "partial"
        states = record_checkpoint_state(group_id, activity_id, node_id, status, evidence_summary.strip())
        logger.info(
            "checkpoint: %s -> %s for group=%s activity=%s",
            node_id,
            status,
            group_id,
            activity_id,
        )
        return {
            "ok": True,
            "node": {"id": node.id, "label": node.label},
            "status": status,
            # Echoed for the chat CheckpointCard — the student sees WHY.
            "evidence": evidence_summary.strip()[:500],
            "nodeStates": {nid: s.get("status") for nid, s in states.items()},
        }

    return [FunctionTool(run_checkpoint), FunctionTool(record_checkpoint)]


def checkpoint_state_summary(cfg: ActivityConfig | None, user: User) -> str:
    """A compact per-session status line for the tutor's context — which
    concepts are already demonstrated/partial for this group. Empty when there
    is nothing to say (no map, no group, or no recorded state yet)."""
    if cfg is None or not cfg.concept_map or not user.group_id:
        return ""
    states = get_node_states(user.group_id, cfg.activity_id)
    if not states:
        return ""
    parts = [f"{nid}={s.get('status')}" for nid, s in sorted(states.items())]
    return "Current checkpoint state for this group: " + ", ".join(parts)


__all__ = ["build_checkpoint_tools", "checkpoint_state_summary"]
