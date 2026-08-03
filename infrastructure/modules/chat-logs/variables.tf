variable "project_id" {
  type        = string
  description = "GCP project for this environment (aipla-{dev,test,prod}-2026)."
}

variable "env" {
  type        = string
  description = "Environment label: dev | test | prod. Used only for resource labels."
  validation {
    condition     = contains(["dev", "test", "prod"], var.env)
    error_message = "env must be one of: dev, test, prod."
  }
}

variable "region" {
  type        = string
  description = "BigQuery dataset location. AIPLA pins europe-north1 (Finland) per ADR-007."
  default     = "europe-north1"
}

variable "dataset_id" {
  type        = string
  description = "BigQuery dataset id for chat logs (ADR-005)."
  default     = "chat_logs"
}

variable "sink_name" {
  type        = string
  description = "Cloud Logging project sink name that routes chat-turn + workbench-event log entries to BigQuery."
  default     = "aipla-chat-logs"
}

variable "log_filter" {
  type        = string
  description = <<-EOT
    Cloud Logging filter selecting the structured entries the backend
    emits (see chat-log-pipeline.md). Project-agnostic regex on the log
    suffix so the same default works in every env. The backend emitter
    must write under log ids `aipla_chat_turn`, `aipla_workbench_event`,
    `aipla_voice_cost` (1.1.9 voice-cost integration), and
    `aipla_rubric_run` (RUBRIC-2 M3 — rubric run provenance).
  EOT
  default     = "logName=~\"/logs/aipla_(chat_turn|workbench_event|voice_cost|rubric_run)$\""
}

variable "partition_expiration_days" {
  type        = number
  nullable    = true
  description = <<-EOT
    Default partition expiration for every partitioned table the sink
    creates in the dataset (retention, ADR-005). Consent-form-driven —
    set per env via tfvars. null = keep forever (do not set lightly;
    only with explicit DPIA/consent sign-off). Default 365 days.
  EOT
  default     = 365
}

variable "backend_service_account_email" {
  type        = string
  description = "Runtime SA that reads the tables for the teacher report route (aipla-v6@<project>.iam.gserviceaccount.com)."
}

variable "grant_backend_job_user" {
  type        = bool
  description = <<-EOT
    Grant the backend SA project-level roles/bigquery.jobUser so it can
    run query jobs against the dataset. Default true so this module is
    self-sufficient. Set false if the 1.1 IAM cascade grants it centrally
    (avoids a duplicate binding).
  EOT
  default     = true
}

variable "create_views" {
  type        = bool
  description = <<-EOT
    Create the flattened `chat_turns` / `workbench_events` views over the
    sink's raw jsonPayload tables. Keep FALSE for the first apply — the
    base tables only exist after the first log write, and a view over a
    missing table fails to apply. Flip to TRUE on a second apply once data
    is flowing. See README.
  EOT
  default     = false
}

variable "turn_table" {
  type        = string
  description = "Sink-created raw table for chat turns (derived from the log id `aipla_chat_turn`). Only used when create_views = true."
  default     = "aipla_chat_turn"
}

variable "event_table" {
  type        = string
  description = "Sink-created raw table for workbench events (derived from the log id `aipla_workbench_event`). Only used when create_views = true."
  default     = "aipla_workbench_event"
}

# ---- Backup (backup.tf) -----------------------------------------------------

variable "enable_backup" {
  type        = bool
  description = <<-EOT
    Create the daily GCS export of the raw chat-log tables (backup.tf).
    Safe to enable before any data exists: the scheduled query guards each
    EXPORT with an INFORMATION_SCHEMA check, so it no-ops until the sink has
    lazily created the tables. dev leaves this off; test/prod set it true.
  EOT
  default     = false
}

variable "backup_schedule" {
  type        = string
  description = "BigQuery Data Transfer schedule for the export. Times are UTC. Default runs well outside Danish teaching hours."
  default     = "every day 03:00"
}

variable "backup_nearline_after_days" {
  type        = number
  description = "Age at which a backup object moves to NEARLINE. Exports are written once and read only in a restore, so this is nearly pure saving."
  default     = 90
}

variable "backup_keep_noncurrent_versions" {
  type        = number
  description = "How many superseded generations of a given day's export to retain. Versioning protects against a bad re-run overwriting a good export; this caps the tail. Live objects are never lifecycle-deleted."
  default     = 3
}
