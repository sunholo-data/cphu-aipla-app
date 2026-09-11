#!/usr/bin/env bash
# Provision the pedagogy-literature RAG corpus for ONE environment (1.1.110).
#
# Mirrors scripts/provision-curriculum-rag.sh step for step, because it is the
# same shape of job and two divergent scripts would be two things to maintain.
# What differs is the corpus and, crucially, WHO MAY REACH IT:
#
#   curriculum  → reachable from a STUDENT session (scoped per activity).
#   literature  → researcher AUTHORING only. `db/literature_corpus.py` exposes no
#                 tool builder, so there is nothing for an agent to be handed,
#                 and scripts/check-literature-corpus-isolation.sh fails the
#                 build if that ever changes.
#
# A RagCorpus is PER-PROJECT and does not promote with an artifact, so this has
# to run once per environment. Idempotent: an existing corpus of the same display
# name is reused and already-ingested papers are skipped.
#
# ⚠️ Copyrighted journal PDFs, approved by M on 2026-09-11 for ingestion into the
# project's own private corpus. The corpus must never be made public and no
# student-facing surface may cite from it.
#
# Usage:
#   scripts/provision-literature-rag.sh dev          # dry-run of the ingest
#   scripts/provision-literature-rag.sh dev GO=1     # create + upload + wire
set -euo pipefail

ENV="${1:-}"
GO="${2:-}"
case "$ENV" in
  dev | test | prod) ;;
  *)
    echo "usage: $0 <dev|test|prod> [GO=1]" >&2
    exit 2
    ;;
esac

PROJECT="aipla-${ENV}-2026"
# ⚠️ europe-NORTH1, which DIFFERS from the curriculum corpus (europe-west1).
#
# The curriculum script notes that the ADR-007 europe-north1 pin covers
# Firestore/GCS/logs rather than Vertex compute, and puts its corpus in
# europe-west1. That is fine for curriculum material, which teachers uploaded
# themselves. This corpus holds COPYRIGHTED third-party papers, and keeping them
# in the same region as the rest of AIPLA's data is the easier position to
# defend — so it is pinned here deliberately, not by inheritance.
#
# Getting this wrong is not theoretical: defaulting to europe-west1 on
# 2026-09-11 created an EMPTY duplicate corpus of the same display name in the
# other region while the populated one sat in europe-north1. Two corpora, one
# name, one of them silently empty. Deleted; the region is pinned here so it
# cannot recur.
REGION="${GOOGLE_CLOUD_LOCATION:-europe-north1}"
SA_EMAIL="aipla-v6@${PROJECT}.iam.gserviceaccount.com"
SECRET_NAME="LITERATURE_RAG_CORPUS_NAME"
BACKEND_SERVICE="aipla-v01-frontend"
CLOUD_RUN_REGION="europe-north1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { echo "[$(date +%H:%M:%S)] $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

log "Literature RAG for env=${ENV} project=${PROJECT} vertex-region=${REGION}"
gcloud projects describe "$PROJECT" >/dev/null 2>&1 || die "project ${PROJECT} not found / no access"

if [ "$GO" != "GO=1" ]; then
  log "DRY RUN — showing what would be ingested, creating nothing."
  GOOGLE_CLOUD_PROJECT="$PROJECT" GOOGLE_CLOUD_LOCATION="$REGION" \
    uv run --project "${REPO_ROOT}/backend" python "${REPO_ROOT}/backend/scripts/ingest_literature.py"
  log "Re-run with GO=1 to create the corpus, upload, and wire the secret."
  exit 0
fi

# 1. Vertex AI API (idempotent).
if ! gcloud services list --enabled --project="$PROJECT" \
  --filter="config.name:aiplatform.googleapis.com" --format="value(config.name)" | grep -q aiplatform; then
  log "Enabling aiplatform.googleapis.com"
  gcloud services enable aiplatform.googleapis.com --project="$PROJECT"
fi

# 2. Corpus + papers. The ingest script prints the resource name on its last line.
log "Ingesting the seven papers"
INGEST_OUT="$(
  GOOGLE_CLOUD_PROJECT="$PROJECT" GOOGLE_CLOUD_LOCATION="$REGION" \
    uv run --project "${REPO_ROOT}/backend" python "${REPO_ROOT}/backend/scripts/ingest_literature.py" --go 2>&1
)"
echo "$INGEST_OUT" | sed 's/^/    /'
RESOURCE_NAME="$(echo "$INGEST_OUT" | grep -oE 'projects/[^[:space:]]+/ragCorpora/[0-9]+' | tail -1)"
[ -n "$RESOURCE_NAME" ] || die "ingest returned no corpus resource name"
log "Corpus: ${RESOURCE_NAME}"

# 3. Secret Manager.
if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT" >/dev/null 2>&1; then
  CURRENT="$(gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT" 2>/dev/null || echo '')"
  if [ "$CURRENT" = "$RESOURCE_NAME" ]; then
    log "Secret already at this resource name"
  else
    printf '%s' "$RESOURCE_NAME" | gcloud secrets versions add "$SECRET_NAME" --project="$PROJECT" --data-file=-
  fi
else
  log "Creating secret ${SECRET_NAME}"
  printf '%s' "$RESOURCE_NAME" | gcloud secrets create "$SECRET_NAME" \
    --project="$PROJECT" --replication-policy="automatic" --data-file=-
fi

# 4. Runtime SA may read it.
if ! gcloud secrets get-iam-policy "$SECRET_NAME" --project="$PROJECT" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${SA_EMAIL} AND bindings.role:roles/secretmanager.secretAccessor" \
  --format="value(bindings.role)" 2>/dev/null | grep -q secretAccessor; then
  log "Granting secretAccessor to ${SA_EMAIL}"
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" --project="$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" --role="roles/secretmanager.secretAccessor" >/dev/null
fi

# 5. Wire it into the running service now, so the feature works before the next
#    deploy. Both pipelines also set it, so a later deploy keeps it.
if gcloud run services describe "$BACKEND_SERVICE" --project="$PROJECT" --region="$CLOUD_RUN_REGION" >/dev/null 2>&1; then
  log "Wiring ${SECRET_NAME} into ${BACKEND_SERVICE}"
  gcloud run services update "$BACKEND_SERVICE" \
    --project="$PROJECT" --region="$CLOUD_RUN_REGION" \
    --update-secrets "${SECRET_NAME}=${SECRET_NAME}:latest" >/dev/null
else
  log "Cloud Run service not found — the next deploy will pick the secret up."
fi

log "Done. ${ENV} can now search the literature."
