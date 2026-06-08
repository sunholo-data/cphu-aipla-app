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


def inject_teacher_focus(
    instructions: str,
    activity_id: str,
    *,
    group_tags: Iterable[str] | None = None,
) -> str:
    """Replace the ``{teacher_focus}`` placeholder with the teacher's goal.

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
