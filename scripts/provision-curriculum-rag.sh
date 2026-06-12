#!/usr/bin/env bash
# Idempotent per-env provisioner for the curriculum RAG corpus (1.1.25 M2/M5).
#
# Stands up everything the curriculum library needs to do real RAG ingestion +
# retrieval in one environment:
#   1. Enables aiplatform.googleapis.com
#   2. Grants the backend SA roles/aiplatform.user (create corpus + upload + query)
#   3. Creates/finds the RagManagedDb corpus (via bootstrap_rag_corpus.py)
#   4. Stores the corpus resource name in Secret Manager (CURRICULUM_RAG_CORPUS_NAME)
#   5. Grants the backend SA secretAccessor on that secret
#   6. Wires the secret into the backend Cloud Run service env (if the service exists)
#
# Re-runnable: each step checks current state before mutating. The bootstrap
# step is idempotent (finds an existing corpus by display name).
#
# This script is ALSO the corpus-creation bridge invoked by the
# `infrastructure/modules/curriculum-rag` Terraform module (the google provider
# has no native Vertex RAG corpus resource yet — see that module's README).
#
# Usage:
#   scripts/provision-curriculum-rag.sh dev
#   scripts/provision-curriculum-rag.sh test
#   scripts/provision-curriculum-rag.sh prod
#
# Prereqs: gcloud authenticated as a project owner/editor for the target env,
# `uv` available (for the bootstrap python), and the backend deps installed.
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
  dev | test | prod) ;;
  *)
    echo "Usage: $0 <dev|test|prod>" >&2
    exit 2
    ;;
esac

PROJECT="aipla-${ENV}-2026"
REGION="${GOOGLE_CLOUD_LOCATION:-europe-north1}"   # ADR-007 Finland
SA_EMAIL="aipla-v6@${PROJECT}.iam.gserviceaccount.com"
SECRET_NAME="CURRICULUM_RAG_CORPUS_NAME"
CORPUS_DISPLAY_NAME="${CURRICULUM_RAG_DISPLAY_NAME:-aipla-curriculum-v1}"
BACKEND_SERVICE="${CURRICULUM_RAG_BACKEND_SERVICE:-aipla-v01-backend}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { echo "[$(date +%H:%M:%S)] $*"; }
die() {
  echo "ERROR: $*" >&2
  exit 1
}

log "Provisioning curriculum RAG for env=${ENV} project=${PROJECT} region=${REGION}"
gcloud projects describe "$PROJECT" >/dev/null 2>&1 || die "project ${PROJECT} not found / no access"

# 1. Enable Vertex AI API (idempotent).
if gcloud services list --enabled --project="$PROJECT" \
  --filter="config.name:aiplatform.googleapis.com" --format="value(config.name)" | grep -q aiplatform; then
  log "aiplatform.googleapis.com already enabled"
else
  log "Enabling aiplatform.googleapis.com"
  gcloud services enable aiplatform.googleapis.com --project="$PROJECT"
fi

# 2. Backend SA -> roles/aiplatform.user (create corpus + upload RagFiles + query).
if gcloud projects get-iam-policy "$PROJECT" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${SA_EMAIL} AND bindings.role:roles/aiplatform.user" \
  --format="value(bindings.role)" | grep -q aiplatform.user; then
  log "SA already has roles/aiplatform.user"
else
  log "Granting roles/aiplatform.user to ${SA_EMAIL}"
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/aiplatform.user" >/dev/null
fi

# 3. Create or find the RagManagedDb corpus. bootstrap_rag_corpus.py prints the
#    full resource name to stdout (logs go to stderr), and is idempotent.
log "Resolving RAG corpus (display name: ${CORPUS_DISPLAY_NAME})"
RESOURCE_NAME="$(
  GOOGLE_CLOUD_PROJECT="$PROJECT" GOOGLE_CLOUD_LOCATION="$REGION" \
    uv run --project "${REPO_ROOT}/backend" python "${REPO_ROOT}/backend/scripts/bootstrap_rag_corpus.py" \
    --display-name "$CORPUS_DISPLAY_NAME"
)"
[ -n "$RESOURCE_NAME" ] || die "bootstrap_rag_corpus.py returned no resource name"
log "Corpus resource: ${RESOURCE_NAME}"

# 4. Store the resource name in Secret Manager (create secret if absent, add version).
if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT" >/dev/null 2>&1; then
  CURRENT="$(gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT" 2>/dev/null || echo '')"
  if [ "$CURRENT" = "$RESOURCE_NAME" ]; then
    log "Secret ${SECRET_NAME} already at this resource name (no new version)"
  else
    log "Adding new version to secret ${SECRET_NAME}"
    printf '%s' "$RESOURCE_NAME" | gcloud secrets versions add "$SECRET_NAME" --project="$PROJECT" --data-file=-
  fi
else
  log "Creating secret ${SECRET_NAME}"
  printf '%s' "$RESOURCE_NAME" | gcloud secrets create "$SECRET_NAME" \
    --project="$PROJECT" --replication-policy="automatic" --data-file=-
fi

# 5. Backend SA -> secretAccessor on the secret (so Cloud Run can read it).
if gcloud secrets get-iam-policy "$SECRET_NAME" --project="$PROJECT" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${SA_EMAIL} AND bindings.role:roles/secretmanager.secretAccessor" \
  --format="value(bindings.role)" 2>/dev/null | grep -q secretAccessor; then
  log "SA already has secretAccessor on ${SECRET_NAME}"
else
  log "Granting secretAccessor on ${SECRET_NAME} to ${SA_EMAIL}"
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --project="$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
fi

# 6. Wire the secret into the backend Cloud Run service env (best-effort).
if gcloud run services describe "$BACKEND_SERVICE" --project="$PROJECT" --region="$REGION" >/dev/null 2>&1; then
  log "Wiring ${SECRET_NAME} into Cloud Run service ${BACKEND_SERVICE}"
  gcloud run services update "$BACKEND_SERVICE" \
    --project="$PROJECT" --region="$REGION" \
    --update-secrets "${SECRET_NAME}=${SECRET_NAME}:latest" >/dev/null
  log "Cloud Run env wired — backend will read the corpus on next request"
else
  log "Cloud Run service ${BACKEND_SERVICE} not found in ${REGION} — skipping env wiring."
  log "  When the service exists, run:"
  log "    gcloud run services update ${BACKEND_SERVICE} --project=${PROJECT} --region=${REGION} \\"
  log "      --update-secrets ${SECRET_NAME}=${SECRET_NAME}:latest"
fi

log "Done. Curriculum RAG provisioned for ${ENV}."
log "Verify: gcloud secrets versions access latest --secret=${SECRET_NAME} --project=${PROJECT}"
