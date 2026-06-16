"""One-time backfill: populate ``curriculum_content`` for SHARED curriculum docs
that were seeded BEFORE 1.1.33 M3 added content storage.

New ingests store the parsed text automatically (the M3 ingest path calls
``set_curriculum_content``); this script fixes the historical gap so the seeded
læreplan/vejledning are readable in the content viewer instead of showing
"added before content viewing existed".

How it works:
  * Lists shared docs and skips any that already have stored content (idempotent).
  * Maps each remaining doc to its source markdown by TITLE — the same titles
    ``scripts/seed-curriculum.sh`` minted (``Fysik A (læreplan)`` etc).
  * Reads the ``.md`` verbatim — that is exactly what the M3 ingest path would
    have stored for a ``.md`` upload (plain read, no re-parse), so the backfill
    reproduces the same content. No RAG re-upload (the corpus already has it).

Run from ``backend/`` with the TARGET project's ADC (see the make target):
    GOOGLE_CLOUD_PROJECT=aipla-dev-2026 \\
    uv run python scripts/backfill_curriculum_content.py [--dry-run]

Source dir defaults to the gitignored scoping site; override via
``CURRICULUM_SRC_DIR`` (same env var the seed uses).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# Source markdown filenames per level — kept in sync with scripts/seed-curriculum.sh.
_LAEREPLAN_FILES = {
    "A": "fysik_a_stx_laereplan_2024_da.md",
    "B": "fysik_b_stx_laereplan_2024_da.md",
    "C": "fysik_c_stx_laereplan_2017_da.md",
}
_VEJLEDNING_FILES = {
    "A": "fysik_a_stx_vejledning_2024_da.md",
    "B": "fysik_b_stx_vejledning_2024_da.md",
    "C": "fysik_c_stx_vejledning_2024_da.md",
}

_LAEREPLAN_TITLE = re.compile(r"^Fysik ([ABC]) \(læreplan\)$")
_VEJLEDNING_TITLE = re.compile(r"^Vejledning til Fysik ([ABC])$")


def resolve_source_file(title: str) -> str | None:
    """Map a seeded doc title to its source markdown filename, or None if the
    title doesn't match a known seed pattern."""
    m = _LAEREPLAN_TITLE.match(title)
    if m:
        return _LAEREPLAN_FILES.get(m.group(1))
    m = _VEJLEDNING_TITLE.match(title)
    if m:
        return _VEJLEDNING_FILES.get(m.group(1))
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    args = parser.parse_args()

    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        print("ERROR: GOOGLE_CLOUD_PROJECT is not set — refusing to guess the Firestore project.", file=sys.stderr)
        return 2

    src_dir = Path(
        os.environ.get("CURRICULUM_SRC_DIR", str(Path.home() / "Documents/clients/cph-uni/sources/curriculum"))
    )

    # Imported here so --help works without ADC / backend env.
    from db.curriculum import get_curriculum_content, list_curriculum_for_teacher, set_curriculum_content

    project = os.environ["GOOGLE_CLOUD_PROJECT"]
    mode = "DRY-RUN" if args.dry_run else "WRITE"
    print(f"[{mode}] backfilling curriculum_content  project={project}  src={src_dir}")

    docs = list_curriculum_for_teacher("__backfill__", scope="shared")
    filled = skipped = missing = unmatched = 0

    for doc in docs:
        if get_curriculum_content(doc.doc_id) is not None:
            skipped += 1
            continue

        src_name = resolve_source_file(doc.title)
        if not src_name:
            print(f"  ?  {doc.doc_id}  {doc.title!r} — no source-file mapping, skipping")
            unmatched += 1
            continue

        src_path = src_dir / src_name
        if not src_path.is_file():
            print(f"  !  {doc.doc_id}  {doc.title!r} — source not found: {src_path}")
            missing += 1
            continue

        text = src_path.read_text(encoding="utf-8")
        if args.dry_run:
            print(f"  ~  {doc.doc_id}  {doc.title!r} — would store {len(text)} chars from {src_name}")
        else:
            set_curriculum_content(doc.doc_id, text)
            print(f"  +  {doc.doc_id}  {doc.title!r} — stored {len(text)} chars from {src_name}")
        filled += 1

    print(
        f"[{mode}] done — {filled} filled, {skipped} already had content, "
        f"{missing} source-missing, {unmatched} unmatched"
    )
    if missing:
        print("  Source files missing — check CURRICULUM_SRC_DIR points at the scoping-site curriculum dir.")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
