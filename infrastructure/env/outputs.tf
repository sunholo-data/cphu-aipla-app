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

output "firebase_web_app_id" {
  description = "The Firebase Web App id whose SDK config seeds the FIREBASE_ENV secret."
  value       = google_firebase_web_app.default.app_id
}

output "test_release_trigger_id" {
  description = "The aipla-test-release Cloud Build trigger id (empty unless env=test)."
  value       = one(google_cloudbuild_trigger.test_release[*].id)
}

output "custom_domain_dns" {
  description = "The DNS records to send UCPH IT, ready to paste. Both hostnames share the env's IP pair (Host-header split at the LB). Null unless custom_domain is set."
  value = var.custom_domain == "" ? null : {
    domains = compact([var.custom_domain, var.sandbox_custom_domain])
    a       = one(google_compute_global_address.frontend_v4[*].address)
    aaaa    = one(google_compute_global_address.frontend_v6[*].address)
    zone_file = join("\n", flatten([
      for d in compact([var.custom_domain, var.sandbox_custom_domain]) : [
        "${d}. 300 IN A    ${one(google_compute_global_address.frontend_v4[*].address)}",
        "${d}. 300 IN AAAA ${one(google_compute_global_address.frontend_v6[*].address)}",
      ]
    ]))
    # Each cert provisions independently — a missing sandbox DNS record must not
    # hold the frontend hostage. Both must read ACTIVE before flipping
    # mcp_sandbox_url to the ku.dk sandbox origin.
    certificate_status_cmd = join(" && ", [
      for n in compact([
        one(google_compute_managed_ssl_certificate.frontend[*].name),
        one(google_compute_managed_ssl_certificate.sandbox[*].name),
      ]) :
      "gcloud compute ssl-certificates describe ${n} --global --project=${var.project_id} --format='value(name,managed.status)'"
    ])
  }
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
