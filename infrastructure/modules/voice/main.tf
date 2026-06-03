# Voice preconditions — Cloud TTS + Cloud STT API enablement, TTS cache
# bucket, and the IAM bindings the backend voice provider needs.
#
# Implements SEQUENCE 1.1.11 (voice-provider-abstraction.md). Consolidated
# into ONE module so APIs, bucket, and IAM live together and can be applied
# independently per env — rather than scattering side effects across the
# repo.
#
# ADRs: 003 (four-tier model selection — voice mirrors LLM tier swap),
# 005 (data residency — providers in europe-north1).
#
# What gets created:
#   1. texttospeech.googleapis.com enabled (no caller-IAM role; project
#      enablement is the gate)
#   2. speech.googleapis.com enabled
#   3. gs://${var.tts_cache_bucket} bucket in europe-north1 with
#      uniform bucket-level access, public-access prevention, and 90d
#      object lifecycle
#   4. roles/speech.client granted to the backend SA (project-scoped) —
#      lets the SA call recognize() against the project's STT API quota
#   5. roles/storage.objectAdmin granted to the backend SA, scoped to
#      the TTS cache bucket only — lets the SA read+write cached audio
#      without bucket admin or project-wide storage privilege
#
# Cloud TTS has no caller-IAM role; an enabled API + valid credentials is
# the gate. STT does have roles/speech.client. Don't grant cloudtts.* —
# that role doesn't exist.
#
# Usage (per env — see README.md for full tfvars):
#
#   module "voice" {
#     source                        = "../../modules/voice"
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
  }
}

# 1. Enable Cloud Text-to-Speech API. Idempotent. The voice backend cannot
# synthesize without this; calls return 403 with a clear "API not enabled"
# message until applied.
resource "google_project_service" "texttospeech" {
  project            = var.project_id
  service            = "texttospeech.googleapis.com"
  disable_on_destroy = false
}

# 2. Enable Cloud Speech-to-Text API. Same idempotent shape.
resource "google_project_service" "speech" {
  project            = var.project_id
  service            = "speech.googleapis.com"
  disable_on_destroy = false
}

# 3. TTS cache bucket. Content-hash-keyed audio blobs from the synthesizer.
# europe-north1 per ADR-005. Uniform bucket-level access + public-access
# prevention because audio is operationally private (cache key is
# sha256(text+config), not PII, but the audio itself is tutor content).
# 90d lifecycle keeps storage bounded; cache misses re-synthesize.
resource "google_storage_bucket" "tts_cache" {
  project                     = var.project_id
  name                        = var.tts_cache_bucket
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = var.tts_cache_lifecycle_days
    }
  }

  labels = {
    env       = var.env
    component = "voice"
    purpose   = "tts-cache"
    adr       = "005"
  }
}

# 4. Backend SA -> Speech client. Project-scoped: STT quota is per-project,
# and the SA needs to call recognize() across whichever skill triggers it.
# No condition — Cloud STT doesn't support resource-level IAM.
resource "google_project_iam_member" "backend_speech_client" {
  project = var.project_id
  role    = "roles/speech.client"
  member  = "serviceAccount:${var.backend_service_account_email}"
}

# 5. Backend SA -> Storage objectAdmin on the TTS cache bucket ONLY. The
# bucket-scoped binding (not project-wide storage.* role) is deliberate:
# the SA cannot list other buckets, cannot create new buckets, only
# read+write within this one.
resource "google_storage_bucket_iam_member" "backend_tts_cache_admin" {
  bucket = google_storage_bucket.tts_cache.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${var.backend_service_account_email}"
}
