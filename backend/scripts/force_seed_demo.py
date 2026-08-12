"""Force-seed the CURRENT demo activities into existing teacher accounts.

``onboarding.demo_seed.seed_demo_for_teacher`` deliberately no-ops for a teacher
who already owns any class (so it never touches existing work) — which means when
the demo set GROWS, teachers who onboarded earlier never see the new activities.
This script closes that gap: it pushes the current ``_demo_activities`` set into
every existing teacher's "Demo class", **idempotently by title** (an activity
whose title is already in that teacher's Demo class is skipped), so re-runs add
only what's missing and never duplicate.

**Creating was not enough (1.1.73).** Matching by title meant an activity that
already existed was left alone forever — so when a demo activity GAINED an
element, every teacher who already had that activity kept the old version. The
writing element landed on Hookes lov and reached exactly the teachers who did
not yet have a Demo class; the ones who did saw nothing, which is the opposite
of who the reseed is for.

So this also **reconciles existing activities, additively**: for each element
field, if the teacher's copy has NOTHING and the current demo set has something,
the element is added. It never replaces a non-empty field and never deletes.
That rule is deliberately timid — a teacher may have edited their demo copy, and
silently overwriting their work to deliver a starter element would be a far worse
bug than the one being fixed. Fields that differ but are non-empty are REPORTED,
not touched, so a human can decide.

Scope: touches ONLY each teacher's "Demo class" (creating it + a join code if the
teacher has none). It never modifies the teacher's other classes or activities.

    uv run python -m scripts.force_seed_demo                    # dry-run (default), all teachers
    uv run python -m scripts.force_seed_demo --apply           # write, all teachers
    uv run python -m scripts.force_seed_demo --apply --owner <uid>   # one teacher
"""

from __future__ import annotations

import argparse
import logging

from db.activities import create_activity, get_activity, save_activity
from db.classes import (
    add_activities,
    create_class,
    list_classes_for_owner,
    mint_group_codes_under_class,
)
from db.firestore import get_document, query_documents
from db.models.activity import Activity
from db.models.activity_config import ELEMENT_REGISTRY
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
    return set(_demo_class_by_title(cls))


def _demo_class_by_title(cls: Class | None) -> dict[str, str]:
    """title -> activity_id for the live activities in this Demo class."""
    by_title: dict[str, str] = {}
    for aid in (cls.activity_ids if cls else None) or []:
        doc = get_document("activities", aid)
        if doc and not doc.get("deletedAt") and doc.get("title"):
            by_title[doc["title"]] = aid
    return by_title


def _element_gaps(existing: Activity, canonical: Activity) -> tuple[dict[str, list], list[str]]:
    """(fields to fill, fields that differ but are already populated).

    A field is FILLED only when the teacher's copy is empty and the current demo
    set has something — the one case where there is no teacher work to lose.
    Anything else is reported, never written.
    """
    fills: dict[str, list] = {}
    populated_diffs: list[str] = []
    for spec in ELEMENT_REGISTRY.values():
        want = getattr(canonical, spec.field, None) or []
        have = getattr(existing, spec.field, None) or []
        if not want:
            continue
        if not have:
            fills[spec.field] = want
        elif len(have) != len(want):
            populated_diffs.append(spec.field)
    return fills, populated_diffs


def seed_owner(owner_uid: str, concept_skill: str, *, dry_run: bool) -> dict:
    """Ensure the owner's Demo class holds the full current demo set. Returns a summary."""
    demo_classes = [c for c in list_classes_for_owner(owner_uid) if c.name == DEMO_CLASS_NAME]
    demo_class = demo_classes[0] if demo_classes else None

    by_title = _demo_class_by_title(demo_class)
    wanted = _demo_activities(owner_uid, concept_skill)
    missing = [a for a in wanted if a.title not in by_title]

    # Existing activities that are missing an element the demo set has gained.
    to_update: list[tuple[str, Activity, dict[str, list]]] = []
    skipped: list[str] = []
    for canonical in wanted:
        aid = by_title.get(canonical.title)
        if not aid:
            continue
        existing = get_activity(aid)
        if existing is None:
            continue
        fills, populated_diffs = _element_gaps(existing, canonical)
        if fills:
            to_update.append((aid, existing, fills))
        for field in populated_diffs:
            skipped.append(f"{canonical.title} · {field}")

    summary = {
        "owner": owner_uid,
        "hadDemoClass": demo_class is not None,
        "existing": len(by_title),
        "toCreate": [a.title for a in missing],
        "toUpdate": [f"{a.title} (+{', '.join(f)})" for _, a, f in to_update],
        "skipped": skipped,
    }
    if dry_run:
        return summary

    new_ids = [create_activity(a).activity_id for a in missing]

    if demo_class is None:
        demo_class = Class.create_for_teacher(owner_uid=owner_uid, name=DEMO_CLASS_NAME)
        create_class(demo_class)

    # Assign BEFORE minting. The mint needs GROUP_AUTH_SIGNING_SECRET, which a
    # laptop usually does not have; when it raised here the run died AFTER
    # creating nine activities and the class but BEFORE assigning any of them,
    # leaving a teacher with an empty Demo class and nine orphans. Ordering the
    # recoverable write first, and treating a failed mint as a warning, means the
    # worst case is a class whose join code the teacher mints from the UI.
    if new_ids:
        add_activities(demo_class.class_id, new_ids)

    for _aid, existing, fills in to_update:
        for field, value in fills.items():
            setattr(existing, field, value)
        save_activity(existing)

    if not demo_class.group_codes:
        try:
            mint_group_codes_under_class(demo_class.class_id, count=1)
        except Exception as exc:  # never lose the activities over a join code
            log.warning("could not mint a join code for %s: %s", demo_class.class_id, exc)
            summary["mintFailed"] = str(exc)

    summary["created"] = len(new_ids)
    summary["updated"] = len(to_update)
    summary["classId"] = demo_class.class_id
    return summary


def run(*, dry_run: bool, owner: str | None) -> None:
    concept_skill = _concept_skill_id()
    owners = [owner] if owner else _teacher_owner_uids()
    mode = "DRY-RUN" if dry_run else "APPLY"
    print(f"[{mode}] concept-skill={concept_skill}  teachers={len(owners)}\n")
    total_created = 0
    total_updated = 0
    for uid in owners:
        s = seed_owner(uid, concept_skill, dry_run=dry_run)
        n = len(s["toCreate"]) if dry_run else s.get("created", 0)
        u = len(s["toUpdate"]) if dry_run else s.get("updated", 0)
        total_created += n
        total_updated += u
        flag = "" if s["hadDemoClass"] else "  (+new Demo class)"
        verb_c = "would create" if dry_run else "created"
        verb_u = "would update" if dry_run else "updated"
        print(f"  {uid}: {s['existing']} present, {verb_c} {n}, {verb_u} {u}{flag}")
        for t in s["toCreate"]:
            print(f"        + {t}")
        for t in s["toUpdate"]:
            print(f"        ~ {t}")
        # Reported, never written: the teacher has their own content there.
        for t in s.get("skipped", []):
            print(f"        ! differs but already populated, left alone: {t}")
        if s.get("mintFailed"):
            print(f"        ! no join code minted ({s['mintFailed']}) — mint one from the class page")
    verb = "would create" if dry_run else "created"
    verb2 = "would update" if dry_run else "updated"
    print(f"\n[{mode}] {verb} {total_created} activities, {verb2} {total_updated}, across {len(owners)} teachers")
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
