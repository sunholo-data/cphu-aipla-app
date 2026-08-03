# Daily export of the raw chat-log tables to GCS.
#
# WHY (2026-08-03): the chat_logs dataset was destroyed by a mistyped
# `terraform apply` and there was nothing to restore from. It happened to be
# empty, so nothing was lost — and `delete_contents_on_destroy = false` (main.tf)
# means a POPULATED dataset would have refused to be destroyed at all. So this
# is not primarily a guard against that incident repeating.
#
# It earns its place against the slower losses, which have no such protection:
#
#   * `default_partition_expiration_ms` drops partitions after
#     partition_expiration_days (365 on test/prod). AIPLA is year one of a
#     THREE-year research programme. Without an export, the pilot's own data
#     silently ages out during the programme that exists to study it.
#   * A dropped table, a bad backfill, or a wrong `DELETE` inside the dataset —
#     none of which delete_contents_on_destroy protects against.
#   * Project-level loss at handover, when ownership moves to UCPH.
#
# Parquet, not CSV: preserves types and nested structure, so a restore is a
# straight `LOAD DATA` rather than a schema-guessing exercise.
#
# The export reads the RAW sink tables rather than the flattened views, because
# create_views defaults to false and is not set in any env — the views do not
# exist. Backing up the raw shape is also the more conservative choice: the
# views are derived and can be rebuilt from it, not vice versa.

resource "google_storage_bucket" "backup" {
  count = var.enable_backup ? 1 : 0

  name                        = "${var.project_id}-chat-logs-backup"
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true

  # Research data. A backup bucket that terraform can empty on destroy is not a
  # backup — this is the resource most deserving of the flag in the repo.
  force_destroy = false

  # Object versioning: an overwrite of a day's export (a re-run, a mistake)
  # leaves the previous generation recoverable, exactly as it did for the
  # tfstate that made the 2026-08-03 recovery possible at all.
  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = var.backup_nearline_after_days
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  # Cap the versioning tail so a daily overwrite does not accumulate forever.
  # Only NONCURRENT generations — live objects are never deleted by lifecycle.
  lifecycle_rule {
    condition {
      num_newer_versions = var.backup_keep_noncurrent_versions
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    env       = var.env
    component = "chat-logs-backup"
    adr       = "005"
  }
}

resource "google_storage_bucket_iam_member" "backup_writer" {
  count = var.enable_backup ? 1 : 0

  bucket = google_storage_bucket.backup[0].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${var.backend_service_account_email}"
}

# The scheduled query runs as the backend SA, which already holds
# bigquery.dataViewer on this dataset and bigquery.jobUser on the project
# (main.tf) — so the only new grant it needs is the bucket write above.
#
# THE `IF EXISTS` GUARD IS LOAD-BEARING. The sink creates the raw tables lazily,
# on the first matching log write, so in a freshly-cut env they do not exist and
# a bare EXPORT DATA would fail every day until traffic arrives. Scripting the
# existence check makes the schedule a no-op until there is something to back
# up, rather than a daily alarm everyone learns to ignore.
resource "google_bigquery_data_transfer_config" "backup" {
  count = var.enable_backup ? 1 : 0

  project              = var.project_id
  location             = var.region
  display_name         = "chat-logs-daily-backup"
  data_source_id       = "scheduled_query"
  schedule             = var.backup_schedule
  service_account_name = var.backend_service_account_email

  params = {
    query = <<-SQL
      -- Daily export of the raw chat-log tables to GCS (Parquet).
      -- Guarded: the sink creates these tables lazily, so a fresh env has none.
      DECLARE run_date STRING DEFAULT FORMAT_DATE('%Y%m%d', CURRENT_DATE());

      IF EXISTS (
        SELECT 1 FROM `${var.project_id}.${var.dataset_id}.INFORMATION_SCHEMA.TABLES`
        WHERE table_name = '${var.turn_table}'
      ) THEN
        EXPORT DATA OPTIONS(
          uri = CONCAT('gs://${var.project_id}-chat-logs-backup/', run_date, '/${var.turn_table}-*.parquet'),
          format = 'PARQUET',
          compression = 'SNAPPY',
          overwrite = true
        ) AS SELECT * FROM `${var.project_id}.${var.dataset_id}.${var.turn_table}`;
      END IF;

      IF EXISTS (
        SELECT 1 FROM `${var.project_id}.${var.dataset_id}.INFORMATION_SCHEMA.TABLES`
        WHERE table_name = '${var.event_table}'
      ) THEN
        EXPORT DATA OPTIONS(
          uri = CONCAT('gs://${var.project_id}-chat-logs-backup/', run_date, '/${var.event_table}-*.parquet'),
          format = 'PARQUET',
          compression = 'SNAPPY',
          overwrite = true
        ) AS SELECT * FROM `${var.project_id}.${var.dataset_id}.${var.event_table}`;
      END IF;
    SQL
  }

  depends_on = [google_storage_bucket_iam_member.backup_writer]
}
