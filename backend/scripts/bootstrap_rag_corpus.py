#!/usr/bin/env python3
"""Bootstrap a Vertex AI RAG corpus for the AIPLA curriculum library (1.1.25 M2).

Provisions a RagManagedDb-backed RagCorpus (pay-per-use managed vector store,
ADR-010 + ADR-007 europe-north1). Idempotent: if a corpus with the target
display name already exists, its resource name is printed and nothing is created.

The resource name must be stored in Secret Manager as CURRICULUM_RAG_CORPUS_NAME,
then injected into the Cloud Run env so ``db.rag_corpus.get_corpus_name()`` reads
it at runtime.

Usage:
    export GOOGLE_CLOUD_PROJECT=aipla-dev-2026
    export GOOGLE_CLOUD_LOCATION=europe-north1
    uv run python backend/scripts/bootstrap_rag_corpus.py

Dry-run (no Vertex calls):
    uv run python backend/scripts/bootstrap_rag_corpus.py --dry-run

Side effects are recorded in docs/ops/gcp-side-effects.md (AIPLA convention).
"""

from __future__ import annotations

import argparse
import os
import sys

DEFAULT_DISPLAY_NAME = "aipla-curriculum-v1"


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def bootstrap(display_name: str, dry_run: bool) -> str:
    """Create or find the RAG corpus. Returns the full resource name."""
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "europe-north1")
    if not project:
        raise SystemExit("GOOGLE_CLOUD_PROJECT must be set")

    _log(f"Project:      {project}")
    _log(f"Location:     {location}")
    _log(f"Display name: {display_name}")
    _log("Backend:      RagManagedDb (managed vector store — no pgvector ops, ADR-010)")

    if dry_run:
        _log("[dry-run] would call vertexai.init + rag.list_corpora / rag.create_corpus")
        fake = f"projects/{project}/locations/{location}/ragCorpora/DRY_RUN"
        _log(f"[dry-run] resource name would be: {fake}")
        return fake

    import vertexai
    from vertexai import rag

    vertexai.init(project=project, location=location)

    # Idempotency: look for an existing corpus with the same display name.
    for existing in rag.list_corpora():
        if getattr(existing, "display_name", None) == display_name:
            resource_name = existing.name
            _log(f"Found existing RAG corpus: {resource_name}")
            _print_next_steps(resource_name)
            return resource_name

    _log("No existing RAG corpus matched — creating new one (RagManagedDb backend).")
    corpus = rag.create_corpus(
        display_name=display_name,
        description=(
            "AIPLA curriculum library: Danish stx A/B/C physics material. "
            "Managed RAG vector store (ADR-010). Ingest via POST /api/curriculum/ingest."
        ),
        # RagManagedDb is the Vertex AI RAG default when no backend_config is passed.
    )
    resource_name = corpus.name
    _log(f"Created RAG corpus: {resource_name}")
    _print_next_steps(resource_name)
    return resource_name


def _print_next_steps(resource_name: str) -> None:
    _log("")
    _log("NEXT STEPS — store resource name in Secret Manager:")
    _log(f"  echo '{resource_name}' | gcloud secrets versions add CURRICULUM_RAG_CORPUS_NAME --data-file=-")
    _log(
        "  # Then add CURRICULUM_RAG_CORPUS_NAME to Cloud Run env (cloudbuild.yaml or gcloud run deploy --update-env-vars)"
    )
    _log("")
    _log("Record in docs/ops/gcp-side-effects.md:")
    _log(f"  RAG corpus {resource_name} created for curriculum library (1.1.25 M2).")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--display-name", default=DEFAULT_DISPLAY_NAME)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print plan without calling Vertex AI",
    )
    args = parser.parse_args()

    resource_name = bootstrap(args.display_name, args.dry_run)
    # stdout: full resource name only — pipe to Secret Manager.
    print(resource_name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
