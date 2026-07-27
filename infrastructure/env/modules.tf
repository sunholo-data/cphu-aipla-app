# Compose the existing reusable modules. These already encode the
# correct per-env behaviour (chat_logs dataset+sink+IAM; curriculum-rag
# secret-shell + script-managed corpus; voice TTS cache + APIs).
module "chat_logs" {
  source = "../modules/chat-logs"

  project_id                    = var.project_id
  env                           = var.env
  region                        = var.region
  partition_expiration_days     = var.partition_expiration_days
  backend_service_account_email = google_service_account.runtime.email

  depends_on = [google_project_service.apis]
}

module "curriculum_rag" {
  source = "../modules/curriculum-rag"

  project_id                    = var.project_id
  env                           = var.env
  region                        = var.region
  backend_service_account_email = google_service_account.runtime.email

  # The corpus itself (europe-west1) is created by
  # scripts/provision-curriculum-rag.sh POST-APPLY (sprint M3, CLEARED content
  # only — copyright gate), NOT during this apply. manage_corpus_via_script=false
  # so the module makes only the CURRICULUM_RAG_CORPUS_NAME secret shell + the
  # aiplatform API + IAM; it does NOT local-exec the provision script mid-apply
  # (the backend isn't deployed yet, and content-seeding must be controlled).
  manage_corpus_via_script = false

  depends_on = [google_project_service.apis]
}

module "voice" {
  source = "../modules/voice"

  project_id                    = var.project_id
  env                           = var.env
  region                        = var.region
  backend_service_account_email = google_service_account.runtime.email
  # Was never passed → null bucket name → apply-time error (module was only
  # validate'd before, never applied; dev is script-provisioned). Matches the
  # VOICE_TTS_CACHE_BUCKET the backend expects (cloudbuild.yaml).
  tts_cache_bucket = "${var.project_id}-tts-cache"

  depends_on = [google_project_service.apis]
}
