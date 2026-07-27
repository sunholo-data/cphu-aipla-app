# Cloud Build — increment 2.
# Mirrors ensure_cb_repository(), ensure_cb_service_agent(), ensure_cb_trigger()
# in scripts/bootstrap-aipla-dev.sh, and implements the build-once promotion
# trigger shapes from build-once-artifact-promotion.md (1.3a):
#   test → `aipla-test-release`  (tag push ^v.*$, cloudbuild.yaml)
#   prod → `aipla-prod-promote`  (manual, cloudbuild.promote.yaml)  ← added at the PROD cut, not here
#
# dev's connection + trigger stay script-managed until Phase B (dev import);
# this root is applied to test (now) and prod (later).

# ---- GitHub connection ------------------------------------------------------
# A 2nd-gen GitHub connection is fundamentally a console-OAuth artifact: the
# GitHub App install + authorization cannot be done by Terraform. Pattern
# (verified against provider issue #14162): the operator creates the connection
# in the console (manual gate G1), then we `terraform import` it here and manage
# it with ignore_changes so the console-owned github_config never perma-diffs.
#
#   terraform import google_cloudbuildv2_connection.github \
#     projects/<project>/locations/<region>/connections/<cb_connection>
resource "google_cloudbuildv2_connection" "github" {
  project  = var.project_id
  location = var.region
  name     = var.cb_connection

  github_config {}

  lifecycle {
    ignore_changes = [github_config, annotations]
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloudbuildv2_repository" "app" {
  project           = var.project_id
  location          = var.region
  name              = var.cb_repo_name
  parent_connection = google_cloudbuildv2_connection.github.name
  remote_uri        = var.github_remote
}

# ---- Cloud Build service agent + the auth-gap fix ---------------------------
# Force-materialise the CB service agent (post-2024 projects don't auto-create
# it), so the actAs grant below has a principal to bind.
resource "google_project_service_identity" "cloudbuild" {
  provider = google-beta
  project  = var.project_id
  service  = "cloudbuild.googleapis.com"

  depends_on = [google_project_service.apis]
}

# CB service agent must be able to act as the runtime SA the triggers deploy as.
# (bootstrap-aipla-dev.sh ensure_cb_service_agent — "Side effect 7".)
resource "google_service_account_iam_member" "cb_agent_actas" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_project_service_identity.cloudbuild.member
}

# THE 1.1 AUTH-GAP FIX (hypothesis): the runtime SA must be able to mint ID
# tokens FOR ITSELF, or the deploy-time seed step's `generate-id-token` returns
# empty → 403 on /api/admin/seed-platform-skills. The `test` apply + first deploy
# is the experiment that confirms/refutes this (see sprint M4).
resource "google_service_account_iam_member" "runtime_token_creator_self" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.runtime.email}"
}

# ---- Triggers ---------------------------------------------------------------
# Per-env override substitutions. Only the values that are `terraform_managed`
# or per-env in cloudbuild.yaml are set here; everything else uses the file's
# defaults. `_IMAGE_TAG=$${TAG_NAME}` makes the tag trigger tag images
# immutably by the release tag (build-once, 1.3a). `$${...}` is TF-escaped so
# the literal ${TAG_NAME} reaches Cloud Build.
locals {
  deploy_substitutions = {
    _PROJECT_ID                        = var.project_id
    _REGION                            = var.region
    _ARTIFACT_REGISTRY_REPO_URL_CLIENT = "${var.region}-docker.pkg.dev/${var.project_id}/${var.ar_repo}"
    _CONFIG_BUCKET                     = "${var.project_id}-config"
    _ADMIN_SEED_ALLOWED_SAS            = google_service_account.runtime.email
    _IMAGE_TAG                         = "$${TAG_NAME}"
    _MCP_SANDBOX_URL                   = var.mcp_sandbox_url
    # Preview feature flags: dev='1', test/prod='' until AR/JB's framework lands.
    _AUTHORING_COPILOT = var.preview_feature_flags ? "1" : ""
    _CONCEPT_MAP       = var.preview_feature_flags ? "1" : ""
    _AIPLA_HELP        = var.preview_feature_flags ? "1" : ""
    # NOTE: _TEACHER_MOCK is intentionally omitted (dev-only; test/prod render
    # the real sign-in). _FIREBASE_TAG uses the cloudbuild.yaml default ("dev").
  }
}

# test: build-once release trigger — fires on an annotated version tag.
resource "google_cloudbuild_trigger" "test_release" {
  count = var.env == "test" ? 1 : 0

  project         = var.project_id
  location        = var.region
  name            = "aipla-test-release"
  description     = "Build-once release: tag push vX.Y.Z → build + deploy test (CI-gated). 1.3a."
  service_account = "projects/${var.project_id}/serviceAccounts/${google_service_account.runtime.email}"

  repository_event_config {
    repository = google_cloudbuildv2_repository.app.id
    push {
      tag = "^v.*$"
    }
  }

  filename      = "cloudbuild.yaml"
  substitutions = local.deploy_substitutions
}

# test: mcp-sandbox release trigger — deploys the aipla-v01-sandbox service
# (static MCP-App artefact host, separate origin per ADR-013) on the same version
# tags as the main service. _ALLOWED_HOST_ORIGINS pins the frontend that may embed
# the iframe (var.frontend_url — set after the first frontend deploy).
resource "google_cloudbuild_trigger" "test_sandbox_release" {
  count = var.env == "test" ? 1 : 0

  project         = var.project_id
  location        = var.region
  name            = "aipla-test-sandbox-release"
  description     = "Build + deploy aipla-v01-sandbox on tag push vX.Y.Z (test)."
  service_account = "projects/${var.project_id}/serviceAccounts/${google_service_account.runtime.email}"

  repository_event_config {
    repository = google_cloudbuildv2_repository.app.id
    push {
      tag = "^v.*$"
    }
  }

  filename = "infrastructure/mcp-sandbox/cloudbuild.yaml"
  substitutions = {
    _PROJECT_ID                        = var.project_id
    _SERVICE_NAME                      = "aipla-v01-sandbox"
    _REGION                            = var.region
    _ARTIFACT_REGISTRY_REPO_URL_CLIENT = "${var.region}-docker.pkg.dev/${var.project_id}/${var.ar_repo}"
    _LOGS_BUCKET                       = "gs://${var.project_id}-aipla-v01-logs"
    _ALLOWED_HOST_ORIGINS              = var.frontend_url
    _IMAGE_TAG                         = "$${TAG_NAME}"
  }
}

# TODO (PROD cut): `aipla-prod-promote` manual trigger on cloudbuild.promote.yaml
# + the cross-project artifactregistry.reader grant (1.3a §Security), and a
# prod sandbox trigger — see docs/ops/runbooks/prod-cut.md steps 6 + 10.
