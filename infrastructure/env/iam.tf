# Runtime service account + project role bindings.
# Mirrors ensure_sa() in scripts/bootstrap-aipla-dev.sh (13 roles).
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
