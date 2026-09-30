"""Scratch conversations against a tutor, side by side (1.1.91 M3).

Two audiences, one build:

* a **researcher** checking that an approach does what it claims before signing
  it off — the approaches are all ``ready_for_review``, and this is how they stop
  being;
* a **teacher**, comparing operationalised pedagogies by talking to them, which
  the 09-09 meeting asked for: *"teachers can use the tutors as teaching training
  to see the different ways we teach."*

The comparison is the point. *"The question is nearly always comparative"* — so
two tutors answer the SAME message and are rendered together. One tutor answering
alone tells you what it said; two tell you what the approach changed.

## No student data, and nothing that can read as teaching

The author's own turns only. Turns are logged under ``preview:{uid}``, WITHOUT
content, so:

* spend stays visible (a preview costs real money — ACCESS-1's whole point), and
* the researcher chat-log lens excludes them by construction
  (``analytics.research_logs.NON_STUDENT_PREFIXES``).

That second point is why the prefix exists at all. A preview is a real tutor turn
carrying a real ``framework_id``; without the marker it would land in a framework
tab and read as classroom evidence when **nobody was taught**.

## The instruction is composed, never approximated

``compose_preview_instruction`` builds from the same pieces a lesson does — the
tutor's skill instructions plus ``resolve_framework_instruction`` — so what a
reviewer judges is what the approach actually says. An approximation here would
be worse than useless: a researcher would sign off a paraphrase.

⚠️ It is NOT the full lesson prompt. A real turn also carries the activity's
materials, the teacher's ILOs, group history and image guidance. Preview states
this in its response (``composedFrom``) rather than implying parity — a reviewer
has to know which half they are looking at.
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)

#: Group-id prefix for preview turns. Keep in lockstep with
#: ``analytics.research_logs.NON_STUDENT_PREFIXES`` — a preview that does not
#: carry it becomes indistinguishable from teaching.
PREVIEW_PREFIX = "preview:"

#: The tutor skill a preview runs on when the tutor is not itself skill-bound.
#: The six persona tutors have no skill of their own — in a lesson they take the
#: activity's. With no activity, the general conceptual tutor is the honest
#: stand-in, and the response says so.
DEFAULT_PREVIEW_SKILL = "concept-dialogue"

MAX_MESSAGE = 2000
MAX_TUTORS = 2


def compose_preview_instruction(tutor_id: str) -> dict[str, Any]:
    """The system prompt a preview turn runs on, and what it was built from.

    Returns ``{"ok": False, ...}`` for an unknown tutor rather than raising —
    this is on a request path where one bad id must not take the comparison down.
    """
    from db.tutors import resolve_tutor
    from personas.loader import load_persona

    tutor = resolve_tutor(tutor_id)
    if tutor is None:
        return {"ok": False, "error": f"unknown tutor: {tutor_id}"}

    instruction, composed_from = _compose(tutor.skill_name or DEFAULT_PREVIEW_SKILL, tutor.framework_id)
    persona = load_persona(tutor.persona_id) if tutor.persona_id else None
    composed_from["persona"] = persona.name if persona is not None else None
    return {
        "ok": True,
        "tutorId": tutor.id,
        "displayName": tutor.display_name,
        "instruction": instruction,
        # What a reviewer is looking at, stated rather than implied.
        "composedFrom": composed_from,
    }


def compose_approach_instruction(framework_id: str, *, skill_name: str = DEFAULT_PREVIEW_SKILL) -> dict[str, Any]:
    """The preview instruction for an APPROACH rather than a tutor (BENCH-1).

    Byte-identical to ``compose_preview_instruction`` for any tutor with no skill
    of its own that carries ``framework_id``: the persona never enters the
    instruction, only the display name. So the discrimination benchmark can run
    "the ESRU tutor" without depending on which persona a researcher assigned
    ESRU to in which environment (those pairings are Firestore rows, per env).
    Keeping the persona out also keeps the 1-1 confound out: a framework
    comparison must not silently be a persona comparison.
    """
    instruction, composed_from = _compose(skill_name, framework_id)
    composed_from["persona"] = None
    return {
        "ok": True,
        "tutorId": f"approach:{framework_id}",
        "displayName": composed_from["approach"] or framework_id,
        "instruction": instruction,
        "composedFrom": composed_from,
    }


def _compose(skill_name: str, framework_id: str | None) -> tuple[str, dict[str, Any]]:
    """The skill's instructions plus the approach's, and what they came from."""
    from db.framework_overrides import effective_framework, resolve_framework_instruction
    from skills.platform import PLATFORM_OWNER_UID
    from skills.skill_config import find_by_slug

    # ⚠️ Skills are keyed by UUID; `skill_name` is a SLUG. `get_skill(slug)`
    # returns None and composes a preview with no base instructions at all —
    # silently, since an empty base is indistinguishable from a terse one. That
    # is what `skillFound` below exists to report, and it read False on prod
    # until this used the slug index (2026-09-11).
    skill = find_by_slug(PLATFORM_OWNER_UID, skill_name)
    base = (skill.instructions if skill is not None else "") or ""

    approach = resolve_framework_instruction(framework_id)
    fw = effective_framework(framework_id)

    parts = [p for p in (base, approach) if p.strip()]
    return "\n\n".join(parts), {
        "skill": skill_name,
        "skillFound": skill is not None,
        "approach": fw.label if fw is not None else None,
        "approachId": framework_id,
        "register": fw.teaching_register if fw is not None else None,
        # A real lesson turn also carries the activity's materials, the
        # teacher's ILOs, the group's history and image guidance. Preview
        # has no activity, so it has none of those.
        "notIncluded": ["activity materials", "teacher ILOs", "group history"],
    }


async def run_preview_turn(tutor_id: str, message: str, *, uid: str) -> dict[str, Any]:
    """One scratch turn against one tutor. Never raises."""
    composed = compose_preview_instruction(tutor_id)
    if not composed.get("ok"):
        return composed
    if not composed["instruction"].strip():
        return {
            "ok": False,
            "tutorId": tutor_id,
            "error": "this tutor has no instructions to run — it carries neither a skill nor an approach",
        }

    try:
        from google import genai

        from config.models import default_model

        client = genai.Client(vertexai=True)
        response = await client.aio.models.generate_content(
            model=default_model(),
            contents=message,
            config={"system_instruction": composed["instruction"]},
        )
        text = (response.text or "").strip()
    except Exception as exc:
        log.warning("tutor preview failed for %s: %s", tutor_id, type(exc).__name__)
        return {"ok": False, "tutorId": tutor_id, "error": f"the tutor did not answer ({type(exc).__name__})"}

    _log_preview_turn(tutor_id, composed, uid=uid)
    return {
        "ok": True,
        "tutorId": tutor_id,
        "displayName": composed["displayName"],
        "reply": text,
        "composedFrom": composed["composedFrom"],
    }


async def run_preview_dialogue_turn(
    composed: dict[str, Any],
    history: list[dict[str, str]],
    message: str,
    *,
    model: str,
    uid: str,
    turn_index: int = 0,
) -> dict[str, Any]:
    """One turn of a MULTI-turn preview on a chosen model (BENCH-1). Never raises.

    ``run_preview_turn`` is one message, no history, the default model, and its
    contract is unchanged. The benchmark needs a conversation and a model axis,
    so this takes an already-composed instruction (from either compose function),
    the prior turns as ``[{"role": "student"|"tutor", "content": ...}]`` and the
    tutor model. It logs exactly as a preview does: ``preview:`` prefix, no
    content, so the turn can never read as classroom evidence.
    """
    if not composed.get("ok") or not (composed.get("instruction") or "").strip():
        return {"ok": False, "tutorId": composed.get("tutorId"), "error": "nothing to run"}
    contents: list[dict[str, Any]] = [
        {"role": "model" if h["role"] == "tutor" else "user", "parts": [{"text": h["content"]}]} for h in history
    ]
    contents.append({"role": "user", "parts": [{"text": message}]})
    try:
        from google import genai

        client = genai.Client(vertexai=True)
        response = await client.aio.models.generate_content(
            model=model,
            contents=contents,
            config={"system_instruction": composed["instruction"]},
        )
        text = (response.text or "").strip()
        usage = getattr(response, "usage_metadata", None)
        token_in = getattr(usage, "prompt_token_count", None) or 0
        token_out = getattr(usage, "candidates_token_count", None) or 0
    except Exception as exc:
        from analytics.model_retry import describe_error, status_of

        # The message and status, not just the class: BENCH-1 lost two transcripts
        # to a bare "ClientError" and could not say whether it was a 400 or a 429.
        desc = describe_error(exc)
        log.warning("tutor preview dialogue turn failed for %s: %s", composed.get("tutorId"), desc)
        return {"ok": False, "tutorId": composed.get("tutorId"), "error": desc, "status": status_of(exc)}

    _log_preview_turn(composed["tutorId"], composed, uid=uid, model=model, turn_index=turn_index)
    return {"ok": True, "tutorId": composed["tutorId"], "reply": text, "tokenIn": token_in, "tokenOut": token_out}


def _log_preview_turn(
    tutor_id: str, composed: dict[str, Any], *, uid: str, model: str | None = None, turn_index: int = 0
) -> None:
    """Record that a preview happened — for COST, never for content.

    ⚠️ ``group_id`` carries the ``preview:`` prefix and the content argument is
    empty on purpose. A preview is a real tutor turn with a real framework_id;
    logged as anything else it would read as teaching in the researcher lens,
    and nobody was taught.
    """
    try:
        from observability.chat_log import emit_chat_turn

        emit_chat_turn(
            group_id=f"{PREVIEW_PREFIX}{uid}",
            session_id="",
            skill_id=composed["composedFrom"]["skill"],
            turn_index=turn_index,
            role="tutor",
            content="",
            model=model,
            tutor_id=tutor_id,
            framework_id=composed["composedFrom"]["approachId"],
            interaction_style=composed["composedFrom"]["register"],
            teaching_source="preview",
        )
    except Exception as exc:
        log.warning("preview turn not logged (%s) — the turn still ran", type(exc).__name__)


__all__ = [
    "DEFAULT_PREVIEW_SKILL",
    "MAX_MESSAGE",
    "MAX_TUTORS",
    "PREVIEW_PREFIX",
    "compose_approach_instruction",
    "compose_preview_instruction",
    "run_preview_dialogue_turn",
    "run_preview_turn",
]
