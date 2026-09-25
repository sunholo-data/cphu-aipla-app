#!/usr/bin/env python
"""Stamp ``classId`` on ``concept_progress`` documents written before M4.

CONCEPT-2 M4. The class rollup is one indexed query on ``classId``, which every
write has carried since this sprint. Documents written before it have none and
are invisible to the rollup — deliberately, rather than being guessed at, since
a rollup that quietly filled in what it could not read is the "checker answers
when it could not read its subject" failure this repo has shipped twice.

So: one idempotent pass that resolves each document's group through
``anon_groups/{group_id}.classId`` — the binding the group code was minted
with — and stamps it. A group whose binding is gone (revoked code, workshop
session) is reported and left alone; it never belonged to a class rollup.

Two documents existed on prod when this was written.

    uv run python scripts/backfill_concept_progress_class_id.py            # dry run
    uv run python scripts/backfill_concept_progress_class_id.py --apply
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.firestore import get_document, query_documents, update_document

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("backfill")

COLLECTION = "concept_progress"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write (default is a dry run)")
    args = parser.parse_args()

    docs = query_documents(collection=COLLECTION)
    todo = [d for d in docs if not d.get("classId")]
    log.info("%d document(s); %d without classId", len(docs), len(todo))

    stamped = unbound = 0
    for doc in todo:
        doc_id = doc.get("__id") or ""
        group_id = doc.get("groupId") or ""
        binding = get_document("anon_groups", group_id) or {} if group_id else {}
        class_id = binding.get("classId") or ""
        if not class_id:
            unbound += 1
            log.info("  SKIP %s — group %r has no class binding", doc_id, group_id)
            continue
        stamped += 1
        log.info("  %s %s -> classId=%s", "STAMP" if args.apply else "would stamp", doc_id, class_id)
        if args.apply:
            update_document(COLLECTION, doc_id, {"classId": class_id})

    log.info("%s: %d stamped, %d left unbound", "applied" if args.apply else "dry run", stamped, unbound)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
