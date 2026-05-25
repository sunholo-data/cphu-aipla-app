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

from db.activity_configs import get_activity_config
from db.models.activity_config import ActivityConfig

log = logging.getLogger(__name__)

_PLACEHOLDER = "{teacher_focus}"

# LOCAL_MODE constants. Kept in sync with backend/db/local_fixture.py
# WORKSHOP_USER_UID and the seeded demo-class id below. Imported
# lazily inside resolve_active_config to avoid a circular import.
LOCAL_MODE_DEMO_CLASS_ID = "7b-physics-a-2026"


def resolve_active_config(activity_id: str) -> ActivityConfig | None:
    """Return the ActivityConfig that should shape this activity's tutor.

    Phase 2 LOCAL_MODE: always (workshop-user, seeded-demo-class,
    activity_id). Phase 3 will derive the (teacher, class) tuple from
    the student's group-to-class binding.
    """
    from db.local_fixture import WORKSHOP_USER_UID

    return get_activity_config(
        teacher_uid=WORKSHOP_USER_UID,
        class_id=LOCAL_MODE_DEMO_CLASS_ID,
        activity_id=activity_id,
    )


def inject_teacher_focus(instructions: str, activity_id: str) -> str:
    """Replace the ``{teacher_focus}`` placeholder with the teacher's goal.

    No-op when:
      - the placeholder is absent (most skills won't have it)
      - no config has been saved yet (substitutes empty string so the
        trailing template block degrades gracefully)
    """
    if _PLACEHOLDER not in instructions:
        return instructions

    cfg = resolve_active_config(activity_id)
    goal = cfg.teaching_goal if cfg else ""

    if cfg is None:
        log.debug(
            "inject_teacher_focus: no config for activity=%s — substituting empty string",
            activity_id,
        )
    else:
        log.info(
            "inject_teacher_focus: activity=%s teacher=%s class=%s goal_chars=%d",
            activity_id,
            cfg.teacher_uid,
            cfg.class_id,
            len(goal),
        )

    return instructions.replace(_PLACEHOLDER, goal)


__all__ = [
    "LOCAL_MODE_DEMO_CLASS_ID",
    "inject_teacher_focus",
    "resolve_active_config",
]
