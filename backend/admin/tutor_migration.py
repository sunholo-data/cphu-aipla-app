"""Emit Tutor objects for the student-facing SKILL.md tutors (1.1.91 M7).

**One pipeline, not two.** The design doc is explicit that ``SKILL.md`` stays the
seed source rather than becoming a second definition: the deploy-time seed
already reads ``skills/templates/*/SKILL.md`` into Firestore, and this extends
that same path to also emit a ``Tutor``. A git-authored tutor and a
researcher-authored tutor therefore land in the same store and are the same kind
of thing thereafter — which is the whole point of migrating rather than
coexisting.

**Only the four student-facing tutors.** ``manage-class``, ``analytics-chat``,
``activity-authoring-assistant`` and ``aipla-help`` are teacher tools riding the
same mechanism. They are excluded by the ``isTutor`` frontmatter flag, because
putting a class-management assistant into a tutor catalogue would also put it
into the 1.1.92 matrix as an arm.

**``framework_id`` is honestly null.** None of the four operationalises a named
theory, and back-filling one would be the exact failure the two-tier model
refuses for teachers — a theory field with no theory in it makes an unfounded
claim look founded. Null is also the finding: these are the baseline the
framework-bearing tutors get measured against (1.1.107).
"""

from __future__ import annotations

import logging
from typing import Any

from db.models.tutor import Tutor
from db.tutors import get_authored_tutor, save_tutor

log = logging.getLogger(__name__)

#: The seed runs as the platform, not as a person.
_SEED_AUTHOR = "platform-seed"


def tutor_from_template(parsed: dict[str, Any]) -> Tutor:
    """Build the Tutor a student-facing SKILL.md template represents.

    Identity comes from the SKILL.md (its own displayName + avatar + voice), not
    from a persona — hence ``persona_id`` stays None and ``skill_name`` carries
    the binding. ``interaction_style`` is ``socratic``, the passthrough that
    injects nothing, so a migrated tutor resolves to the same prompt the skill
    produces today. That is the regression bar: this is a refactor with a schema
    attached.
    """
    return Tutor(
        id=parsed["name"],
        displayName=parsed.get("displayName") or parsed["name"],
        summary=(parsed.get("description") or "").strip() or None,
        skillName=parsed["name"],
        personaId=None,
        frameworkId=None,
        interactionStyle="socratic",
        status="ready",
        authorRole="researcher",
        promptProvenance="authored",
    )


def sync_tutor_for_template(parsed: dict[str, Any]) -> str | None:
    """Upsert the Tutor for one parsed template. Returns the id, or None.

    Skips templates that are not declared tutors, and — importantly — skips one
    a human has since edited. The seed owns the git-authored baseline; it must
    not silently revert a researcher's change on the next deploy, which is the
    same discipline ``framework_overrides`` follows.
    """
    if not parsed.get("isTutor"):
        return None

    tutor = tutor_from_template(parsed)
    existing = get_authored_tutor(tutor.id)
    if existing is not None and existing.author_uid not in (None, _SEED_AUTHOR):
        log.info(
            "tutor_migration: %s was edited by %s — leaving it alone",
            tutor.id,
            existing.author_uid,
        )
        return None

    save_tutor(tutor, updated_by=_SEED_AUTHOR)
    log.info("tutor_migration: synced tutor %s from SKILL.md", tutor.id)
    return tutor.id


__all__ = ["sync_tutor_for_template", "tutor_from_template"]
