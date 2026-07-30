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

# prod: RETIRED rebuild fallback — kept as a resource but DISABLED (2026-07-30).
#
# This was the first-cut path: tag → build + deploy, same as test_release. It did
# its job (prod cut v0.1.1 on 2026-07-28), but leaving it armed meant a `v*` tag
# deployed test and prod SIMULTANEOUSLY — prod shipping code that test had not
# yet been verified on. v0.1.2 went out that way on 2026-07-30, safe only
# because nobody was on prod yet. That stops being acceptable at the 2026-08-14
# pilot start.
#
# Steady state is now COPY-promote (1.3a): `make promote VERSION=<tag>
# FROM=test TO=prod GO=1` runs cloudbuild.promote.yaml, copying the BYTE-IDENTICAL
# backend digest that test was verified on rather than rebuilding it. Kept
# (disabled) rather than deleted so it can be re-enabled as a rebuild fallback if
# a promote ever needs bypassing — flip `disabled` and re-apply.
resource "google_cloudbuild_trigger" "prod_release" {
  count = var.env == "prod" ? 1 : 0

  disabled = true

  project         = var.project_id
  location        = var.region
  name            = "aipla-prod-release"
  description     = "RETIRED (disabled 2026-07-30): tag-build fallback. Steady state is copy-promote — make promote FROM=test TO=prod."
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

# prod: mcp-sandbox release trigger (parity with test_sandbox_release, env=prod).
resource "google_cloudbuild_trigger" "prod_sandbox_release" {
  count = var.env == "prod" ? 1 : 0

  project         = var.project_id
  location        = var.region
  name            = "aipla-prod-sandbox-release"
  description     = "Build + deploy aipla-v01-sandbox on tag push vX.Y.Z (prod)."
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

# Runbook step 6, done 2026-07-30:
#   * cross-project artifactregistry.reader → google_project_iam_member
#     .promote_source_reader in iam.tf (the one perm the promote's copy-backend
#     step lacked).
#   * prod_release disabled above, so a `v*` tag no longer reaches prod.
#   * promote-env.sh now pins --service-account to the runtime SA, so the CLI and
#     trigger paths share one identity and therefore one grant.
#
# NOT done, deliberately: the `aipla-prod-promote` MANUAL trigger the original
# TODO called for. scripts/promote-env.sh submits cloudbuild.promote.yaml
# directly via `gcloud builds submit`, so the promotion works without it — the
# trigger would only add a console button, and a second entry point is a second
# thing to keep in sync. Add it if console-driven promotion is ever wanted.
#
# NOTE the asymmetry: `aipla-prod-sandbox-release` (below) is STILL tag-fired.
# The sandbox is static artefact HTML built deterministically from the tag, with
# no tested-digest to preserve and no promote pipeline covering it, so gating it
# would block sandbox updates behind a pipeline that cannot carry them. A bad
# sandbox deploy degrades sims, not the tutor. Revisit if that risk changes.
