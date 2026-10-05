"""Stamp ``ragStatus`` on curriculum docs written before 1.1.151, and re-ingest
named documents. Dry run unless ``--go``.

Design: docs/design/aipla/v1.1.0-feedback/seminar-log-follow-ups.md (F1a/F1b)

WHY THIS EXISTS

    A failed RAG upload used to leave only a WARNING behind, followed by an
    INFO line that said "ingested". The document row carried ``docArtifactId: ''``
    and nothing else, so no surface could tell "the tutor can read this" from
    "the tutor never will". 1.1.151 adds ``ragStatus``; the model already DERIVES
    it for an old row on read (``ready`` iff ``docArtifactId`` is set, else
    ``failed``). This script persists the same rule so the stored data says what
    the UI says, and so ``ragStatus == "failed"`` is queryable.

    It also re-ingests named documents (``--reingest <doc_id>``) through the SAME
    code the teacher's *Prøv igen* runs (``db.curriculum_reingest``).

    Safe to re-run: a row that already has ``ragStatus`` is never touched by the
    stamp pass.

USAGE (from the repo root — the make target maps ENV to the project)
    make backfill-rag-status ENV=dev                          # dry run
    make backfill-rag-status ENV=dev GO=1                     # write
    make backfill-rag-status ENV=prod REINGEST=<doc_id> GO=1  # re-upload one doc
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import UTC, datetime
from typing import Any

LEGACY_ERROR = "No RAG file was recorded for this document (uploaded before 1.1.151)."


def plan_stamps(rows: list[dict[str, Any]]) -> list[tuple[str, dict[str, Any]]]:
    """Return ``(doc_id, update)`` for every row with no ``ragStatus``. Pure."""
    from db.models.curriculum import derive_rag_status

    now = datetime.now(UTC).isoformat()
    plan: list[tuple[str, dict[str, Any]]] = []
    for row in rows:
        if row.get("ragStatus"):
            continue
        doc_id = row.get("docId")
        if not doc_id:
            continue
        status = derive_rag_status(row.get("docArtifactId"))
        update: dict[str, Any] = {"ragStatus": status, "ragUpdatedAt": now}
        if status == "failed":
            update["ragError"] = LEGACY_ERROR
        plan.append((doc_id, update))
    return plan


async def _reingest(doc_ids: list[str], go: bool) -> int:
    from db.curriculum import get_curriculum_doc
    from db.curriculum_reingest import NoStoredText, reingest_curriculum_doc

    failures = 0
    for doc_id in doc_ids:
        doc = get_curriculum_doc(doc_id)
        if doc is None:
            print(f"  REINGEST {doc_id}: not found")
            failures += 1
            continue
        print(f"  REINGEST {doc_id} '{doc.title}' owner={doc.owner_scope} status={doc.rag_status}")
        if not go:
            print("    (dry run — pass GO=1 to upload)")
            continue
        try:
            doc, rag = await reingest_curriculum_doc(doc)
        except NoStoredText:
            print("    no stored text — the owner must upload the file again")
            failures += 1
            continue
        print(f"    -> {doc.rag_status} attempts={rag.attempts} error={rag.error or '-'}")
        if doc.rag_status != "ready":
            failures += 1
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--go", action="store_true", help="write (default: dry run)")
    parser.add_argument("--reingest", action="append", default=[], metavar="DOC_ID", help="re-upload this doc")
    args = parser.parse_args(argv)

    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        print("ERROR: GOOGLE_CLOUD_PROJECT is not set — refusing to guess the Firestore project.", file=sys.stderr)
        return 2

    from db.firestore import query_documents, update_document

    mode = "WRITE" if args.go else "DRY-RUN"
    print(f"[{mode}] curriculum ragStatus backfill  project={project}")

    rows = query_documents("curriculum_docs")
    plan = plan_stamps(rows)
    failed = [d for d, u in plan if u["ragStatus"] == "failed"]
    print(f"  {len(rows)} docs; {len(plan)} without ragStatus ({len(failed)} failed, {len(plan) - len(failed)} ready)")
    for doc_id in failed:
        print(f"    failed: {doc_id}")
    if args.go:
        for doc_id, update in plan:
            update_document("curriculum_docs", doc_id, update)
        print(f"  stamped {len(plan)} docs")

    failures = asyncio.run(_reingest(args.reingest, args.go)) if args.reingest else 0
    return 1 if failures else 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    raise SystemExit(main())
