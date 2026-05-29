# Chat-log pipeline preconditions — BigQuery sink for group-ID-keyed logs.
#
# Implements SEQUENCE 1.2 (chat-log-pipeline.md) + the BigQuery slice of
# 1.1 §F (aipla-cloud-bootstrap.md). Consolidated into ONE module so the
# dataset, the Log Router sink, and their IAM live together and can be
# applied independently per env — rather than splitting the dataset into
# the 1.1 bootstrap and the sink into 1.2.
#
# ADRs: 001 (group anonymity — no PII beyond group id), 005 (chat log
# storage — researcher-accessible BQ dataset, consent-driven retention),
# 008 (observability — OTel → Cloud Logging → BigQuery, all in-project).
#
# Data flow:
#   backend emitter (Cloud Logging structured entries:
#       aipla_chat_turn / aipla_workbench_event)
#     → this sink (filter) → BigQuery dataset `chat_logs`
#     → teacher report route + 2.5 rubric + researcher saved query/Looker
#
# Usage (per env — see README.md for full tfvars):
#
#   module "chat_logs" {
#     source                        = "../../modules/chat-logs"
#     project_id                    = "aipla-dev-2026"
#     env                           = "dev"
#     backend_service_account_email = "aipla-v6@aipla-dev-2026.iam.gserviceaccount.com"
#     partition_expiration_days     = 30      # dev keeps less; prod per consent form
#   }

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

# The dataset. Region-pinned (ADR-007). default_partition_expiration_ms
# applies to every partitioned table the sink auto-creates, so retention is
# enforced at the dataset level without per-table config.
resource "google_bigquery_dataset" "chat_logs" {
  project    = var.project_id
  dataset_id = var.dataset_id
  location   = var.region

  description = "Group-ID-keyed chat turns + workbench events (ADR-005). Fed by the Cloud Logging sink in this module. No PII beyond the anonymous group id (ADR-001). Stays inside the GCP project edge (Axiom #9)."

  default_partition_expiration_ms = var.partition_expiration_days == null ? null : var.partition_expiration_days * 24 * 60 * 60 * 1000

  # Research data — never auto-drop rows on a terraform destroy.
  delete_contents_on_destroy = false

  labels = {
    env       = var.env
    component = "chat-logs"
    adr       = "005"
  }
}

# Log Router sink: routes the backend's structured chat-turn + workbench
# entries into the dataset. use_partitioned_tables gives date-partitioned
# tables (cleaner + retention via the dataset default) instead of the
# legacy date-sharded YYYYMMDD tables. unique_writer_identity mints a
# dedicated SA we then grant write on the dataset.
resource "google_logging_project_sink" "chat_logs" {
  project     = var.project_id
  name        = var.sink_name
  destination = "bigquery.googleapis.com/projects/${var.project_id}/datasets/${google_bigquery_dataset.chat_logs.dataset_id}"
  filter      = var.log_filter

  unique_writer_identity = true

  bigquery_options {
    use_partitioned_tables = true
  }
}

# Let the sink's writer identity write to the dataset. Without this the
# sink is created but log entries silently never land in BigQuery.
resource "google_bigquery_dataset_iam_member" "sink_writer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.chat_logs.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = google_logging_project_sink.chat_logs.writer_identity
}

# Backend SA reads the tables for the teacher report route + rubric.
resource "google_bigquery_dataset_iam_member" "backend_reader" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.chat_logs.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${var.backend_service_account_email}"
}

# Querying needs project-level jobUser in addition to dataset dataViewer.
# Self-sufficient by default; disable if 1.1's IAM cascade grants it.
resource "google_project_iam_member" "backend_job_user" {
  count   = var.grant_backend_job_user ? 1 : 0
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${var.backend_service_account_email}"
}
