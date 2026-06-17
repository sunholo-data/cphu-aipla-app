variable "project_id" {
  type        = string
  description = "Target GCP project, e.g. aipla-test-2026. Must already exist with billing linked (precondition — see README)."
}

variable "env" {
  type        = string
  description = "Environment short name: dev | test | prod. Drives module env tags + branch wiring."
  validation {
    condition     = contains(["dev", "test", "prod"], var.env)
    error_message = "env must be one of: dev, test, prod."
  }
}

variable "region" {
  type        = string
  description = "Compute region. AIPLA pins europe-north1 (Finland, ADR-007). Agent Engine + RAG corpus live in europe-west1 and are handled inside their modules/scripts, NOT here."
  default     = "europe-north1"
}

variable "sa_name" {
  type        = string
  description = "Cloud Run runtime service account id (the part before @). Becomes <sa_name>@<project>.iam.gserviceaccount.com."
  default     = "aipla-v6"
}

variable "ar_repo" {
  type        = string
  description = "Artifact Registry Docker repository id."
  default     = "cphu"
}

variable "partition_expiration_days" {
  type        = number
  description = "BigQuery chat_logs partition TTL. dev=30; test/prod set higher per the consent/DPIA decision (1.13)."
  default     = 365
}

# ---- Used by increment 2 (Firebase + Cloud Build triggers); declared now so
#      the per-env tfvars are complete and stable. ----

variable "cb_connection" {
  type        = string
  description = "Cloud Build 2nd-gen GitHub connection name (precondition: installed + COMPLETE in this project/region)."
  default     = "sunholo-github"
}

variable "github_remote" {
  type        = string
  description = "GitHub remote URI for the Cloud Build repository link."
  default     = "https://github.com/sunholo-data/cphu-aipla-app.git"
}

variable "cb_repo_name" {
  type        = string
  description = "Cloud Build repository resource name (under the connection)."
  default     = "cphu-aipla-app"
}

variable "deploy_branch" {
  type        = string
  description = "Branch this env's deploy trigger fires on (dev|test|prod)."
}

variable "teacher_mock" {
  type        = bool
  description = "dev-only: bakes NEXT_PUBLIC_TEACHER_MOCK=1 into the deploy trigger so /teacher/* renders without Firebase auth. MUST be false on test/prod (they render the sign-in placeholder)."
  default     = false
}

variable "frontend_url" {
  type        = string
  description = "This env's deployed frontend URL, used as the sandbox iframe ALLOWED_HOST_ORIGINS. Empty until the first deploy assigns a *.run.app URL — set on the second apply (chicken-egg, see README)."
  default     = ""
}
