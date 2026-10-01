"""Assessment as a tool, not a tag (1.1.133 M3).

The ``sol-jord-maane`` author's module has the tutor write
``<vurdering>{"mission": "M2", "niveau": 4, "faenomen": "aarstider", …}</vurdering>``
lines in its reply, for the host to strip and store. A regex over prose is not
assessment evidence: it streams to the student before the closing tag exists,
nothing validates it, and it is invisible to every structured surface. So it is
``record_assessment(phenomenon, level, evidence, misconception?, mission?)``:

- **Only on a sim that defines a construct map** (``ArtefactMeta.assessment``),
  and its enums ARE that map — so assessments recorded by different tutors land
  on one scale, which is the author's stated purpose (*"så den kan sammenlignes
  mellem instruktører"*).
- **Hidden from the student, structurally.** The tool is in
  ``stream_redaction._STUDENT_HIDDEN_TOOLS``: every AG-UI event of the call —
  start, args (which carry the level), end, result — is dropped from a student
  stream. "Never show the student a level" stops being a prompt instruction.
  The precedent is ``record_checkpoint`` (CONCEPT-1), with the opposite
  visibility.
- **Written to the chat log** with the tutor, its version and framework stamped
  at emit time (TUTOR-5), and ``revision`` by the emitter — the row the
  researcher lens compares tutors on. It rides the workbench-event table (no new
  sink), as ``tool = "record_assessment"``, ``field = <phenomenon>``.

Built per session for an anonymous-group student only: there is no group to
attribute a teacher's preview to, and ``group_id`` must never become a parameter.
"""

from __future__ import annotations

import logging
from typing import Any

from google.adk.tools import FunctionTool, ToolContext
from google.genai import types

logger = logging.getLogger(__name__)

TOOL_NAME = "record_assessment"

_EVIDENCE_MAX = 600
_MISCONCEPTION_MAX = 300


class _AssessmentTool(FunctionTool):
    """Declaration narrowed to the sim's own construct map."""

    def __init__(self, func: Any, *, phenomena: list[str], missions: list[str], lo: int, hi: int) -> None:
        super().__init__(func)
        self._phenomena = phenomena
        self._missions = missions
        self._lo, self._hi = lo, hi

    def _get_declaration(self) -> types.FunctionDeclaration | None:
        decl = super()._get_declaration()
        if decl is None or decl.parameters is None or not decl.parameters.properties:  # pragma: no cover
            return decl
        props = decl.parameters.properties
        props["phenomenon"].enum = list(self._phenomena)
        props["level"].minimum = self._lo
        props["level"].maximum = self._hi
        if self._missions and "mission" in props:
            # The Optional[str] declaration is an any_of; replace it with a
            # plain string enum the model can read.
            props["mission"] = types.Schema(type=types.Type.STRING, enum=list(self._missions))
        if "misconception" in props:
            props["misconception"] = types.Schema(type=types.Type.STRING)
        return decl


def build_assessment_tools(
    cfg: Any,
    user: Any,
    *,
    skill_id: str = "",
    teaching: Any = None,
) -> list[FunctionTool]:
    """The session's ``record_assessment`` tool — empty when it does not apply."""
    artefact_id = getattr(cfg, "artefact_id", None) if cfg is not None else None
    group_id = getattr(user, "group_id", None)
    if not artefact_id or not group_id:
        return []
    from artefacts.loader import load_artefact

    meta = load_artefact(artefact_id)
    scale = meta.assessment if meta is not None else None
    if scale is None:
        return []

    phenomena = list(scale.phenomena)
    missions = list(scale.missions)
    lo, hi = scale.min_level, scale.max_level
    activity_id = getattr(cfg, "activity_id", None)
    class_id = getattr(cfg, "class_id", None)

    def record_assessment(
        phenomenon: str,
        level: int,
        evidence: str,
        misconception: str = "",
        mission: str = "",
        tool_context: ToolContext = None,
    ) -> dict[str, Any]:
        """Record your diagnosis of the student's understanding on the activity's construct map.

        The student NEVER sees this call or its level — record it silently and do
        not mention levels in your reply. Use it when the student has said or
        written something that is evidence for one phenomenon (typically after an
        answer-commit, a prediction-commit, or a mission completion). Base the
        level only on what they actually wrote. A guess or "don't know" is NO
        evidence: record level 0 for that phenomenon, not a low level.

        Args:
            phenomenon: which phenomenon of the construct map this is evidence about.
            level: the construct-map level the evidence shows.
            evidence: one or two sentences quoting or closely paraphrasing what
                the student wrote. Required.
            misconception: the misconception you see, if any, in a few words.
            mission: the mission this evidence comes from, if any.

        Returns:
            Whether it was recorded.
        """
        if phenomenon not in phenomena:
            return {"ok": False, "error": f"phenomenon must be one of {phenomena}"}
        if isinstance(level, bool) or not isinstance(level, (int, float)) or int(level) != level:
            return {"ok": False, "error": f"level must be a whole number from {lo} to {hi}"}
        level = int(level)
        if not lo <= level <= hi:
            return {"ok": False, "error": f"level must be from {lo} to {hi}"}
        text = (evidence or "").strip()
        if not text:
            # Refused rather than defaulted: an assessment with no evidence is not
            # assessment evidence, it is a number.
            return {"ok": False, "error": "evidence is required — what did the student write?"}
        if mission and missions and mission not in missions:
            return {"ok": False, "error": f"mission must be one of {missions}"}

        _emit(
            tool_context,
            group_id=group_id,
            skill_id=skill_id,
            artefact_id=artefact_id,
            phenomenon=phenomenon,
            row={
                "level": level,
                "evidence": text[:_EVIDENCE_MAX],
                "misconception": (misconception or "").strip()[:_MISCONCEPTION_MAX] or None,
                "mission": mission or None,
                "scale": [lo, hi],
                "tutorId": getattr(teaching, "tutor_id", None),
                "tutorVersion": getattr(teaching, "tutor_version", None),
                "frameworkId": getattr(teaching, "framework_id", None),
                "toolCallId": getattr(tool_context, "function_call_id", None),
            },
            activity_id=activity_id,
            class_id=class_id,
        )
        logger.info("assessment: %s=%d group=%s activity=%s", phenomenon, level, group_id, activity_id)
        return {"ok": True, "recorded": phenomenon}

    return [_AssessmentTool(record_assessment, phenomena=phenomena, missions=missions, lo=lo, hi=hi)]


def _emit(
    tool_context: Any,
    *,
    group_id: str,
    skill_id: str,
    artefact_id: str,
    phenomenon: str,
    row: dict,
    activity_id: str | None,
    class_id: str | None,
) -> None:
    """One chat-log row per assessment. Never raises."""
    try:
        from observability.chat_log import emit_workbench_event

        session = getattr(tool_context, "session", None)
        emit_workbench_event(
            group_id=group_id,
            session_id=getattr(session, "id", "") or "",
            skill_id=skill_id,
            server=artefact_id,
            tool=TOOL_NAME,
            field=phenomenon,
            value=row,
            activity_id=activity_id,
            class_id=class_id,
            label=None,
        )
    except Exception as exc:  # telemetry must never break the turn
        logger.warning("assessment: chat-log emit failed (suppressed): %s", exc)


__all__ = ["TOOL_NAME", "build_assessment_tools"]
