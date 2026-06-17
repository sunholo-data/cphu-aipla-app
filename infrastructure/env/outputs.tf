output "runtime_service_account_email" {
  description = "Cloud Run runtime SA — also the value for the _ADMIN_SEED_ALLOWED_SAS substitution."
  value       = google_service_account.runtime.email
}

output "artifact_registry_url" {
  description = "Value for the _ARTIFACT_REGISTRY_REPO_URL_CLIENT substitution."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${var.ar_repo}"
}

output "config_bucket" {
  description = "Value for the _CONFIG_BUCKET substitution."
  value       = "${var.project_id}-config"
}

output "chat_logs_dataset" {
  value = module.chat_logs.dataset_id
}

output "curriculum_rag_secret_id" {
  value = module.curriculum_rag.corpus_name_secret_id
}

output "post_apply_todo" {
  description = "Steps Terraform can't do — run these after apply (see README)."
  value = [
    "backend/scripts/bootstrap_agent_engine.py  → fills AGENT_ENGINE_ID secret (europe-west1)",
    "scripts/provision-curriculum-rag.sh        → creates the RAG corpus + fills CURRICULUM_RAG_CORPUS_NAME (europe-west1), seed CLEARED content only",
    "populate the real DOCPARSE_API_KEY secret value",
    "make seed ENV=<env>                         → platform skill templates → Firestore",
    "mint demo codes",
  ]
}
