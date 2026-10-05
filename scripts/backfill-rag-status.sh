#!/usr/bin/env bash
# 1.1.151 F1 — stamp ragStatus on curriculum docs written before it existed, and
# re-ingest named docs through the same code as the teacher's "Prøv igen".
# Maps env → project, runs against that project's Firestore with your ADC.
# Dry-run unless --go.
#
# Usage:
#   scripts/backfill-rag-status.sh dev                         # dry run
#   scripts/backfill-rag-status.sh dev --go
#   scripts/backfill-rag-status.sh prod --reingest <doc_id> --go
#
# --reingest needs CURRICULUM_RAG_CORPUS_NAME; when unset it is read from the
# env's Secret Manager (the same secret Cloud Run mounts).
set -euo pipefail

if ! command -v gcloud >/dev/null 2>&1 && [ -x "$HOME/dev/google-cloud-sdk/bin/gcloud" ]; then
  PATH="$HOME/dev/google-cloud-sdk/bin:$PATH"
fi

ENV="${1:-dev}"
shift || true

case "$ENV" in
dev) PROJECT="aipla-dev-2026" ;;
test) PROJECT="aipla-test-2026" ;;
prod) PROJECT="aipla-prod-2026" ;;
*)
  echo "ERROR: unknown env '${ENV}' (use dev/test/prod)" >&2
  exit 1
  ;;
esac

if [[ " $* " == *" --reingest "* ]] && [ -z "${CURRICULUM_RAG_CORPUS_NAME:-}" ]; then
  CURRICULUM_RAG_CORPUS_NAME="$(gcloud secrets versions access latest \
    --secret=CURRICULUM_RAG_CORPUS_NAME --project="${PROJECT}")"
  if [ -z "${CURRICULUM_RAG_CORPUS_NAME}" ]; then
    echo "ERROR: could not read CURRICULUM_RAG_CORPUS_NAME from ${PROJECT} — refusing to re-ingest blind." >&2
    exit 1
  fi
  export CURRICULUM_RAG_CORPUS_NAME
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "[backfill-rag-status] env=${ENV} project=${PROJECT}"
cd "${REPO_ROOT}/backend"
GOOGLE_CLOUD_PROJECT="${PROJECT}" uv run python scripts/backfill_rag_status.py "$@"
