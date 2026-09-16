"""One-time backfill: attach an activity to ``parsed_documents`` rows that were
stored with ``skillId == ""``.

Until 2026-09-16 the upload route read ``skill_id`` as a QUERY parameter while
every caller sent it as a multipart FORM field, so every workbench upload was
stored without its activity — and the workbench, which lists by ``skillId``,
could never show them (Aswin, busy-garden-11, 2026-09-15). The route is fixed;
this repairs the rows that already exist.

There is no safe way to *infer* the activity for an orphan (a group can be on
several), so the operator names it explicitly per uid. Dry-run by default.

Run from ``backend/`` with the TARGET project's ADC (see the make target):
    GOOGLE_CLOUD_PROJECT=aipla-prod-2026 uv run python scripts/backfill_document_skill_ids.py --list
    GOOGLE_CLOUD_PROJECT=aipla-prod-2026 uv run python scripts/backfill_document_skill_ids.py \\
        --uid anon-busygarden11 --skill-id <activity skillId> [--go]
"""

from __future__ import annotations

import argparse
import sys

_COLLECTION = "parsed_documents"


def _orphans(db, uid: str | None):
    q = db.collection(_COLLECTION).where("skillId", "==", "")
    if uid:
        q = q.where("userId", "==", uid)
    return [(d.id, d.to_dict() or {}) for d in q.stream()]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="List every orphan (all uids) and exit.")
    ap.add_argument("--uid", help="Owner uid whose orphans to repair (e.g. anon-busygarden11).")
    ap.add_argument("--skill-id", help="The activity skillId to stamp on them.")
    ap.add_argument("--go", action="store_true", help="Write. Without it, dry-run.")
    args = ap.parse_args(argv)

    from google.cloud import firestore

    db = firestore.Client()
    print(f"[backfill] project={db.project}")

    if args.list:
        rows = _orphans(db, None)
        print(f"[backfill] {len(rows)} orphan(s) with skillId=''")
        for doc_id, r in sorted(rows, key=lambda x: x[1].get("createdAt") or ""):
            print(
                f"  {r.get('createdAt', '?')[:19]}  {r.get('userId', '?'):28}  {r.get('parseStatus', '?'):8}  {r.get('originalFilename', '?')}  [{doc_id}]"
            )
        return 0

    if not args.uid or not args.skill_id:
        ap.error("--uid and --skill-id are required unless --list")

    rows = _orphans(db, args.uid)
    print(f"[backfill] {len(rows)} orphan(s) for uid={args.uid} → skillId={args.skill_id}")
    for doc_id, r in rows:
        print(f"  {r.get('parseStatus', '?'):8}  {r.get('originalFilename', '?')}  [{doc_id}]")
    if not rows:
        return 0
    if not args.go:
        print("[backfill] dry-run — re-run with --go to write")
        return 0
    batch = db.batch()
    for doc_id, _ in rows:
        batch.update(db.collection(_COLLECTION).document(doc_id), {"skillId": args.skill_id})
    batch.commit()
    print(f"[backfill] ✓ stamped {len(rows)} row(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
