variable "project_id" {
  type        = string
  description = "GCP project for this environment (aipla-{dev,test,prod}-2026)."
}

variable "env" {
  type        = string
  description = "Environment label: dev | test | prod. Used for resource labels and passed to the provision script."
  validation {
    condition     = contains(["dev", "test", "prod"], var.env)
    error_message = "env must be one of: dev, test, prod."
  }
}

variable "region" {
  type        = string
  description = "Vertex AI region for the RAG corpus. AIPLA pins europe-north1 (Finland) per ADR-005/007."
  default     = "europe-north1"
}

variable "backend_service_account_email" {
  type        = string
  description = "Runtime backend SA that creates the corpus, uploads RagFiles, runs retrieval, and reads the corpus-name secret (aipla-v6@<project>.iam.gserviceaccount.com)."
}

variable "secret_name" {
  type        = string
  description = "Secret Manager secret id holding the corpus resource name. Must match the backend env var the code reads."
  default     = "CURRICULUM_RAG_CORPUS_NAME"
}

variable "corpus_display_name" {
  type        = string
  description = "Display name used to de-duplicate the RagManagedDb corpus across re-runs (bootstrap_rag_corpus.py matches on it)."
  default     = "aipla-curriculum-v1"
}

variable "backend_service_name" {
  type        = string
  description = "Cloud Run backend service the secret is wired into. The provision script skips wiring if the service does not exist yet."
  default     = "aipla-v01-backend"
}

variable "manage_corpus_via_script" {
  type        = bool
  description = <<-EOT
    When true (default), a null_resource runs scripts/provision-curriculum-rag.sh
    on apply to create the RagManagedDb corpus + write the secret version (the
    google provider has no native Vertex RAG corpus resource). Set false to
    manage the corpus out-of-band — Terraform then owns only the API, secret
    container, and IAM. The local-exec needs gcloud + uv available on the
    apply host.
  EOT
  default     = true
}
