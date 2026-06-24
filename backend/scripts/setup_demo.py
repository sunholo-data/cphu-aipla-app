"""Seed the AIPLA dev demo: a 'Demo class' owned by the demo teacher with every
distinct activity assigned, and bind the ``aipla-demo-1`` student code to it.

Owner-only invariant: a class can only run activities its owner owns. So every
distinct activity (deduped by title — the same sim owned by several teachers is one
sim) is COPIED into the demo teacher's library (provenance recorded), then assigned
to the Demo class. The ``aipla-demo-1`` code is bound to that class so a student
joining it sees every activity.

Idempotent: reuses the demo teacher's existing 'Demo class' + already-owned/already-
copied activities (matched by title). Re-running adds only what's missing.

Usage:
    uv run python -m scripts.setup_demo          # dry-run (default)
    uv run python -m scripts.setup_demo --apply
"""

from __future__ import annotations

import argparse
import logging
import time

from db.activities import create_activity
from db.classes import add_activities, create_class, get_class, list_classes_for_owner
from db.firestore import get_document, query_documents, update_document
from db.models.activity import Activity
from db.models.class_ import Class

log = logging.getLogger(__name__)

DEMO_TEACHER = "aipla-demo-teacher"
DEMO_CODE = "aipla-demo-1"
DEMO_CLASS_NAME = "Demo class"
# The real concept-dialogue skill UUID (some legacy rows stored the *name* as the
# skill id, which doesn't resolve — remap so the activity actually runs).
CONCEPT_SKILL_UUID = "f45dc300-4b90-4162-8f28-07fb42989378"
_BROKEN_CONCEPT_SKILL = "concept-dialogue"
# Skip obvious throwaway test rows from the demo (kept assignable elsewhere).
_SKIP_TITLES = {"Test New Activity"}
DEMO_TTL_DAYS = 180


def _all_activities() -> list[Activity]:
    return [Activity.model_validate(d) for d in query_documents("activities") if not d.get("deletedAt")]


def run(*, dry_run: bool = True) -> dict:
    acts = _all_activities()

    # 1. Distinct activities by title (the same sim under several owners → one).
    distinct: dict[str, Activity] = {}
    for a in acts:
        if a.title in _SKIP_TITLES:
            continue
        distinct.setdefault(a.title, a)

    demo_owned = {a.title: a for a in acts if a.owner_uid == DEMO_TEACHER}

    # 2. Ensure the demo teacher owns a copy of each distinct activity.
    demo_ids: list[str] = []
    created: list[str] = []
    reused: list[str] = []
    for title, src in distinct.items():
        if title in demo_owned:
            demo_ids.append(demo_owned[title].activity_id)
            reused.append(title)
            continue
        skill_id = CONCEPT_SKILL_UUID if src.skill_id == _BROKEN_CONCEPT_SKILL else src.skill_id
        copy = src.model_copy(
            update={
                "activity_id": "",  # mint a fresh act- id
                "owner_uid": DEMO_TEACHER,
                "skill_id": skill_id,
                "source_activity_id": src.activity_id,
                "source_owner_uid": src.owner_uid,
                "created_at": None,
                "updated_at": None,
            }
        )
        if dry_run:
            demo_ids.append(f"<copy:{title}>")
        else:
            demo_ids.append(create_activity(copy).activity_id)
        created.append(title)

    # 3. The Demo class (idempotent — reuse the demo teacher's existing one).
    existing = [c for c in list_classes_for_owner(DEMO_TEACHER) if c.name == DEMO_CLASS_NAME]
    if existing:
        demo_class = existing[0]
        class_action = f"reuse {demo_class.class_id}"
    else:
        demo_class = Class.create_for_teacher(owner_uid=DEMO_TEACHER, name=DEMO_CLASS_NAME)
        class_action = f"create {demo_class.class_id}"
        if not dry_run:
            create_class(demo_class)

    # 4. Assign + bind the code.
    if not dry_run:
        add_activities(demo_class.class_id, demo_ids)
        # Bind aipla-demo-1 → the Demo class + extend its TTL so it survives.
        existing_doc = get_document("anon_groups", DEMO_CODE) or {}
        update_document(
            "anon_groups",
            DEMO_CODE,
            {"classId": demo_class.class_id, "expires_at": time.time() + DEMO_TTL_DAYS * 86400},
        )
        # Record the code on the class so the teacher dashboard shows it.
        reloaded = get_class(demo_class.class_id)
        codes = list(reloaded.group_codes) if reloaded else []
        if DEMO_CODE not in codes:
            update_document("classes", demo_class.class_id, {"groupCodes": [*codes, DEMO_CODE]})
        log.info("bound %s → class %s (was bound to %s)", DEMO_CODE, demo_class.class_id, existing_doc.get("classId"))

    final_count = len(demo_ids) if dry_run else len(get_class(demo_class.class_id).activity_ids)
    return {
        "class": class_action,
        "demo_activities": len(demo_ids),
        "created_copies": created,
        "reused": reused,
        "final_assigned": final_count,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the aipla-demo-1 demo class + activities")
    parser.add_argument("--apply", action="store_true", help="actually write (default is dry-run)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    report = run(dry_run=not args.apply)
    mode = "APPLIED" if args.apply else "DRY-RUN"
    log.info("[%s] %s", mode, report["class"])
    log.info(
        "  demo activities: %d (created copies: %d, reused: %d)",
        report["demo_activities"],
        len(report["created_copies"]),
        len(report["reused"]),
    )
    log.info("  created: %s", report["created_copies"])
    log.info("  reused:  %s", report["reused"])
    log.info("  assigned to demo class: %d", report["final_assigned"])
    if not args.apply:
        log.info("\nDry-run only. Re-run with --apply to write.")


if __name__ == "__main__":
    main()
