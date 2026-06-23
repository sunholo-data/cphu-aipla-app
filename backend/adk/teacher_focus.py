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

from artefacts.loader import load_artefact
from db.activity_configs import get_activity_config
from db.models.activity_config import ActivityConfig

log = logging.getLogger(__name__)

_PLACEHOLDER = "{teacher_focus}"

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


def resolve_active_config(
    activity_id: str,
    *,
    group_tags: Iterable[str] | None = None,
) -> ActivityConfig | None:
    """Return the ActivityConfig that should shape this activity's tutor.

    Phase 3: when the student's ``group_tags`` carry a ``class:<owner>:<id>``
    binding, resolve the config from that REAL (teacher, class) tuple so a
    teacher's authored goal reaches their own students.

    Falls back to the Phase-2 LOCAL_MODE stub (workshop-user, seeded
    demo-class) for unbound groups (pre-1.A) and LOCAL_MODE workshop sessions
    that carry no class tag.
    """
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


def compose_teacher_focus(cfg: ActivityConfig | None) -> str:
    """Compose the ``{teacher_focus}`` substitution (1.1.41 M2).

    The activity's ``teaching_goal``, prefixed with the hosted sim artefact's
    intrinsic ``tutor_block`` (what the sim IS + what its events MEAN) when the
    activity references one. The artefact block is the **same** for every
    activity using that sim (from the catalogue, AR-authored); the goal is
    **per-activity** — so the same sim tutors differently per activity purely
    because the goal differs. Graceful: a de-catalogued or block-less artefact
    falls back to just the goal.
    """
    goal = (cfg.teaching_goal if cfg else "").strip()
    if cfg is None or not cfg.artefact_id:
        return goal
    artefact = load_artefact(cfg.artefact_id)
    block = artefact.tutor_block.strip() if artefact else ""
    if not block:
        return goal
    return f"{block}\n\n{goal}" if goal else block


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
    "class_id_from_group_tags",
    "compose_teacher_focus",
    "inject_teacher_focus",
    "resolve_active_config",
]
