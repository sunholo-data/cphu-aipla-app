#!/usr/bin/env python3
"""Ingest the pedagogy literature into its own RAG corpus (1.1.110).

Makes a citation checkable. A framework's ``vouchedBy: M`` currently asks a
reader to trust that a behaviour came from the paper it names; with the corpus
in place the researcher's editor can show them the passage.

Reads the **parsed Markdown**, never the PDFs: ``docs/literature/tp-framework/
parsed/*.pdf.md`` already holds an extraction of each paper, and the README says
to read those rather than the PDFs.

⚠️ This corpus is SEPARATE from the curriculum corpus and must stay that way.
The curriculum corpus is reachable from a student session; this one has no tool
builder, so there is nothing for an agent to be handed. See
``db/literature_corpus.py``.

⚠️ Copyrighted material. Approved by M on 2026-09-11 for ingestion into the
project's own private corpus. Never make the corpus public; no student-facing
surface may cite from it.

Usage:
    export GOOGLE_CLOUD_PROJECT=aipla-dev-2026
    export GOOGLE_CLOUD_LOCATION=europe-north1
    uv run python backend/scripts/ingest_literature.py            # DRY RUN
    uv run python backend/scripts/ingest_literature.py --go       # create + upload

Side effects are recorded in docs/ops/gcp-side-effects.md (AIPLA convention).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PARSED = REPO / "docs/literature/tp-framework/parsed"

#: Which framework each parsed file grounds. Keyed by a distinctive fragment of
#: the filename because the Drive-mirrored names carry publisher artefacts (and
#: the Drive's own typos — "Dialouge", "Clam").
FRAMEWORK_BY_FILE = {
    "Ruiz": ("esru", "Ruiz-Primo & Furtak (2007). JRST 44(1), 57-84."),
    "dysthe": ("authentic-dialogue", "Dysthe, O. (1996). Written Communication, 13(3), 385-425."),
    "Inquiry and Scientific Explanation": (
        "cer",
        "McNeill & Krajcik (2008), in Science as Inquiry in the Secondary Setting, NSTA Press.",
    ),
    "tanner": ("5e", "Tanner, K. D. (2010). CBE-Life Sciences Education, 9(3), 159-164."),
    "ED420715": ("poe", "Liew & Treagust (1998). AERA, San Diego. ERIC ED420715."),
    "Erduran": ("toulmin", "Erduran, Simon & Osborne (2004). Science Education, 88(6), 915-933."),
    "AT-Sourcebook": (
        "accountable-talk",
        "Michaels, O'Connor, Hall & Resnick. Accountable Talk Sourcebook, University of Pittsburgh.",
    ),
}


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def classify(path: Path) -> tuple[str, str] | None:
    for fragment, pair in FRAMEWORK_BY_FILE.items():
        if fragment.lower() in path.name.lower():
            return pair
    return None


def sources() -> list[tuple[Path, str, str]]:
    """(parsed file, framework_id, citation) for every paper we can place."""
    if not PARSED.is_dir():
        raise SystemExit(f"no parsed literature at {PARSED} — see docs/literature/tp-framework/README.md")
    out = []
    for path in sorted(PARSED.glob("*.md")):
        if path.name.startswith("README"):
            continue
        placed = classify(path)
        if placed is None:
            _log(f"  SKIP (unplaced)  {path.name}")
            continue
        out.append((path, placed[0], placed[1]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true", help="actually create the corpus and upload")
    ap.add_argument("--display-name", default=None)
    args = ap.parse_args()

    from db.literature_corpus import DEFAULT_DISPLAY_NAME

    display_name = args.display_name or DEFAULT_DISPLAY_NAME
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "europe-north1")
    if not project:
        raise SystemExit("GOOGLE_CLOUD_PROJECT must be set")

    found = sources()
    _log(f"Project:      {project}")
    _log(f"Location:     {location}")
    _log(f"Corpus:       {display_name}")
    _log(f"Papers:       {len(found)} of {len(FRAMEWORK_BY_FILE)} frameworks")
    for path, fid, citation in found:
        kb = path.stat().st_size / 1024
        _log(f"  {fid:<20} {kb:7.0f} KB  {citation[:60]}")

    missing = {f for f, _ in FRAMEWORK_BY_FILE.values()} - {f for _, f, _ in found}
    if missing:
        _log(f"⚠️  no parsed text for: {', '.join(sorted(missing))}")

    if not args.go:
        _log("\n[dry-run] nothing created or uploaded. Re-run with --go.")
        return 0

    import vertexai
    from vertexai import rag

    vertexai.init(project=project, location=location)

    existing = next((c for c in rag.list_corpora() if c.display_name == display_name), None)
    if existing:
        corpus = existing
        _log(f"\nCorpus exists: {corpus.name}")
    else:
        corpus = rag.create_corpus(
            display_name=display_name,
            backend_config=rag.RagVectorDbConfig(
                rag_embedding_model_config=rag.RagEmbeddingModelConfig(
                    vertex_prediction_endpoint=rag.VertexPredictionEndpoint(
                        publisher_model="publishers/google/models/text-embedding-005"
                    )
                )
            ),
        )
        _log(f"\nCorpus created: {corpus.name}")

    # Names already in the corpus, so a re-run does not duplicate every paper.
    present = {f.display_name for f in rag.list_files(corpus.name)}

    import tempfile

    uploaded = 0
    for path, fid, citation in found:
        # The display name is the FRAMEWORK ID and nothing else. It is the only
        # metadata a retrieval context reliably carries back, so it has to be
        # the field the query layer reads — and it must be a plain filename: a
        # JSON blob here fails indexing with a bare `{'code': 13}` that names
        # nothing (2026-09-11, first ingest attempt).
        #
        # The CITATION is deliberately not stored here. It lives in the
        # framework YAML's provenance, which is its one source of truth; copying
        # it into the corpus would be a second copy to drift.
        name = f"{fid}.txt"
        if name in present:
            _log(f"  = {fid} already ingested")
            continue
        # .txt, not .md — matching the curriculum path, which is the shape known
        # to index successfully.
        with tempfile.NamedTemporaryFile(
            "w", suffix=".txt", prefix=f"lit_{fid}_", delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(path.read_text(encoding="utf-8"))
            tmp_path = tmp.name
        try:
            rag.upload_file(corpus_name=corpus.name, path=tmp_path, display_name=name, description=citation)
            uploaded += 1
            _log(f"  + {fid}")
        finally:
            os.unlink(tmp_path)

    _log(f"\nUploaded {uploaded} paper(s).")
    _log(f"\nSet LITERATURE_RAG_CORPUS_NAME={corpus.name}")
    _log("Store it in Secret Manager and inject it into Cloud Run, as the curriculum corpus is.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
