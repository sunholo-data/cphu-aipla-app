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
    firebaserules.googleapis.com              # M5: Cloud Build deploys firestore.rules
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
    roles/run.admin                           # deploy Cloud Run services (M5)
    roles/datastore.user
    roles/aiplatform.user
    roles/secretmanager.secretAccessor
    roles/cloudtrace.agent
    roles/logging.logWriter
    roles/artifactregistry.writer             # push Docker images (M5)
    roles/iam.serviceAccountUser              # act as itself when Cloud Build deploys Cloud Run with same SA
    roles/firebaserules.admin                 # M5: deploy firestore.rules
    roles/datastore.indexAdmin                # M5: deploy firestore.indexes.json
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

ensure_firebase_web_app_and_secret() {
  # The Cloud Build step `get-firebase-config` reads a FIREBASE_ENV
  # secret containing NEXT_PUBLIC_FIREBASE_* lines, then bakes them
  # into the Next.js bundle at build time. Without this secret, the
  # frontend Docker build fails on undefined env vars.
  #
  # 1. Create a Firebase Web App (idempotent — skip if one already exists)
  # 2. Pull its config via firebase apps:sdkconfig
  # 3. Translate JSON → env-file format and store as FIREBASE_ENV secret
  log "Ensuring Firebase Web App + FIREBASE_ENV secret..."

  local app_id
  app_id=$(firebase apps:list web --project="$PROJECT" --json 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); apps=d.get('result',[]); print(apps[0]['appId'] if apps else '')" 2>/dev/null \
    || echo "")

  if [ -z "$app_id" ]; then
    log "  creating Firebase Web App..."
    app_id=$(firebase apps:create web "aipla-dev" --project="$PROJECT" --json 2>/dev/null \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result',{}).get('appId',''))")
    if [ -z "$app_id" ]; then die "failed to create Firebase Web App"; fi
    log "  ✓ Firebase Web App created: ${app_id}"
  else
    log "  Firebase Web App already exists: ${app_id}"
  fi

  # Pull config and translate to env-file. Pipe JSON via stdin so we
  # dodge any control chars / quoting issues from heredoc interpolation.
  local env_content
  env_content=$(firebase apps:sdkconfig web "$app_id" --project="$PROJECT" --json 2>/dev/null \
    | python3 -c "
import json, sys
d = json.load(sys.stdin)
cfg = d['result']['sdkConfig']
print(f'NEXT_PUBLIC_FIREBASE_API_KEY={cfg[\"apiKey\"]}')
print(f'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN={cfg[\"authDomain\"]}')
print(f'NEXT_PUBLIC_FIREBASE_PROJECT_ID={cfg[\"projectId\"]}')
print(f'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET={cfg[\"storageBucket\"]}')
print(f'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID={cfg[\"messagingSenderId\"]}')
print(f'NEXT_PUBLIC_FIREBASE_APP_ID={cfg[\"appId\"]}')
print('NEXT_PUBLIC_AUTH_MODE=anonymous_group_id')
")
  if [ -z "$env_content" ]; then die "failed to translate Firebase Web App config"; fi

  # Idempotent secret creation/update
  if gcloud secrets describe FIREBASE_ENV --project="$PROJECT" &>/dev/null; then
    log "  FIREBASE_ENV secret exists — adding new version"
    printf '%s' "$env_content" | gcloud secrets versions add FIREBASE_ENV \
      --data-file=- --project="$PROJECT" >/dev/null
  else
    log "  creating FIREBASE_ENV secret"
    printf '%s' "$env_content" | gcloud secrets create FIREBASE_ENV \
      --data-file=- --project="$PROJECT" \
      --replication-policy=automatic >/dev/null
  fi
  log "  ✓ FIREBASE_ENV secret seeded with ${app_id}"
}

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
  local sa_resource="projects/${PROJECT}/serviceAccounts/${SA_EMAIL}"

  # Idempotent via `gcloud builds triggers import` — does an upsert
  # keyed off trigger `name`, so a re-run with a modified substitution
  # set updates the live trigger in place (the trigger id stays the
  # same). The previous "describe → early-return if exists" pattern
  # broke idempotency: substitution changes on a re-run were silently
  # skipped. Discovered 2026-05-25 when adding `_TEACHER_MOCK=1` for
  # the 1.G-Ph2 deploy — see NOTES.md Decision 11.
  #
  # `gcloud builds triggers update github` does NOT work on 2nd-gen
  # `repositoryEventConfig` triggers (returns 400 INVALID_ARGUMENT
  # against the connection-based repo resource); `import` is the
  # supported path for both create and update.
  local trigger_yaml
  trigger_yaml=$(mktemp -t aipla-trigger.XXXXXX.yaml)
  trap "rm -f '$trigger_yaml'" RETURN

  cat > "$trigger_yaml" <<EOF
name: ${TRIGGER_NAME}
filename: cloudbuild.yaml
repositoryEventConfig:
  push:
    branch: ^dev\$
  repository: ${repo_resource}
  repositoryType: GITHUB
serviceAccount: ${sa_resource}
substitutions:
  _PROJECT_ID: ${PROJECT}
  _SERVICE_NAME: ${SERVICE_NAME}
  _REGION: ${REGION}
  _ARTIFACT_REGISTRY_REPO_URL_CLIENT: ${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}
  _FIREBASE_BUCKET: ${PROJECT}.firebasestorage.app
  _CONFIG_BUCKET: ${PROJECT}-config
  _ADMIN_SEED_ALLOWED_SAS: ${SA_EMAIL}
  _FIREBASE_TAG: dev
  # 1.G-Ph2 — teacher UI mockup bypass. Bakes
  # NEXT_PUBLIC_TEACHER_MOCK=1 into the dev frontend image so the
  # deployed /teacher/* routes render without Firebase teacher auth
  # (which doesn't land until Phase 3). REMOVE this entry when Phase 3
  # ships the real auth path. test/prod Terraform must NOT carry this
  # substitution — production should render the "sign-in required"
  # placeholder instead.
  _TEACHER_MOCK: "1"
EOF

  gcloud builds triggers import \
    --source="$trigger_yaml" \
    --region="$REGION" \
    --project="$PROJECT" >/dev/null
  log "  ✓ imported (idempotent upsert)"
}

# ----- mcp-sandbox trigger (separate Cloud Run, separate origin) ------------

ensure_mcp_sandbox_trigger() {
  local trigger_name="aipla-mcp-sandbox-deploy"
  local sandbox_service="aipla-v01-sandbox"
  log "Ensuring Cloud Build trigger '${trigger_name}' for infrastructure/mcp-sandbox..."
  local repo_resource="projects/${PROJECT}/locations/${REGION}/connections/${CB_CONNECTION}/repositories/${CB_REPO_NAME}"

  if gcloud builds triggers describe "$trigger_name" \
       --region="$REGION" --project="$PROJECT" &>/dev/null; then
    log "  already exists"
    return 0
  fi

  # ALLOWED_HOST_ORIGINS pins the frontend that can embed this sandbox
  # iframe. Per-env (dev/test/prod) — trigger config holds the dev URL.
  local frontend_url="https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app"

  local subs=(
    "_PROJECT_ID=${PROJECT}"
    "_SERVICE_NAME=${sandbox_service}"
    "_REGION=${REGION}"
    "_ARTIFACT_REGISTRY_REPO_URL_CLIENT=${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}"
    "_LOGS_BUCKET=gs://${PROJECT}-aipla-v01-logs"
    "_ALLOWED_HOST_ORIGINS=${frontend_url}"
  )
  local subs_csv
  subs_csv=$(IFS=,; echo "${subs[*]}")

  gcloud builds triggers create github \
    --name="$trigger_name" \
    --repository="$repo_resource" \
    --branch-pattern='^dev$' \
    --included-files='infrastructure/mcp-sandbox/**' \
    --build-config=infrastructure/mcp-sandbox/cloudbuild.yaml \
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
  # Cloud Run's gcsfuse mount needs storage.objects.list at startup.
  # objectAdmin/storage.admin both grant it; we use admin for parity
  # with the other runtime buckets.
  gcloud storage buckets add-iam-policy-binding "gs://${bucket}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/storage.admin" \
    --project="$PROJECT" \
    --quiet >/dev/null
}

ensure_group_auth_signing_secret() {
  # The group_id_auth module fails loud at first create/join/verify if
  # GROUP_AUTH_SIGNING_SECRET is unset, and the cloudbuild.yaml deploy
  # step --set-secrets references this Secret Manager entry by name.
  # Idempotent: skip if already exists.
  log "Ensuring GROUP_AUTH_SIGNING_SECRET..."
  if gcloud secrets describe GROUP_AUTH_SIGNING_SECRET --project="$PROJECT" &>/dev/null; then
    log "  already exists"
  else
    local secret_value
    secret_value=$(openssl rand -hex 32)
    printf '%s' "$secret_value" | gcloud secrets create GROUP_AUTH_SIGNING_SECRET \
      --data-file=- \
      --replication-policy=automatic \
      --project="$PROJECT" >/dev/null
    log "  ✓ created (32-byte hex)"
  fi
  # Grant aipla-v6@ accessor on the secret (idempotent).
  gcloud secrets add-iam-policy-binding GROUP_AUTH_SIGNING_SECRET \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT" \
    --quiet >/dev/null
}

ensure_runtime_buckets() {
  # Buckets referenced by cloudbuild.yaml after the M2 inherited-name strip:
  #   - {PROJECT}-cloudbuild-logs   (cloudbuild.yaml logsBucket)
  #   - {PROJECT}-artifacts          (ADK_ARTIFACT_BUCKET env var)
  #   - {PROJECT}-aipla-v01-logs     (LOGS_BUCKET_NAME env var)
  # All buckets are created with uniform bucket-level access (-b on) and
  # then granted roles/storage.objectAdmin to the runtime SA so Cloud Build
  # and Cloud Run can read/write objects without per-object ACL ceremony.
  log "Ensuring runtime buckets..."
  for suffix in cloudbuild-logs artifacts aipla-v01-logs; do
    local bucket="${PROJECT}-${suffix}"
    if gsutil ls "gs://${bucket}" &>/dev/null; then
      log "  gs://${bucket} already exists"
    else
      gsutil mb -p "$PROJECT" -l "$REGION" -b on "gs://${bucket}" >/dev/null
      log "  ✓ gs://${bucket} created"
    fi
    # Idempotent bucket-level IAM grant. roles/storage.admin (not just
    # objectAdmin) is required because Cloud Build's upfront pre-build
    # validation checks storage.buckets.get on the logsBucket, which
    # objectAdmin doesn't grant. Same role on all three buckets for
    # consistency — they're all in-project runtime buckets.
    gcloud storage buckets add-iam-policy-binding "gs://${bucket}" \
      --member="serviceAccount:${SA_EMAIL}" \
      --role="roles/storage.admin" \
      --project="$PROJECT" \
      --quiet >/dev/null
  done
  log "  ✓ aipla-v6@ has roles/storage.admin on all 3 runtime buckets"
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
  ensure_firebase_web_app_and_secret
  ensure_group_auth_signing_secret
  ensure_cb_repository
  ensure_cb_service_agent
  ensure_cb_trigger
  ensure_mcp_sandbox_trigger

  log ""
  log "Bootstrap complete."
  log ""
  log "Next: trigger a Cloud Build manually to smoke the pipeline:"
  log "  gcloud builds triggers run ${TRIGGER_NAME} --branch=dev --region=${REGION} --project=${PROJECT}"
  log "Or push a commit to dev — it will auto-trigger."
}

main "$@"
