"""Backfill legacy per-class activity configs → class-independent Activities (ALS-1 M0.2).

What it does (ADDITIVE ONLY — never deletes ``activity_configs`` or ``Class.lessons``):

1. Each ``activity_configs/{teacher}:{class}:{activity}`` row → one ``activities/act-…``
   (owner = teacher, content copied, ``visibility="private"``) **+** that ``act-…`` id is
   appended to the class's ``activity_ids``.
2. Each **bare lesson** — a ``Class.lessons`` skill id with no matching config (a sim or
   bare concept-dialogue added directly via the old "Add from catalogue") → a minimal
   wrapping ``Activity`` (title = the skill's displayName, ``artefact_id`` if the skill
   is a known sim) **+** its id appended to ``activity_ids``.

Idempotent: the migrated activity id is a deterministic hash of the legacy key
(``act-mig-…``), so a second run re-targets the same doc and skips already-migrated
rows. Run ``--dry-run`` first (the default) and eyeball the report before ``--apply``.

Firestore side effects (record in the migration notes / Terraform recipe):
  - writes to collection ``activities`` (new docs)
  - updates ``classes/{id}.activityIds`` (array append)
  - reads ``activity_configs``, ``classes`` (no deletes anywhere)

Usage:
    uv run python -m scripts.backfill_activities            # dry-run (default)
    uv run python -m scripts.backfill_activities --apply    # actually write
"""

from __future__ import annotations

import argparse
import hashlib
import logging
from dataclasses import dataclass, field

from db.activities import create_activity, get_activity
from db.activity_configs import get_activity_config
from db.classes import add_activities, list_all_classes
from db.firestore import query_documents
from db.models.activity import Activity

log = logging.getLogger(__name__)

_ACTIVITY_CONFIGS = "activity_configs"


def migrated_activity_id(legacy_key: str) -> str:
    """Deterministic ``act-mig-…`` id for a legacy composite key — the idempotency key."""
    return f"act-mig-{hashlib.sha1(legacy_key.encode()).hexdigest()[:16]}"


@dataclass
class BackfillReport:
    dry_run: bool
    configs_migrated: list[str] = field(default_factory=list)
    bare_lessons_wrapped: list[str] = field(default_factory=list)
    skipped_already_migrated: list[str] = field(default_factory=list)
    class_assignments: list[str] = field(default_factory=list)

    def summary(self) -> str:
        mode = "DRY-RUN (no writes)" if self.dry_run else "APPLIED"
        return (
            f"[{mode}] configs→activities: {len(self.configs_migrated)} · "
            f"bare lessons wrapped: {len(self.bare_lessons_wrapped)} · "
            f"already-migrated skipped: {len(self.skipped_already_migrated)} · "
            f"class assignments: {len(self.class_assignments)}"
        )


def _skill_display_name(skill_id: str) -> str:
    """Best-effort displayName for a bare lesson; falls back to the id."""
    try:
        from skills.skill_config import get_skill

        skill = get_skill(skill_id)
        return getattr(skill, "display_name", "") or getattr(skill, "name", "") or skill_id
    except Exception:
        return skill_id


def _wrap_artefact_id(skill_id: str) -> str | None:
    """If the bare lesson skill is a known sim artefact, carry it onto the Activity."""
    try:
        from artefacts.loader import is_known_artefact

        return skill_id if is_known_artefact(skill_id) else None
    except Exception:
        return None


def _activity_from_config(data: dict, *, activity_id: str) -> Activity:
    """Build a class-independent Activity from a legacy activity_configs row."""
    return Activity(
        activityId=activity_id,
        ownerUid=data.get("teacherUid", ""),
        title=data.get("title", ""),
        teachingGoal=data.get("teachingGoal", ""),
        language=data.get("language", "da"),
        difficulty=data.get("difficulty", "standard"),
        interactionStyle=data.get("interactionStyle"),
        persona=data.get("persona"),
        workbenchType=data.get("workbenchType", "none"),
        artefactId=data.get("artefactId"),
        checklist=data.get("checklist", []),
        table=data.get("table", []),
        chart=data.get("chart", []),
        calculator=data.get("calculator", []),
        note=data.get("note", []),
        solution=data.get("solution", []),
        materials=data.get("materials", []),
        visibility="private",
        sourceActivityId=None,
    )


def run_backfill(*, dry_run: bool = True) -> BackfillReport:
    """Run the backfill. Pure of side effects when ``dry_run`` (the default)."""
    report = BackfillReport(dry_run=dry_run)

    # 1. activity_configs → activities + class assignment.
    configs = query_documents(_ACTIVITY_CONFIGS)
    seen_by_class: dict[str, set[str]] = {}  # class_id → {skill_ids that HAVE a config}
    for data in configs:
        teacher = data.get("teacherUid", "")
        class_id = data.get("classId", "")
        legacy_activity = data.get("activityId", "")
        if not (teacher and class_id and legacy_activity):
            continue
        seen_by_class.setdefault(class_id, set()).add(legacy_activity)
        legacy_key = f"{teacher}:{class_id}:{legacy_activity}"
        act_id = migrated_activity_id(legacy_key)
        if get_activity(act_id, include_deleted=True) is not None:
            report.skipped_already_migrated.append(act_id)
        elif dry_run:
            report.configs_migrated.append(act_id)
        else:
            create_activity(_activity_from_config(data, activity_id=act_id))
            report.configs_migrated.append(act_id)
        if not dry_run:
            add_activities(class_id, [act_id])
        report.class_assignments.append(f"{class_id}←{act_id}")

    # 2. bare lessons (a Class.lessons skill id with no config) → minimal Activity.
    for cls in list_all_classes(include_revoked=False):
        configured = seen_by_class.get(cls.class_id, set())
        for skill_id in cls.lessons:
            if skill_id in configured:
                continue  # already handled in step 1
            if get_activity_config(teacher_uid=cls.owner_uid, class_id=cls.class_id, activity_id=skill_id):
                continue  # defensive — a config exists even if not in step-1 scan
            legacy_key = f"{cls.owner_uid}:{cls.class_id}:{skill_id}"
            act_id = migrated_activity_id(legacy_key)
            if get_activity(act_id, include_deleted=True) is not None:
                report.skipped_already_migrated.append(act_id)
            elif dry_run:
                report.bare_lessons_wrapped.append(act_id)
            else:
                create_activity(
                    Activity(
                        activityId=act_id,
                        ownerUid=cls.owner_uid,
                        title=_skill_display_name(skill_id),
                        artefactId=_wrap_artefact_id(skill_id),
                        visibility="private",
                    )
                )
                report.bare_lessons_wrapped.append(act_id)
            if not dry_run:
                add_activities(cls.class_id, [act_id])
            report.class_assignments.append(f"{cls.class_id}←{act_id} (bare:{skill_id})")

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill activity_configs → activities (ALS-1 M0.2)")
    parser.add_argument("--apply", action="store_true", help="actually write (default is dry-run)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    report = run_backfill(dry_run=not args.apply)
    log.info(report.summary())
    for line in report.class_assignments:
        log.info("  assign %s", line)
    if not args.apply:
        log.info("\nDry-run only. Re-run with --apply to write. Verify the counts above first.")


if __name__ == "__main__":
    main()
