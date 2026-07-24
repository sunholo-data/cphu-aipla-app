"""Force-seed the CURRENT demo activities into existing teacher accounts.

``onboarding.demo_seed.seed_demo_for_teacher`` deliberately no-ops for a teacher
who already owns any class (so it never touches existing work) — which means when
the demo set GROWS, teachers who onboarded earlier never see the new activities.
This script closes that gap: it pushes the current ``_demo_activities`` set into
every existing teacher's "Demo class", **idempotently by title** (an activity
whose title is already in that teacher's Demo class is skipped), so re-runs add
only what's missing and never duplicate.

Scope: touches ONLY each teacher's "Demo class" (creating it + a join code if the
teacher has none). It never modifies the teacher's other classes or activities.

    uv run python -m scripts.force_seed_demo                    # dry-run (default), all teachers
    uv run python -m scripts.force_seed_demo --apply           # write, all teachers
    uv run python -m scripts.force_seed_demo --apply --owner <uid>   # one teacher
"""

from __future__ import annotations

import argparse
import logging

from db.activities import create_activity
from db.classes import (
    add_activities,
    create_class,
    list_classes_for_owner,
    mint_group_codes_under_class,
)
from db.firestore import get_document, query_documents
from db.models.class_ import Class
from onboarding.demo_seed import DEMO_CLASS_NAME, _concept_skill_id, _demo_activities

log = logging.getLogger(__name__)


def _teacher_owner_uids() -> list[str]:
    """Every uid that owns a non-deleted class (i.e. a teacher who has used the app)."""
    owners: set[str] = set()
    for c in query_documents("classes"):
        if c.get("deletedAt"):
            continue
        owner = c.get("ownerUid")
        if owner:
            owners.add(owner)
    return sorted(owners)


def _demo_class_titles(cls: Class) -> set[str]:
    """Titles of the activities currently assigned to this Demo class."""
    titles: set[str] = set()
    for aid in cls.activity_ids or []:
        doc = get_document("activities", aid)
        if doc and not doc.get("deletedAt") and doc.get("title"):
            titles.add(doc["title"])
    return titles


def seed_owner(owner_uid: str, concept_skill: str, *, dry_run: bool) -> dict:
    """Ensure the owner's Demo class holds the full current demo set. Returns a summary."""
    demo_classes = [c for c in list_classes_for_owner(owner_uid) if c.name == DEMO_CLASS_NAME]
    demo_class = demo_classes[0] if demo_classes else None

    existing_titles = _demo_class_titles(demo_class) if demo_class else set()
    wanted = _demo_activities(owner_uid, concept_skill)
    missing = [a for a in wanted if a.title not in existing_titles]

    summary = {
        "owner": owner_uid,
        "hadDemoClass": demo_class is not None,
        "existing": len(existing_titles),
        "toCreate": [a.title for a in missing],
    }
    if dry_run or (not missing and demo_class is not None):
        return summary

    new_ids = [create_activity(a).activity_id for a in missing]

    if demo_class is None:
        demo_class = Class.create_for_teacher(owner_uid=owner_uid, name=DEMO_CLASS_NAME)
        create_class(demo_class)
        if not demo_class.group_codes:
            mint_group_codes_under_class(demo_class.class_id, count=1)

    add_activities(demo_class.class_id, new_ids)
    summary["created"] = len(new_ids)
    summary["classId"] = demo_class.class_id
    return summary


def run(*, dry_run: bool, owner: str | None) -> None:
    concept_skill = _concept_skill_id()
    owners = [owner] if owner else _teacher_owner_uids()
    mode = "DRY-RUN" if dry_run else "APPLY"
    print(f"[{mode}] concept-skill={concept_skill}  teachers={len(owners)}\n")
    total_created = 0
    for uid in owners:
        s = seed_owner(uid, concept_skill, dry_run=dry_run)
        n = len(s["toCreate"]) if dry_run else s.get("created", 0)
        total_created += n
        flag = "" if s["hadDemoClass"] else "  (+new Demo class)"
        print(f"  {uid}: {s['existing']} present, {'would create' if dry_run else 'created'} {n}{flag}")
        for t in s["toCreate"]:
            print(f"        + {t}")
    verb = "would create" if dry_run else "created"
    print(f"\n[{mode}] {verb} {total_created} activities across {len(owners)} teachers")
    if dry_run:
        print("Re-run with --apply to write.")


def main() -> None:
    logging.basicConfig(level=logging.WARNING)
    parser = argparse.ArgumentParser(description="Force-seed demo activities into existing teacher accounts")
    parser.add_argument("--apply", action="store_true", help="write (default is dry-run)")
    parser.add_argument("--owner", default=None, help="seed a single teacher uid (default: all)")
    args = parser.parse_args()
    run(dry_run=not args.apply, owner=args.owner)


if __name__ == "__main__":
    main()
