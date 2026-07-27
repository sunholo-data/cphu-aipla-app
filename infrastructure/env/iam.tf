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
