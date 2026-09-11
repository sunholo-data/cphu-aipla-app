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

  # Daily Parquet export to GCS. Guards research data against the 365-day
  # partition expiry (AIPLA is year one of three), a bad backfill, and the
  # handover project transfer — not just the 2026-08-03 destroy, which a
  # populated dataset would have refused anyway.
  enable_backup = var.enable_chat_logs_backup

  # The flattened `chat_turns` / `workbench_events` views. FALSE until now, in
  # every environment, since the module shipped: the views are declared over the
  # sink-created raw tables, and a view over a table that does not exist yet
  # fails to apply — so the module's own comment says keep it false on the first
  # apply and flip it once data is flowing.
  #
  # Nobody ever flipped it. `backup.tf` records the consequence in passing —
  # "the views do not exist" — and the code silently agreed: summarize_session_bq
  # queries `jsonPayload.<key>` off the RAW table, so nothing read the views and
  # nothing missed them.
  #
  # Turning them on now (2026-09-11) because TUTOR-5 gives researchers a reason
  # to query this dataset by hand, and `jsonPayload.framework_id` is not a thing
  # to ask a researcher to type. Precondition met in all three environments:
  # `aipla_chat_turn` and `aipla_workbench_event` both exist and carry data.
  create_views = true

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
