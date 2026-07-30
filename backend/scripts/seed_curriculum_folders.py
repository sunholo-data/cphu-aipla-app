"""One-time migration: relocate the physics-area taxonomy from `subject` to FOLDERS.

Background — why this exists (1.1.60):

  `subject` shipped in 1.1.58 M2 as the nine Danish stx *physics* areas (Mekanik,
  Termodynamik, ...). Two things then went wrong. First, the corpus broadened past
  physics — maths documents had no home on that axis, and the seeded AIPLA guides
  were filed under a made-up "AIPLA guides" subject, i.e. a non-physics value
  masquerading as a physics area. Second, and worse, NOTHING ever wrote `subject`:
  the backend accepted it at ingest but neither the upload form nor the CLI sent
  it, so every document except the guides had `subject=None` and the Subject facet
  row rendered a single chip.

  1.1.60 redefines `subject` as the BROAD class (Fysik / Matematik / Kemi / AIPLA
  guides) and moves the within-subject taxonomy into folders, which is where a
  teacher organises anyway.

What this script does (all idempotent, safe to re-run):

  1. Creates the nine physics areas as SHARED folders, so every teacher gets the
     same starting taxonomy rather than each inventing their own.
  2. Rewrites any doc still carrying a physics area as its `subject`: sets
     `subject="Fysik"` and files it into the matching folder. This is the only
     destructive step and it only ever touches the nine known values.

  It deliberately does NOT guess a subject for the ~all documents that have none.
  That is the classifier's job (`aiplatform curriculum suggest-subjects`, the next
  milestone) — a title-based heuristic here would produce confident-looking wrong
  answers that a teacher then has to find and undo.

Run from ``backend/`` with the TARGET project's ADC (see the make target):

    GOOGLE_CLOUD_PROJECT=aipla-dev-2026 \\
    uv run python scripts/seed_curriculum_folders.py [--dry-run]
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from datetime import UTC, datetime

# The broad subject every relocated physics doc lands on.
_PHYSICS_SUBJECT = "Fysik"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    args = parser.parse_args()

    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        print("ERROR: GOOGLE_CLOUD_PROJECT is not set — refusing to guess the Firestore project.", file=sys.stderr)
        return 2

    # Imported here so --help works without ADC / backend env.
    from db.curriculum import (
        create_curriculum_doc,
        create_curriculum_folder,
        list_curriculum_folders_for_teacher,
        list_curriculum_for_teacher,
    )
    from db.models.curriculum import PHYSICS_AREAS, SHARED_SCOPE, CurriculumFolder

    project = os.environ["GOOGLE_CLOUD_PROJECT"]
    mode = "DRY-RUN" if args.dry_run else "WRITE"
    print(f"[{mode}] seeding curriculum folders  project={project}")

    # --- 1. the nine shared folders (idempotent by NAME within the shared scope)
    existing = {f.name: f for f in list_curriculum_folders_for_teacher("__migration__", scope="shared")}
    by_name: dict[str, str] = {name: f.folder_id for name, f in existing.items()}
    created = 0

    for area in PHYSICS_AREAS:
        if area in by_name:
            print(f"  =  folder {area!r} already exists ({by_name[area]})")
            continue
        folder_id = str(uuid.uuid4())
        if args.dry_run:
            print(f"  ~  would create shared folder {area!r}")
            # Keep the id so step 2's dry-run output is realistic.
            by_name[area] = folder_id
        else:
            create_curriculum_folder(
                CurriculumFolder(
                    folderId=folder_id,
                    name=area,
                    ownerScope=SHARED_SCOPE,
                    createdAt=datetime.now(UTC),
                )
            )
            by_name[area] = folder_id
            print(f"  +  created shared folder {area!r} ({folder_id})")
        created += 1

    # --- 2. relocate docs whose `subject` is still a physics area
    # Only SHARED docs can go in a shared folder (the ACL invariant the assign
    # path enforces). A teacher's own doc carrying a legacy area gets its subject
    # corrected but stays unfiled — it would need a folder in its own scope.
    areas = set(PHYSICS_AREAS)
    docs = list_curriculum_for_teacher("__migration__", scope="shared")
    moved = subject_only = 0

    for doc in docs:
        if doc.subject not in areas:
            continue
        area = doc.subject
        folder_id = by_name.get(area)
        doc.subject = _PHYSICS_SUBJECT
        if doc.folder_id:
            # Already filed by a teacher — don't override their choice, just fix
            # the subject.
            subject_only += 1
            action = f"subject {area!r} -> {_PHYSICS_SUBJECT!r} (keeps folder {doc.folder_name!r})"
        else:
            doc.folder_id = folder_id
            doc.folder_name = area
            moved += 1
            action = f"subject {area!r} -> {_PHYSICS_SUBJECT!r}, filed into {area!r}"

        if args.dry_run:
            print(f"  ~  {doc.doc_id}  {doc.title!r} — would set {action}")
        else:
            doc.updated_at = datetime.now(UTC)
            create_curriculum_doc(doc)
            print(f"  +  {doc.doc_id}  {doc.title!r} — {action}")

    print(f"[{mode}] done — {created} folders created, {moved} docs relocated, {subject_only} subject-only fixes")
    print("  Docs with NO subject are left alone on purpose — that's the classifier's job")
    print("  (`aiplatform curriculum suggest-subjects`), not a title heuristic.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
