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
# JWT, NOT Firebase identities. Firebase Auth here serves the TEACHER SSO side
# only. Do not conflate.
#
# CORRECTION 2026-08-03: this comment used to add "+ the anonymous-auth toggle
# the frontend SDK bootstrap expects". That is wrong — nothing in the app calls
# `signInAnonymously()`, and dev has served students for months with Firebase
# anonymous sign-in OFF while test/prod have it ON. The toggle below is
# therefore inert; it is kept (harmless, and flipping it off on live envs would
# be change for its own sake) but it is NOT what makes student auth work.
# `scripts/check-auth-config.sh` reports the per-env value as INFO so the
# difference stays visible instead of looking like meaningful drift.

resource "google_firebase_project" "default" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.apis]
}

# Anonymous sign-in. Replaces the Identity Toolkit REST PATCH in the dev script.
# Requires a billing-enabled project (precondition) + identitytoolkit API (apis.tf).
resource "google_identity_platform_config" "default" {
  project = var.project_id

  # WHICH ORIGINS MAY RUN A SIGN-IN FLOW. Firebase rejects any OAuth
  # popup/redirect (and email-link) from an origin not listed here with
  # `auth/unauthorized-domain`.
  #
  # This was NOT Terraform-managed before 2026-08-03, so test and prod were cut
  # with only the two API defaults (`<project>.firebaseapp.com` / `.web.app`) —
  # neither of which is the URL the app is actually served from. dev worked only
  # because the imperative bootstrap added its Cloud Run URL by hand, so the gap
  # was invisible until a real teacher tried to sign in on prod.
  #
  # Derived from `frontend_url` rather than hand-listed, so it cannot drift from
  # the URL the sandbox already pins as ALLOWED_HOST_ORIGINS.
  authorized_domains = compact([
    # localhost is a dev convenience and a small prod risk (a local build could
    # drive a real prod sign-in), so it is deliberately excluded from prod.
    var.env == "prod" ? "" : "localhost",
    "${var.project_id}.firebaseapp.com",
    "${var.project_id}.web.app",
    # https://host/ -> host. Empty before the first deploy assigns a URL
    # (chicken-egg, same as the sandbox vars) — compact() drops it then.
    trimsuffix(replace(var.frontend_url, "https://", ""), "/"),
    # The ku.dk custom domain (loadbalancer.tf). BOTH origins stay authorized:
    # the run.app URL is what every smoke script, the promote pipeline and the
    # deployed-URLs doc still point at, so dropping it to "switch over" would
    # break teacher sign-in on the very path used to verify a release. Empty on
    # dev — compact() drops it.
    var.custom_domain,
  ])

  sign_in {
    anonymous {
      enabled = true
    }
    # Declared as disabled to MATCH what the provider reads back (it populates
    # these default sub-blocks server-side); omitting them causes a cosmetic
    # perma-diff (provider wants to null them every plan). Students use the
    # anonymous-group JWT, not email/phone — these stay off (ADR-001).
    email {
      enabled           = var.email_signin_enabled
      password_required = false
    }
    phone_number {
      enabled            = false
      test_phone_numbers = {}
    }
  }

  # Also declared-to-match (provider populates it server-side); avoids a
  # cosmetic perma-diff. AIPLA is single-tenant.
  multi_tenant {
    allow_tenants = false
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

# ---- Google sign-in provider ------------------------------------------------
# The SECOND half of the 2026-08-03 sign-in outage. `authorized_domains` above
# says *where* a sign-in may run; this says *that Google is an option at all*.
# test and prod had NO idp configs (`defaultSupportedIdpConfigs` empty) while dev
# had `google.com: enabled` — added via the Firebase console during the
# imperative bootstrap and never encoded here. Fixing only the domains would
# still have left Google sign-in dead on both envs.
#
# MANUAL GATE (same class as the Cloud Build GitHub connection): enabling Google
# in the Firebase console AUTO-PROVISIONS a per-project OAuth client, and this
# resource requires that `client_id` + `client_secret`. Terraform cannot mint
# them. So the flow is console-enable → import, not plan → apply:
#
#   1. Firebase console → Authentication → Sign-in method → enable Google
#      (per env; the OAuth client is auto-created).
#   2. terraform import google_identity_platform_default_supported_idp_config.google \
#        projects/<project_id>/defaultSupportedIdpConfigs/google.com
#   3. Put the client secret in `google_idp_client_secret` (a sensitive var —
#      pass via -var or TF_VAR_, NEVER commit it to a .tfvars).
#
# Left commented until step 1 is done in an env: an apply with empty credentials
# would fail, and a half-configured provider is worse than an absent one.
#
# resource "google_identity_platform_default_supported_idp_config" "google" {
#   project       = var.project_id
#   idp_id        = "google.com"
#   enabled       = true
#   client_id     = var.google_idp_client_id
#   client_secret = var.google_idp_client_secret
# }
