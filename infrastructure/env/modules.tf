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
  # scripts/provision-curriculum-rag.sh post-apply; the module manages the
  # CURRICULUM_RAG_CORPUS_NAME secret shell + aiplatform API.
  depends_on = [google_project_service.apis]
}

module "voice" {
  source = "../modules/voice"

  project_id                    = var.project_id
  env                           = var.env
  region                        = var.region
  backend_service_account_email = google_service_account.runtime.email

  depends_on = [google_project_service.apis]
}
