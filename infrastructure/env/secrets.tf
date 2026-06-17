# Secrets. Mirrors ensure_group_auth_signing_secret(), ensure_docparse_api_key_secret(),
# and the secret-shell half of ensure_agent_engine().
#
# CURRICULUM_RAG_CORPUS_NAME + FIREBASE_ENV are NOT here:
#   - CURRICULUM_RAG_CORPUS_NAME → owned by the curriculum-rag module (modules.tf).
#   - FIREBASE_ENV → increment 2 (firebase.tf), derived from the Web App config.

# GROUP_AUTH_SIGNING_SECRET — 32-byte hex, value fully TF-managed (random).
resource "random_id" "group_auth" {
  byte_length = 32
}

resource "google_secret_manager_secret" "group_auth" {
  project   = var.project_id
  secret_id = "GROUP_AUTH_SIGNING_SECRET"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "group_auth" {
  secret      = google_secret_manager_secret.group_auth.id
  secret_data = random_id.group_auth.hex
}

# DOCPARSE_API_KEY — external key. TF creates the secret + a placeholder version;
# the operator populates the real value out-of-band. ignore_changes so a manual
# `secrets versions add` is never reverted by a later apply.
resource "google_secret_manager_secret" "docparse" {
  project   = var.project_id
  secret_id = "DOCPARSE_API_KEY"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "docparse" {
  secret      = google_secret_manager_secret.docparse.id
  secret_data = "REPLACE_ME_WITH_DOCPARSE_API_KEY"

  lifecycle {
    ignore_changes = [secret_data]
  }
}

# AGENT_ENGINE_ID — secret SHELL only. The numeric id can't be minted by
# Terraform (no reasoning-engines resource); backend/scripts/bootstrap_agent_engine.py
# creates the engine and adds the secret version post-apply. No version here.
resource "google_secret_manager_secret" "agent_engine_id" {
  project   = var.project_id
  secret_id = "AGENT_ENGINE_ID"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

# Explicit per-secret accessor grants for the runtime SA. Redundant with the
# project-level secretmanager.secretAccessor in iam.tf, but kept explicit to
# match the dev script's auditability pattern (reading the config shows exactly
# which SA touches which secret).
locals {
  sa_secret_ids = {
    group_auth      = google_secret_manager_secret.group_auth.secret_id
    docparse        = google_secret_manager_secret.docparse.secret_id
    agent_engine_id = google_secret_manager_secret.agent_engine_id.secret_id
  }
}

resource "google_secret_manager_secret_iam_member" "sa_accessor" {
  for_each = local.sa_secret_ids

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
