# Buckets. Mirrors ensure_config_bucket() + ensure_runtime_buckets() +
# ensure_research_audio_bucket(). The TTS cache bucket is owned by the voice
# module (see modules.tf), so it is NOT created here.
#
# storage.admin (not just objectAdmin) on config + the 3 runtime buckets:
# Cloud Build's pre-build validation checks storage.buckets.get on the
# logsBucket, which objectAdmin does not grant (bootstrap NOTES). research-audio
# only needs objectAdmin (write recordings + the delete-by-group_id erasure path).
locals {
  admin_buckets = toset([
    "${var.project_id}-config",
    "${var.project_id}-cloudbuild-logs",
    "${var.project_id}-artifacts",
    "${var.project_id}-aipla-v01-logs",
  ])
}

resource "google_storage_bucket" "admin" {
  for_each = local.admin_buckets

  name                        = each.value
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "admin" {
  # Iterate the STATIC set (not google_storage_bucket.admin) so the for_each keys
  # are known at plan time — a resource-map for_each has apply-unknown keys on a
  # fresh project, which breaks `terraform import` (and is the anti-pattern
  # Terraform's own error warns about).
  for_each = local.admin_buckets

  bucket = google_storage_bucket.admin[each.key].name
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_storage_bucket" "research_audio" {
  name                        = "${var.project_id}-research-audio"
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  # No lifecycle auto-expiry: research data persists for the study; erasure is
  # the explicit delete-by-group_id route (bootstrap NOTES). A retention policy
  # is a JB/policy decision to add later.
  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "research_audio" {
  bucket = google_storage_bucket.research_audio.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

# Student + teacher document uploads (the workbench Documents tab and the
# "Dokumentfeedback" activity flow). objectAdmin, not admin: the upload path
# reads and writes objects and never needs buckets.get.
#
# Added 2026-08-25. There was no documents bucket on ANY environment before
# this, and DOCUMENTS_BUCKET was unset everywhere, so the backend fell through
# to a hardcoded "aitana-documents-bucket" belonging to the upstream Aitana
# project. Every document upload in the 2026-08-21 teacher pilot returned 500.
# The name must match the DOCUMENTS_BUCKET value in cloudbuild.yaml AND
# cloudbuild.promote.yaml — prod is reached only by promote.
resource "google_storage_bucket" "documents" {
  name                        = "${var.project_id}-documents"
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  # No lifecycle auto-expiry: a student's uploaded work is part of the activity
  # record for the study, on the same footing as research_audio above. Erasure
  # is the explicit delete route, not a TTL.

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "documents" {
  bucket = google_storage_bucket.documents.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}
