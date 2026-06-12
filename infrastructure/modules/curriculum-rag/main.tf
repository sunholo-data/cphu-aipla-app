# Curriculum RAG preconditions — Vertex AI API enablement, the
# CURRICULUM_RAG_CORPUS_NAME secret, the backend-SA IAM bindings, and (via a
# script bridge) the RagManagedDb corpus itself.
#
# Implements SEQUENCE 1.1.25 (curriculum-library.md) M2/M5. Consolidated into
# ONE module so the API, secret, IAM, and corpus live together and apply
# independently per env — rather than scattering side effects across the repo.
#
# ADRs: 004 (AILANG Parse — deterministic ingestion), 010 (RAG), 005/007
# (data residency / region — europe-north1).
#
# PROVIDER GAP: the hashicorp/google provider has no native Vertex AI RAG
# corpus resource (as of provider 5/6.x). Terraform owns the durable,
# codifiable pieces — API enablement, the secret container, IAM. The corpus
# itself + the secret VERSION holding its resource name are created by
# `scripts/provision-curriculum-rag.sh` (which wraps the idempotent
# `backend/scripts/bootstrap_rag_corpus.py`). A null_resource invokes that
# script on apply so a single `terraform apply` fully provisions an env. Set
# `manage_corpus_via_script = false` to skip the bridge (e.g. when a future
# provider gains a native resource, or to manage the corpus out-of-band).
#
# What gets created:
#   1. aiplatform.googleapis.com enabled
#   2. roles/aiplatform.user granted to the backend SA (create corpus + upload
#      RagFiles + retrieval_query)
#   3. CURRICULUM_RAG_CORPUS_NAME secret (container) with automatic replication
#   4. roles/secretmanager.secretAccessor granted to the backend SA on that
#      secret (so Cloud Run can read the corpus resource name at runtime)
#   5. (bridge) the RagManagedDb corpus + the secret version holding its
#      resource name, via the provision script
#
# Usage (per env — see README.md):
#
#   module "curriculum_rag" {
#     source                        = "../../modules/curriculum-rag"
#     project_id                    = "aipla-dev-2026"
#     env                           = "dev"
#     backend_service_account_email = "aipla-v6@aipla-dev-2026.iam.gserviceaccount.com"
#   }

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
    null = {
      source  = "hashicorp/null"
      version = ">= 3.0"
    }
  }
}

# 1. Enable Vertex AI API. Idempotent. Ingestion + retrieval return errors
# until enabled; the backend degrades gracefully to metadata-only meanwhile.
resource "google_project_service" "aiplatform" {
  project            = var.project_id
  service            = "aiplatform.googleapis.com"
  disable_on_destroy = false
}

# 2. Backend SA -> roles/aiplatform.user. Project-scoped: lets the SA create
# the corpus, upload RagFiles (ingest), and run retrieval_query. roles/
# aiplatform.user is the documented role for RAG data + retrieval operations.
resource "google_project_iam_member" "backend_aiplatform_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${var.backend_service_account_email}"

  depends_on = [google_project_service.aiplatform]
}

# 3. Secret container for the corpus resource name. The VERSION (the actual
# resource-name string) is written by the provision script bridge below,
# because the resource name isn't known until the corpus is created.
resource "google_secret_manager_secret" "corpus_name" {
  project   = var.project_id
  secret_id = var.secret_name

  replication {
    auto {}
  }

  labels = {
    env       = var.env
    component = "curriculum"
    purpose   = "rag-corpus-name"
    adr       = "010"
  }

  depends_on = [google_project_service.aiplatform]
}

# 4. Backend SA -> secretAccessor on the corpus-name secret ONLY. Scoped to
# this secret (not project-wide) so the SA can read the corpus name at runtime
# without broad Secret Manager access.
resource "google_secret_manager_secret_iam_member" "backend_corpus_name_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.corpus_name.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.backend_service_account_email}"
}

# 5. Corpus-creation bridge. Runs the idempotent provision script to create/
# find the RagManagedDb corpus and write its resource name as a new secret
# version. Re-runs when the project or display name changes; the script itself
# is idempotent so spurious applies are no-ops. Skip with
# manage_corpus_via_script = false.
resource "null_resource" "corpus" {
  count = var.manage_corpus_via_script ? 1 : 0

  triggers = {
    project_id   = var.project_id
    display_name = var.corpus_display_name
    region       = var.region
  }

  provisioner "local-exec" {
    command = "${path.module}/../../../scripts/provision-curriculum-rag.sh ${var.env}"
    environment = {
      GOOGLE_CLOUD_LOCATION          = var.region
      CURRICULUM_RAG_DISPLAY_NAME    = var.corpus_display_name
      CURRICULUM_RAG_BACKEND_SERVICE = var.backend_service_name
    }
  }

  depends_on = [
    google_project_service.aiplatform,
    google_project_iam_member.backend_aiplatform_user,
    google_secret_manager_secret.corpus_name,
    google_secret_manager_secret_iam_member.backend_corpus_name_accessor,
  ]
}
