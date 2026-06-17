# API enablement — mirrors ensure_apis() in scripts/bootstrap-aipla-dev.sh.
#
# disable_on_destroy = false everywhere: (a) it's best practice (don't tear down
# an API another resource might use), and (b) it makes the overlap with the
# composed modules harmless — curriculum-rag enables aiplatform, voice enables
# texttospeech/speech, chat-logs enables bigquery. Two resources enabling the
# same API both idempotently enable and neither disables, so no conflict.
locals {
  apis = toset([
    "aiplatform.googleapis.com",
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "firebaserules.googleapis.com",
    "bigquery.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudtrace.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firebase.googleapis.com",
    "serviceusage.googleapis.com",
  ])
}

resource "google_project_service" "apis" {
  for_each = local.apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
