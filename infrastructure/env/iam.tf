# Runtime service account + project role bindings.
# Mirrors ensure_sa() in scripts/bootstrap-aipla-dev.sh (14 roles).
resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = var.sa_name
  display_name = "AIPLA v0.1 Cloud Run runtime"

  depends_on = [google_project_service.apis]
}

locals {
  runtime_roles = toset([
    "roles/run.invoker",
    "roles/run.admin", # deploy Cloud Run services (M5)
    "roles/datastore.user",
    "roles/aiplatform.user",
    "roles/secretmanager.secretAccessor",
    "roles/cloudtrace.agent",
    "roles/logging.logWriter",
    "roles/artifactregistry.writer", # push Docker images (M5)
    "roles/iam.serviceAccountUser",  # act as itself when CB deploys Cloud Run as this SA
    "roles/firebaserules.admin",     # deploy firestore.rules
    "roles/firebaseauth.admin",      # 1.1.5: grant-researcher sets a custom claim (set_custom_user_claims); viewer is not enough
    "roles/datastore.indexAdmin",    # deploy firestore.indexes.json
    "roles/bigquery.dataViewer",     # read chat_logs for the teacher report route
    "roles/bigquery.jobUser",        # run query jobs against chat_logs
  ])
}

resource "google_project_iam_member" "runtime" {
  for_each = local.runtime_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Operator impersonation: members who may mint ID tokens AS the runtime SA, for
# the HTTP admin ops (demo-code minting, HTTP seed). Declarative replacement for
# the manual `gcloud ... add-iam-policy-binding tokenCreator` dev got in May.
# Keys are the static member strings from the tfvars → known at plan time.
resource "google_service_account_iam_member" "operator_token_creator" {
  for_each = toset(var.admin_operator_members)

  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value
}

# --- Build-once promotion: cross-project image read (1.3a, runbook step 6) ----
# The promote pipeline's `copy-backend` step runs IN the target project but
# reads the tested backend image OUT of the source project's Artifact Registry
# (`gcloud artifacts docker images describe|copy`). That read is the one
# permission the target's runtime SA does not already hold, so grant it on the
# SOURCE project.
#
# Both promotion paths run as this SA: the trigger sets `service_account`, and
# scripts/promote-env.sh passes `--service-account` explicitly (without it,
# `gcloud builds submit` silently falls back to the Compute Engine default SA
# and the promote 403s from the CLI while working from the console).
#
# Edges mirror promote-env.sh's allow-list: dev->test, test->prod. Applying the
# TARGET env's workspace creates the binding on the SOURCE project, so the
# operator needs projectIamAdmin there too.
locals {
  promote_source_project = {
    test = "aipla-dev-2026"
    prod = "aipla-test-2026"
  }
}

resource "google_project_iam_member" "promote_source_reader" {
  count = contains(keys(local.promote_source_project), var.env) ? 1 : 0

  project = local.promote_source_project[var.env]
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# `gcloud builds submit --service-account=...` (scripts/promote-env.sh) uploads a
# source tarball to the auto-created `<project>_cloudbuild` bucket, and the BUILD
# SA must read it back. The TRIGGER path never needs this — triggers fetch source
# from the repo connection, not GCS — so this gap only appears on the CLI promote,
# which is exactly the path that had gone un-exercised until 2026-07-30.
#
# The bucket is created by Cloud Build on first submit, not by Terraform; we bind
# to it by name. objectViewer is enough: the tarball is uploaded by the OPERATOR's
# credentials, and the SA only reads it.
resource "google_storage_bucket_iam_member" "promote_source_upload_reader" {
  count = contains(keys(local.promote_source_project), var.env) ? 1 : 0

  bucket = "${var.project_id}_cloudbuild"
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.runtime.email}"
}
