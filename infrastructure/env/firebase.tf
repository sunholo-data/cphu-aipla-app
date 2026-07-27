# Firebase — increment 2 (google-beta).
# Mirrors ensure_firebase_anonymous_auth() + ensure_firebase_web_app_and_secret()
# in scripts/bootstrap-aipla-dev.sh.
#
# Three things the dev script does imperatively, made declarative here:
#   1. add Firebase to the GCP project        (google_firebase_project)
#   2. enable ANONYMOUS sign-in                (google_identity_platform_config)
#   3. create a Web App + seed FIREBASE_ENV    (google_firebase_web_app + secret)
#
# NOTE the student identity model (ADR-001): students use an anonymous GROUP
# JWT, NOT Firebase identities. Firebase Auth here serves the TEACHER SSO side +
# the anonymous-auth toggle the frontend SDK bootstrap expects. Do not conflate.

resource "google_firebase_project" "default" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.apis]
}

# Anonymous sign-in. Replaces the Identity Toolkit REST PATCH in the dev script.
# Requires a billing-enabled project (precondition) + identitytoolkit API (apis.tf).
resource "google_identity_platform_config" "default" {
  project = var.project_id

  sign_in {
    anonymous {
      enabled = true
    }
  }

  depends_on = [
    google_project_service.apis,
    google_firebase_project.default,
  ]
}

# Web App — created only to harvest the SDK config that the Cloud Build
# `get-firebase-config` step bakes into the Next.js bundle (NEXT_PUBLIC_FIREBASE_*).
resource "google_firebase_web_app" "default" {
  provider     = google-beta
  project      = var.project_id
  display_name = "aipla-${var.env}"

  depends_on = [google_firebase_project.default]
}

data "google_firebase_web_app_config" "default" {
  provider   = google-beta
  web_app_id = google_firebase_web_app.default.app_id
}

# FIREBASE_ENV secret — the Cloud Build `get-firebase-config` step reads this as
# an ENV-FILE (newline KEY=VALUE), NOT JSON. Format MUST match the dev script's
# translation (bootstrap-aipla-dev.sh ensure_firebase_web_app_and_secret), or the
# frontend Docker build fails on undefined NEXT_PUBLIC_* vars.
resource "google_secret_manager_secret" "firebase_env" {
  project   = var.project_id
  secret_id = "FIREBASE_ENV"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "firebase_env" {
  secret = google_secret_manager_secret.firebase_env.id
  secret_data = join("\n", [
    "NEXT_PUBLIC_FIREBASE_API_KEY=${data.google_firebase_web_app_config.default.api_key}",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${data.google_firebase_web_app_config.default.auth_domain}",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID=${var.project_id}",
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${data.google_firebase_web_app_config.default.storage_bucket}",
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${data.google_firebase_web_app_config.default.messaging_sender_id}",
    "NEXT_PUBLIC_FIREBASE_APP_ID=${google_firebase_web_app.default.app_id}",
    "NEXT_PUBLIC_AUTH_MODE=anonymous_group_id",
  ])
}

# Belt-and-braces per-secret accessor for the runtime SA (redundant with the
# project-level secretmanager.secretAccessor in iam.tf; kept explicit for the
# same auditability reason as secrets.tf). The build reads FIREBASE_ENV as this
# SA (the trigger's service_account).
resource "google_secret_manager_secret_iam_member" "firebase_env_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.firebase_env.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
