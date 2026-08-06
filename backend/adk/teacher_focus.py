"""Teacher-focus injection for the agent's system prompt.

Substitutes the ``{teacher_focus}`` placeholder in a skill's
instructions with the active ``ActivityConfig.teaching_goal`` for the
(teacher, class, activity) tuple. Empty string when no config is
saved — the trailing prompt block in the skill template becomes a
no-op rather than erroring out.

Phase 2 LOCAL_MODE scope: one teacher (workshop user), one seeded
class. The lookup is keyed off ``(LOCAL_MODE_TEACHER_UID,
LOCAL_MODE_DEMO_CLASS_ID, skill_id)``.

Phase 3 will replace ``resolve_active_config()`` with a real lookup
that derives the class_id from the student's group → Class entity
(from ``teacher-permission-model.md`` 1.A).
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from datetime import UTC, datetime

from adk.element_manifest import describe_elements
from artefacts.loader import load_artefact
from db.activities import get_activity
from db.activity_configs import get_activity_config
from db.models.activity import Activity
from db.models.activity_config import ActivityConfig

log = logging.getLogger(__name__)

_PLACEHOLDER = "{teacher_focus}"

# 1.1.63 M2 — the platform's default activity language. The language directive
# is emitted only when an activity differs from this, so Danish activities
# compose byte-identically to how they did before 1.1.63.
_DEFAULT_LANGUAGE = "da"
_LANGUAGE_NAMES = {"da": "Danish", "en": "English"}

# --- Prompt budget (1.1.62 M2) -------------------------------------------
#
# This is an ATTENTION AND COST budget, not a validation limit.
#
# ``SkillConfig`` validates the AUTHORED template body (``MAX_INSTRUCTIONS_CHARS``,
# raised to 25,000 on 2026-08-06) at seed time. The composed focus is a different
# thing: ``adk/agent.py`` stacks it onto that body as a plain string via
# ``compose_instruction_providers`` and never re-validates, so nothing upstream
# bounds what per-activity content adds to the prompt. These caps are it.
#
# Why bound it at all: the composed instruction rides EVERY turn (input cost),
# and long system prompts dilute instruction-following — the tutor that has just
# been told about a data table should not lose that among 11,000 characters.
#
# Two blocks here were unbounded before 1.1.62 and are the real risk, not the
# element manifest that surfaced them: a 30-node concept map composes ~3,500
# chars, and the solution task allows 2,000 on its own. Stacked with a
# 2,000-char teaching goal and the 2,000-char manifest, a maximal activity
# composed ~11,000 chars of per-activity text alone. Each variable-length
# contributor is now bounded.
_CONCEPT_MAP_CAP = 1500
_SOLUTION_TASK_CAP = 500
# The ILO precedence block (M3b) restates the checklist in the late, "last word"
# position. Bounded like every other variable-length contributor.
_ILO_BLOCK_CAP = 1200
# Belt and braces: if the sum still exceeds this, something new went unbounded.
_TOTAL_FOCUS_CAP = 8000


def _clip(text: str, limit: int) -> str:
    """Truncate on a word boundary with a visible marker."""
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] + " …(truncated)"


def _fit_lines(lines: list[str], budget: int) -> tuple[list[str], int]:
    """Take as many whole lines as fit; report how many were dropped."""
    kept: list[str] = []
    used = 0
    for i, line in enumerate(lines):
        cost = len(line) + 1
        if used + cost > budget:
            return kept, len(lines) - i
        kept.append(line)
        used += cost
    return kept, 0


# LOCAL_MODE constants. Kept in sync with backend/db/local_fixture.py
# WORKSHOP_USER_UID and the seeded demo-class id below. Imported
# lazily inside resolve_active_config to avoid a circular import.
LOCAL_MODE_DEMO_CLASS_ID = "7b-physics-a-2026"

# A bound student's group JWT carries group_tags = {class.tag_namespace},
# where tag_namespace is the validated invariant ``class:<owner_uid>:<class_id>``
# (db/models/class_.py). Owner uids (Firebase) and class ids carry no colons,
# so a single split on the first two colons recovers both. The JWT is
# HS256-signed (auth/group_id_auth.py) so this is a trusted claim — a student
# cannot forge a different class binding (Axiom 9: secure by construction).
_CLASS_TAG_RE = re.compile(r"^class:([^:]+):(.+)$")

# ALS-1 M0: a library activity id is minted ``act-…`` (db/models/activity.py),
# distinct from any skill id. That prefix is the dual-read discriminator —
# ``act-`` resolves the new class-independent Activity store; anything else is a
# legacy skill-id keyed into the per-class ``activity_configs`` composite store.
_ACTIVITY_ID_PREFIX = "act-"


def _activity_to_config(activity: Activity, *, class_id: str) -> ActivityConfig:
    """Adapt a class-independent ``Activity`` to the ``ActivityConfig`` shape every
    downstream consumer (``compose_teacher_focus``, the ``/active`` route) already
    expects — so the M0 re-key needs zero changes below the resolution boundary.

    ``class_id`` comes from the student's verified group tag (the Activity itself is
    class-independent); ``interaction_style`` falls back to ``socratic`` (the
    ActivityConfig default) when the activity leaves it unset.
    """
    return ActivityConfig(
        activityId=activity.activity_id,
        classId=class_id,
        teacherUid=activity.owner_uid,
        title=activity.title,
        teachingGoal=activity.teaching_goal,
        language=activity.language,
        difficulty=activity.difficulty,
        interactionStyle=activity.interaction_style or "socratic",
        persona=activity.persona,
        workbenchType=activity.workbench_type,
        artefactId=activity.artefact_id,
        checklist=activity.checklist,
        table=activity.table,
        chart=activity.chart,
        calculator=activity.calculator,
        note=activity.note,
        solution=activity.solution,
        document=activity.document,
        conceptMap=activity.concept_map,
        materials=activity.materials,
        updatedAt=activity.updated_at or datetime.now(UTC),
    )


def resolve_active_config(
    activity_id: str,
    *,
    group_tags: Iterable[str] | None = None,
) -> ActivityConfig | None:
    """Return the ActivityConfig that should shape this activity's tutor.

    ALS-1 M0 (dual-read): an ``act-…`` id resolves the class-independent
    ``Activity`` (the new store); the ``class_id`` is recovered from the student's
    verified group tag. Any other id is a **legacy skill id** and falls back to the
    per-class ``activity_configs`` composite lookup, keeping live pre-cutover
    sessions working through the migration window.

    Phase 3: when the student's ``group_tags`` carry a ``class:<owner>:<id>``
    binding, resolve from that REAL (teacher, class) tuple so a teacher's authored
    goal reaches their own students. Falls back to the LOCAL_MODE stub for unbound
    groups (pre-1.A) and workshop sessions that carry no class tag.
    """
    # New store first: a minted ``act-…`` id resolves directly to the owned
    # Activity. If it isn't there, fall THROUGH to the legacy lookup — that covers
    # pre-cutover composite rows (and tests) that used an ``act-*`` id, so the
    # dual-read is "try new, fall back to legacy", never a hard None.
    if activity_id.startswith(_ACTIVITY_ID_PREFIX):
        activity = get_activity(activity_id)
        if activity is not None:
            class_id = class_id_from_group_tags(group_tags) or LOCAL_MODE_DEMO_CLASS_ID
            return _activity_to_config(activity, class_id=class_id)

    # Legacy dual-read: skill-id keyed composite lookup for pre-cutover sessions.
    for tag in group_tags or ():
        m = _CLASS_TAG_RE.match(tag)
        if m:
            teacher_uid, class_id = m.group(1), m.group(2)
            return get_activity_config(
                teacher_uid=teacher_uid,
                class_id=class_id,
                activity_id=activity_id,
            )

    from db.local_fixture import WORKSHOP_USER_UID

    return get_activity_config(
        teacher_uid=WORKSHOP_USER_UID,
        class_id=LOCAL_MODE_DEMO_CLASS_ID,
        activity_id=activity_id,
    )


def class_id_from_group_tags(group_tags: Iterable[str] | None) -> str | None:
    """Recover the bound ``class_id`` from a student's verified ``group_tags``.

    Returns the ``class_id`` carried by the first ``class:<owner>:<id>`` tag
    (the same trusted, HS256-signed binding ``resolve_active_config`` reads),
    else None. Exposed so the interaction-style path can resolve the class
    persona's teaching style even when NO ``ActivityConfig`` has been saved — the
    avatar and voice already fall back to the class persona regardless of an
    activity config, and the teaching style must use the same fallback or it
    silently drifts.
    """
    for tag in group_tags or ():
        m = _CLASS_TAG_RE.match(tag)
        if m:
            return m.group(2)
    return None


# Solution feedback prompt (1.1.45 M4, JB-2; image-based 1.1.48 M1). The DEFAULT
# instruction the tutor uses to critique a student's solution — now a PHOTO of
# their pen-and-paper work (sent as an image the multimodal model sees), not
# typed text. Drafted v0.1 (AR sign-off gates the pilot ship); a single
# composable block so 1.1.47 (prompt transparency + config) can later make it a
# researcher-overridable layer. Socratic by construction: never hands over the
# answer (reuses the verbosity/Socratic posture the eval already checks).
SOLUTION_FEEDBACK_PROMPT = (
    "The student submits a PHOTO of their own (usually hand-written) solution to "
    "a physics task for your feedback — read the image: the working, the "
    "diagrams, the units. Give feedback on it — do NOT rewrite it for them:\n"
    "- Never hand over the full corrected solution; point to where a step, "
    "value, or formula goes wrong and ask a question that lets the student fix "
    "it themselves.\n"
    "- Be specific — quote their actual values and formulas from the photo.\n"
    "- Lead with one thing the solution gets right, then probe the single most "
    "important gap with a question.\n"
    "- Check the physics, not just the algebra: units, signs, whether the "
    "formula fits the situation, whether the result is physically plausible.\n"
    "- If the photo is unreadable or cut off, say so kindly and ask for a "
    "clearer picture.\n"
    # 1.1.63 M2: "Match the student's language" was removed here. It was a
    # per-turn heuristic buried in the SOLUTION-ONLY block, and it now conflicts
    # with the activity's explicit `language` setting — an English activity
    # whose student wrote Danish would get contradictory instructions, one of
    # which is the teacher's actual configuration. Language is owned by the
    # directive at the top of compose_teacher_focus; where no directive is
    # emitted the model infers, which is what this line achieved anyway.
    "- 3-5 sentences, ending with a question."
)


def compose_teacher_focus(cfg: ActivityConfig | None) -> str:
    """Compose the ``{teacher_focus}`` substitution (1.1.41 M2 + 1.1.45 M4 + 1.1.62/63 M2).

    Stacks, in order: the **activity language directive** (1.1.63 M2 — first, so
    it frames everything after it); the hosted sim artefact's intrinsic
    ``tutor_block`` (what the sim IS + what its events MEAN, when the activity
    references a sim); the **element manifest** (1.1.62 M1 — what the student has
    in front of them on the workbench); the **solution feedback prompt** + the
    teacher's solution task (when the activity has a solution-editor element —
    1.1.45 M4); the concept map; and the per-activity ``teaching_goal``. The
    artefact block is the **same** for every activity using that sim (AR-authored
    catalogue); the goal is **per-activity** — so the same sim tutors differently
    per activity purely because the goal differs. Graceful: each block is optional
    and a de-catalogued / block-less artefact is skipped.

    **Budget.** Every block here shares ``_TOTAL_FOCUS_CAP`` — an attention and
    per-turn cost budget for per-activity content, independent of the authored
    template's own ``MAX_INSTRUCTIONS_CHARS`` limit. The element manifest is
    self-capping at ``element_manifest.MANIFEST_CHAR_CAP``. See
    ``test_composed_focus_stays_under_the_skillconfig_instruction_cap``.
    """
    goal = (cfg.teaching_goal if cfg else "").strip()
    blocks: list[str] = []

    # 1.1.63 M2 — the activity language. `ActivityConfig.language` was read into
    # the config at `_activity_to_config` and then used NOWHERE: a written-only
    # field. So the tutor's language was whatever the model inferred, biased by
    # Danish skill templates and Danish curriculum docs, and Aswin's English
    # activity spoke Danish.
    #
    # Emitted only when the activity's language differs from the platform
    # default. `Language` is Literal["da","en"] defaulting to "da", so it is
    # never unset — emitting unconditionally would rewrite the prompt of every
    # existing activity days before the pilot, for no behaviour change on the
    # Danish ones. See test_default_language_emits_no_directive for the residual
    # gap this accepts.
    if cfg is not None and cfg.language and cfg.language != _DEFAULT_LANGUAGE:
        name = _LANGUAGE_NAMES.get(cfg.language, cfg.language)
        blocks.append(
            f"Speak {name} with the student, in every turn, including your first. "
            f"Curriculum material may be in another language — read it in whatever "
            f"language it is written and answer in {name}. Physics terms and units "
            f"keep their conventional form."
        )

    if cfg is not None and cfg.artefact_id:
        artefact = load_artefact(cfg.artefact_id)
        block = artefact.tutor_block.strip() if artefact else ""
        if block:
            blocks.append(block)

    # 1.1.62 M1 — what the student actually has in front of them. Placed after
    # the sim block (which explains the artefact) and before the goal (which
    # explains the point), so the tutor reads: what this is, what tools are
    # here, what we're trying to achieve.
    manifest = describe_elements(cfg)
    if manifest:
        blocks.append(manifest)

    if cfg is not None and cfg.solution:
        blocks.append(SOLUTION_FEEDBACK_PROMPT)
        task = (cfg.solution[0].prompt or "").strip()
        if task:
            blocks.append(f"The task the student is solving: {_clip(task, _SOLUTION_TASK_CAP)}")

    # CONCEPT-1 M3 — the living concept map: give the tutor the node structure
    # + the chat-native checkpoint contract. Node STATUSES are deliberately not
    # baked in here (the instruction is composed once per session and would go
    # stale); the checkpoint tools return fresh state on every call.
    if cfg is not None and cfg.concept_map:
        cmap = cfg.concept_map[0]
        lines = []
        for n in cmap.nodes:
            prereqs = [e.from_ for e in cmap.edges if e.to == n.id]
            dep = f" (builds on: {', '.join(prereqs)})" if prereqs else ""
            q = f" [{len(n.check_questions)} check questions]" if n.check_questions else ""
            lines.append(f"- {n.id}: {n.label}{dep}{q}")
        node_lines, dropped_nodes = _fit_lines(lines, _CONCEPT_MAP_CAP)
        if dropped_nodes:
            node_lines.append(f"(+{dropped_nodes} more concepts)")
        blocks.append(
            "This activity has a concept map — the concepts the student should demonstrate, in "
            "prerequisite order:\n"
            + "\n".join(node_lines)
            + "\n\nWhen a concept looks nearly understood (or at a wrap-up), offer a short checkpoint: "
            "call run_checkpoint(node_id) to get its check questions, ask them ONE AT A TIME in your "
            "own voice in the conversation (never as a form), judge the answers, then call "
            "record_checkpoint(node_id, passed, evidence_summary). Frame results as progress "
            "('på vej'), never as failure. This is the AI's read — the teacher can override it."
        )

    if goal:
        blocks.append(goal)

    focus = "\n\n".join(blocks)

    # Belt and braces. Every variable-length block above is individually
    # bounded, so reaching here means a NEW unbounded contributor was added.
    # Log loudly rather than silently shipping an instruction set that will
    # fail the seed on deploy.
    if len(focus) > _TOTAL_FOCUS_CAP:
        log.warning(
            "compose_teacher_focus: %d chars exceeds the %d budget (activity=%s) — "
            "clipping. A new unbounded block was likely added; bound it at source.",
            len(focus),
            _TOTAL_FOCUS_CAP,
            cfg.activity_id if cfg else "-",
        )
        focus = _clip(focus, _TOTAL_FOCUS_CAP)

    return focus


def build_ilo_precedence_block(cfg: ActivityConfig | None) -> str:
    """State that the teacher's checklist outranks the curriculum (1.1.62 M3b).

    Aswin, 2026-08-06: *"The chat force students to achieve goals from the
    curriculum only, not with my ILOs."*

    **Why this is a separate block rather than an ordering change.** The composed
    instruction is::

        SKILL.md body (with {teacher_focus} substituted INSIDE it)
          + curriculum grounding preamble       <- appended after the body
          + image guidance / style / opening / reactive

    so the teacher's goals were already *before* the curriculum preamble. But the
    convention in this codebase is **later instruction wins** (see
    ``inject_interaction_style_preamble``, which appends precisely so it can
    override the SKILL.md Socratic rule). First is therefore the WEAK position,
    and the curriculum preamble held the last word — which is exactly the
    behaviour Aswin reported. Simply "emitting the ILOs earlier" would have been
    a no-op.

    So this block is **appended after the curriculum preamble** in ``agent.py``
    and states the relationship explicitly instead of relying on position.

    Grounding is deliberately NOT weakened: the curriculum stays the source of
    truth for physics content, it just stops being the source of *objectives*.
    Returns "" when the activity has no checklist.
    """
    if cfg is None or not cfg.checklist:
        return ""

    lines = [f"- {item.label}" for item in cfg.checklist]
    kept, dropped = _fit_lines(lines, _ILO_BLOCK_CAP)
    if dropped:
        kept.append(f"(+{dropped} more)")

    return (
        "\n\n## The teacher's learning outcomes for this activity\n"
        + "\n".join(kept)
        + "\n\nThese are what the student is working toward — the teacher set them for this "
        "activity. Curriculum material you retrieve is reference for reaching these outcomes, "
        "not a competing set of goals: keep using it for the physics, and keep citing it, but "
        "steer the session by the outcomes above. Where a curriculum objective and an outcome "
        "above point in different directions, follow the outcome above."
    )


def inject_teacher_focus(
    instructions: str,
    activity_id: str,
    *,
    group_tags: Iterable[str] | None = None,
) -> str:
    """Replace the ``{teacher_focus}`` placeholder with the composed focus.

    The composed focus is the teacher's goal, prefixed with the hosted
    artefact's tutor block (1.1.41 M2 — see ``compose_teacher_focus``).
    ``group_tags`` is the authenticated student's verified group→class tags;
    when present they select the real (teacher, class) config (Phase 3).

    No-op when:
      - the placeholder is absent (most skills won't have it)
      - no config has been saved yet (substitutes empty string so the
        trailing template block degrades gracefully)
    """
    if _PLACEHOLDER not in instructions:
        return instructions

    cfg = resolve_active_config(activity_id, group_tags=group_tags)
    focus = compose_teacher_focus(cfg)

    if cfg is None:
        log.debug(
            "inject_teacher_focus: no config for activity=%s — substituting empty string",
            activity_id,
        )
    else:
        log.info(
            "inject_teacher_focus: activity=%s teacher=%s class=%s artefact=%s focus_chars=%d",
            activity_id,
            cfg.teacher_uid,
            cfg.class_id,
            cfg.artefact_id or "-",
            len(focus),
        )

    return instructions.replace(_PLACEHOLDER, focus)


__all__ = [
    "LOCAL_MODE_DEMO_CLASS_ID",
    "SOLUTION_FEEDBACK_PROMPT",
    "build_ilo_precedence_block",
    "class_id_from_group_tags",
    "compose_teacher_focus",
    "inject_teacher_focus",
    "resolve_active_config",
]
