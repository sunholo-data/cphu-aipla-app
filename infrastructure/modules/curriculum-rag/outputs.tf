output "aiplatform_api_enabled" {
  description = "Surfaced for audit. The Vertex AI service id, once enabled."
  value       = google_project_service.aiplatform.service
}

output "corpus_name_secret_id" {
  description = "Secret Manager secret id holding the RAG corpus resource name. The backend reads this as env var CURRICULUM_RAG_CORPUS_NAME."
  value       = google_secret_manager_secret.corpus_name.secret_id
}

output "corpus_display_name" {
  description = "Display name the corpus is de-duplicated by. Pass to bootstrap_rag_corpus.py --display-name to find it."
  value       = var.corpus_display_name
}

output "backend_service_account_email" {
  description = "The SA granted aiplatform.user + secretAccessor by this module."
  value       = var.backend_service_account_email
}
