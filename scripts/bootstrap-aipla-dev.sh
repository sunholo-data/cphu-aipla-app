#!/usr/bin/env bash
# Idempotent bootstrap for aipla-dev-2026 — M0 of the JUTLAND-V01 sprint.
#
# Re-runnable. Each step checks current state before mutating, so a second
# invocation should be a no-op. The script is the source of truth for AIPLA's
# dev GCP scratchpad until 1.1-aipla-cloud-bootstrap.md Terraformises it.
#
# Prereqs (manual, one-time, already verified 2026-05-20):
#   - aipla-dev-2026 project exists with billing linked (✓ 01A211-266D3F-D96890)
#   - Firebase added to the project (✓)
#   - Cloud Build GitHub connection 'sunholo-github' in europe-north1, state COMPLETE (✓)
#   - m@sunholo.com is project owner
#
# Deferred (Resolved Decision 1, jutland-demo.md):
#   - Vertex AI Data Residency org-policy. Skipped at user direction
#     (2026-05-20) pending review of impact on other projects in the
#     sunholo.com org. v0.1 demo audience is internal and no PII is
#     collectable (ADR-001), so this is recoverable. Re-evaluate before
#     v1.0.0-pilot.
set -euo pipefail

PROJECT="aipla-dev-2026"
REGION="europe-north1"
FIRESTORE_LOC="europe-north1"      # Finland regional per ADR-007
SA_NAME="aipla-v6"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT:-aipla-dev-2026}" --format='value(projectNumber)' 2>/dev/null || echo '')"
AR_REPO="cphu"
CB_CONNECTION="sunholo-github"
CB_REPO_NAME="cphu-aipla-app"
GH_REMOTE="https://github.com/sunholo-data/cphu-aipla-app.git"
TRIGGER_NAME="aipla-dev-deploy"
SERVICE_NAME="aipla-v01-frontend"

log() { echo "[$(date +%H:%M:%S)] $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

# ----- prerequisite verification ---------------------------------------------

verify_prereqs() {
  log "Verifying preconditions on ${PROJECT}..."

  gcloud projects describe "$PROJECT" --format='value(lifecycleState)' \
    | grep -q ACTIVE \
    || die "Project ${PROJECT} not active"

  gcloud beta billing projects describe "$PROJECT" --format='value(billingEnabled)' \
    | grep -q True \
    || die "Project ${PROJECT} has no active billing account"

  gcloud builds connections describe "$CB_CONNECTION" \
    --region="$REGION" --project="$PROJECT" \
    --format='value(installationState.stage)' 2>/dev/null \
    | grep -q COMPLETE \
    || die "Cloud Build connection '${CB_CONNECTION}' in ${REGION} not COMPLETE. Install the Google Cloud Build GitHub App on sunholo-data org first."

  firebase projects:list 2>&1 | grep -q "$PROJECT" \
    || die "Firebase has not been added to ${PROJECT}. Convert via https://console.firebase.google.com/ first."

  log "  ✓ project active + billed; Cloud Build connection ready; Firebase linked"
}

# ----- API enablement --------------------------------------------------------

ensure_apis() {
  log "Ensuring required APIs..."
  local apis=(
    aiplatform.googleapis.com
    run.googleapis.com
    cloudbuild.googleapis.com
    artifactregistry.googleapis.com
    firestore.googleapis.com
    secretmanager.googleapis.com
    cloudtrace.googleapis.com
    logging.googleapis.com
    monitoring.googleapis.com
    iamcredentials.googleapis.com
    identitytoolkit.googleapis.com
    firebase.googleapis.com
    serviceusage.googleapis.com
  )
  gcloud services enable "${apis[@]}" --project="$PROJECT" >/dev/null
  log "  ✓ ${#apis[@]} APIs enabled/verified"
}

# ----- service account + IAM -------------------------------------------------

ensure_sa() {
  log "Ensuring service account ${SA_EMAIL}..."
  if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" &>/dev/null; then
    gcloud iam service-accounts create "$SA_NAME" \
      --project="$PROJECT" \
      --display-name="AIPLA v0.1 Cloud Run runtime" >/dev/null
    log "  created — waiting for IAM eventual consistency..."
    # Poll until describe succeeds 3 times in a row to dodge the race where
    # add-iam-policy-binding refuses the SA because it doesn't see it yet.
    local stable=0
    for _ in {1..20}; do
      if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" &>/dev/null; then
        stable=$((stable + 1))
        [ "$stable" -ge 3 ] && break
      else
        stable=0
      fi
      sleep 2
    done
    log "  SA visible globally (stable=${stable})"
  else
    log "  already exists"
  fi

  log "  applying role bindings (idempotent, with retry)..."
  local roles=(
    roles/run.invoker
    roles/datastore.user
    roles/aiplatform.user
    roles/secretmanager.secretAccessor
    roles/cloudtrace.agent
    roles/logging.logWriter
  )
  for role in "${roles[@]}"; do
    local attempt
    for attempt in 1 2 3 4 5; do
      if gcloud projects add-iam-policy-binding "$PROJECT" \
          --member="serviceAccount:${SA_EMAIL}" \
          --role="$role" \
          --condition=None \
          --quiet >/dev/null 2>&1; then
        break
      fi
      if [ "$attempt" -eq 5 ]; then
        die "Failed to bind ${role} after 5 attempts"
      fi
      sleep $((attempt * 3))
    done
  done
  log "  ✓ ${#roles[@]} roles bound"
}

# ----- Firestore -------------------------------------------------------------

ensure_firestore() {
  log "Ensuring Firestore Native database in ${FIRESTORE_LOC}..."
  if gcloud firestore databases describe --database='(default)' --project="$PROJECT" &>/dev/null; then
    log "  already exists"
  else
    gcloud firestore databases create \
      --location="$FIRESTORE_LOC" \
      --type=firestore-native \
      --project="$PROJECT" >/dev/null
    log "  ✓ created in ${FIRESTORE_LOC}"
  fi
}

# ----- Artifact Registry -----------------------------------------------------

ensure_artifact_registry() {
  log "Ensuring Artifact Registry '${AR_REPO}' in ${REGION}..."
  if gcloud artifacts repositories describe "$AR_REPO" \
       --location="$REGION" --project="$PROJECT" &>/dev/null; then
    log "  already exists"
  else
    gcloud artifacts repositories create "$AR_REPO" \
      --repository-format=docker \
      --location="$REGION" \
      --project="$PROJECT" \
      --description="AIPLA container images" >/dev/null
    log "  ✓ created"
  fi
}

# ----- Firebase Anonymous Auth (Identity Toolkit REST) -----------------------

ensure_firebase_anonymous_auth() {
  log "Ensuring Firebase Anonymous Auth enabled..."
  local token current
  token=$(gcloud auth print-access-token)
  current=$(curl -sS -X GET \
    "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config" \
    -H "Authorization: Bearer ${token}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('signIn',{}).get('anonymous',{}).get('enabled', False))")
  if [ "$current" = "True" ] || [ "$current" = "true" ]; then
    log "  already enabled"
  else
    curl -sS -X PATCH \
      "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config?updateMask=signIn.anonymous.enabled" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -d '{"signIn":{"anonymous":{"enabled":true}}}' >/dev/null
    log "  ✓ enabled"
  fi
}

# ----- Cloud Build repository link + trigger ---------------------------------

ensure_cb_repository() {
  log "Ensuring Cloud Build repository link..."
  if gcloud builds repositories describe "$CB_REPO_NAME" \
       --connection="$CB_CONNECTION" --region="$REGION" --project="$PROJECT" \
       &>/dev/null; then
    log "  already linked"
  else
    gcloud builds repositories create "$CB_REPO_NAME" \
      --remote-uri="$GH_REMOTE" \
      --connection="$CB_CONNECTION" \
      --region="$REGION" \
      --project="$PROJECT" >/dev/null
    log "  ✓ linked"
  fi
}

ensure_cb_service_agent() {
  # Force-create the Cloud Build service agent
  # (service-{PROJECT_NUMBER}@gcp-sa-cloudbuild.iam.gserviceaccount.com).
  # New (post-2024) GCP projects no longer auto-create the legacy
  # Cloud Build SA, so triggers MUST specify a custom service account
  # AND the Cloud Build service agent must be able to act as it.
  log "Ensuring Cloud Build service agent..."
  gcloud beta services identity create \
    --service=cloudbuild.googleapis.com \
    --project="$PROJECT" >/dev/null 2>&1 || true
  local cb_agent="service-${PROJECT_NUMBER}@gcp-sa-cloudbuild.iam.gserviceaccount.com"

  log "  granting ${cb_agent} actAs on ${SA_EMAIL}..."
  gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
    --member="serviceAccount:${cb_agent}" \
    --role="roles/iam.serviceAccountUser" \
    --project="$PROJECT" \
    --condition=None \
    --quiet >/dev/null
  log "  ✓ act-as binding present"
}

ensure_cb_trigger() {
  log "Ensuring Cloud Build trigger '${TRIGGER_NAME}' on dev branch..."
  local repo_resource="projects/${PROJECT}/locations/${REGION}/connections/${CB_CONNECTION}/repositories/${CB_REPO_NAME}"

  if gcloud builds triggers describe "$TRIGGER_NAME" \
       --region="$REGION" --project="$PROJECT" &>/dev/null; then
    log "  already exists"
    return 0
  fi

  local subs=(
    "_PROJECT_ID=${PROJECT}"
    "_SERVICE_NAME=${SERVICE_NAME}"
    "_REGION=${REGION}"
    "_ARTIFACT_REGISTRY_REPO_URL_CLIENT=${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}"
    "_FIREBASE_BUCKET=${PROJECT}.firebasestorage.app"
    "_CONFIG_BUCKET=${PROJECT}-config"
    "_ADMIN_SEED_ALLOWED_SAS=${SA_EMAIL}"
    "_FIREBASE_TAG=dev"
  )
  local subs_csv
  subs_csv=$(IFS=,; echo "${subs[*]}")

  gcloud beta builds triggers create github \
    --name="$TRIGGER_NAME" \
    --repository="$repo_resource" \
    --branch-pattern='^dev$' \
    --build-config=cloudbuild.yaml \
    --region="$REGION" \
    --project="$PROJECT" \
    --service-account="projects/${PROJECT}/serviceAccounts/${SA_EMAIL}" \
    --substitutions="$subs_csv" >/dev/null
  log "  ✓ created"
}

# ----- config bucket (small, for runtime config / seeded artefacts) ---------

ensure_config_bucket() {
  local bucket="${PROJECT}-config"
  log "Ensuring config bucket gs://${bucket}..."
  if gsutil ls "gs://${bucket}" &>/dev/null; then
    log "  already exists"
  else
    gsutil mb -p "$PROJECT" -l "$REGION" -b on "gs://${bucket}" >/dev/null
    log "  ✓ created in ${REGION}"
  fi
}

ensure_runtime_buckets() {
  # Buckets referenced by cloudbuild.yaml after the M2 inherited-name strip:
  #   - {PROJECT}-cloudbuild-logs   (cloudbuild.yaml logsBucket)
  #   - {PROJECT}-artifacts          (ADK_ARTIFACT_BUCKET env var)
  #   - {PROJECT}-aipla-v01-logs     (LOGS_BUCKET_NAME env var)
  log "Ensuring runtime buckets..."
  for suffix in cloudbuild-logs artifacts aipla-v01-logs; do
    local bucket="${PROJECT}-${suffix}"
    if gsutil ls "gs://${bucket}" &>/dev/null; then
      log "  gs://${bucket} already exists"
    else
      gsutil mb -p "$PROJECT" -l "$REGION" -b on "gs://${bucket}" >/dev/null
      log "  ✓ gs://${bucket} created"
    fi
  done
}

# ----- run all ---------------------------------------------------------------

main() {
  verify_prereqs
  ensure_apis
  ensure_sa
  ensure_firestore
  ensure_artifact_registry
  ensure_firebase_anonymous_auth
  ensure_config_bucket
  ensure_runtime_buckets
  ensure_cb_repository
  ensure_cb_service_agent
  ensure_cb_trigger

  log ""
  log "Bootstrap complete."
  log ""
  log "Next: trigger a Cloud Build manually to smoke the pipeline:"
  log "  gcloud builds triggers run ${TRIGGER_NAME} --branch=dev --region=${REGION} --project=${PROJECT}"
  log "Or push a commit to dev — it will auto-trigger."
}

main "$@"
