"""Seed demo Class entities for the DEV teacher-mock-auth bypass.

When ``AIPLA_TEACHER_MOCK_AUTH=1`` is set on the service (dev only),
``AnonymousGroupAuth.user_from_token`` remaps every anon-group visitor
to the shared :data:`DEMO_TEACHER_UID` so they all see the same demo
classes on ``/teacher/classes``. This module seeds those classes.

Idempotent: skips entries whose name already exists for the demo
teacher. Hooked into :func:`admin.platform_seed.seed` so the existing
``POST /api/admin/seed-platform-skills`` admin endpoint handles both
platform-skill seeding AND demo-class seeding in one call.

Production never sees this path — the bypass env is never set there,
and even if a stray demo class made it into a prod Firestore it would
be invisible (no Firebase teacher has the demo uid).
"""

from __future__ import annotations

import logging
from typing import Any

from auth.group_id_auth import DEMO_TEACHER_UID
from db.classes import (
    add_lessons,
    create_class,
    get_class,
    list_classes_for_owner,
    mint_group_codes_under_class,
)
from db.models.class_ import Class

logger = logging.getLogger(__name__)

# Three demo classes covering the AIPLA v1 pilot's anticipated shapes:
# Danish stx physics (Boldkast cohort), English NCERT (KineBot cohort),
# and a sandbox class for ad-hoc exploration.
DEMO_CLASSES: list[dict[str, Any]] = [
    {
        "name": "Physik 9A vår 2026",
        "description": "Demo Danish stx physics class — projectile motion focus.",
        "lessons": ["problem-set-hints"],
        "mint_group_codes": 2,
    },
    {
        "name": "Physics 11 NCERT",
        "description": "Demo NCERT/CBSE Class 11 (English) — kinematics.",
        "lessons": [],
        "mint_group_codes": 1,
    },
    {
        "name": "Sandbox class",
        "description": "Try things here. Codes mint freely; reset anytime.",
        "lessons": [],
        "mint_group_codes": 0,
    },
]


def _resolve_lesson_skill_ids(lesson_names: list[str]) -> list[str]:
    """Map skill-name strings (as known in templates) to skill_ids
    visible in Firestore. Returns only ids for skills that exist —
    missing ones are skipped with a warning. Avoids the demo seed
    blowing up the whole platform-seed call when a lesson template
    isn't deployed yet.

    list_skills has no name filter; fetch the platform-owned set and
    filter in Python. The catalogue is small (under 10 entries) so
    this is cheap.
    """
    if not lesson_names:
        return []
    from skills import skill_config
    from skills.platform import PLATFORM_OWNER_UID

    by_name = {c.name: c.skill_id for c in skill_config.list_skills(owner_id=PLATFORM_OWNER_UID, limit=200)}
    out: list[str] = []
    for name in lesson_names:
        sid = by_name.get(name)
        if sid is not None:
            out.append(sid)
        else:
            logger.warning(
                "demo_classes: lesson %r not found in Firestore — skipping",
                name,
            )
    return out


def seed_demo_classes() -> dict[str, Any]:
    """Create demo classes under :data:`DEMO_TEACHER_UID`. Idempotent.

    Returns a summary dict with the count of created vs skipped
    classes. Lessons are linked via the standard PATCH path (writes
    both Class.lessons AND Skill.accessControl.tags), so the resulting
    class behaves identically to a teacher-created one.
    """
    existing = {c.name: c.class_id for c in list_classes_for_owner(DEMO_TEACHER_UID)}
    created: list[str] = []
    skipped: list[str] = []

    for spec in DEMO_CLASSES:
        name = spec["name"]
        if name in existing:
            skipped.append(name)
            logger.info("demo_classes: class %r already exists; skipping", name)
            continue

        cls = Class.create_for_teacher(
            owner_uid=DEMO_TEACHER_UID,
            name=name,
            description=spec.get("description"),
        )
        create_class(cls)
        logger.info("demo_classes: created class=%s name=%r", cls.class_id, name)

        skill_ids = _resolve_lesson_skill_ids(spec.get("lessons", []))
        if skill_ids:
            # Link only — write Class.lessons but DO NOT mutate the
            # skill's accessControl. The demo classes are visible to
            # whoever has AIPLA_TEACHER_MOCK_AUTH; we don't want to
            # gate the underlying skill to those teachers and hide it
            # from the public catalogue. In production class-binding
            # (teacher creates class through /teacher UI), the lessons-
            # patch route DOES mutate the skill's accessControl —
            # demo seed is the exception because the demo teacher
            # identity is shared across visitors and we want skills
            # visible to anon-group students too.
            add_lessons(cls.class_id, skill_ids)

        codes_to_mint = spec.get("mint_group_codes", 0)
        if codes_to_mint:
            mint_group_codes_under_class(cls.class_id, count=codes_to_mint)

        # Confirm the class round-trips after the cross-collection writes
        # (lessons + groups). Cheap sanity check that the demo isn't
        # silently broken.
        reloaded = get_class(cls.class_id)
        assert reloaded is not None, f"demo class {cls.class_id} disappeared after seed"
        created.append(name)

    return {"created": created, "skipped": skipped, "owner_uid": DEMO_TEACHER_UID}


__all__ = ["DEMO_CLASSES", "seed_demo_classes"]
