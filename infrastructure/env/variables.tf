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

variable "project_owners" {
  type        = list(string)
  description = <<-EOT
    AUTHORITATIVE list of roles/owner holders. Setting it removes every owner not
    named here — including m@sunholo.com, which is the point (SEQUENCE 1.1.60):
    the everyday shell, and the identity agentic tooling runs as, should not be
    able to delete an environment. That account is separately granted
    viewer + cloudbuild.builds.editor so it can still drive the pipelines.

    MUST retain user:mark.edmondson@ind.ku.dk. These projects have no parent
    organisation, so project-level owner is the only escape hatch — there is no
    org admin to re-grant from, and an empty list is unrecoverable. A
    precondition in iam.tf enforces this.

    Empty (the default) leaves project ownership entirely unmanaged, which is
    the correct posture for dev.
  EOT
  default     = []
}

variable "remove_default_editor" {
  type        = bool
  description = "Strip roles/editor from the project by declaring an AUTHORITATIVE empty binding for that role (iam.tf). Targets the auto-granted <number>-compute@developer editor grant, which AIPLA never uses and which was the single broadest privilege on prod. ONLY set true where the compute default SA is verified to be the sole editor holder — an authoritative binding removes every other holder too. dev off; test/prod on."
  default     = false
}

variable "default_service_accounts_action" {
  type        = string
  description = "What to do with the project's auto-created default service accounts, chiefly <number>-compute@developer (which ships holding roles/EDITOR and which AIPLA never uses). NONE leaves them alone; DEPRIVILEGE strips their roles; DISABLE makes them unable to authenticate (reversible); DELETE removes them (30-day undelete, then permanent). test/prod use DISABLE."
  default     = "NONE"
  validation {
    condition     = contains(["NONE", "DEPRIVILEGE", "DISABLE", "DELETE"], var.default_service_accounts_action)
    error_message = "default_service_accounts_action must be one of: NONE, DEPRIVILEGE, DISABLE, DELETE."
  }
}

variable "enable_chat_logs_backup" {
  type        = bool
  description = "Daily Parquet export of the raw chat-log tables to gs://<project>-chat-logs-backup (modules/chat-logs/backup.tf). Safe to enable before data exists — the scheduled query no-ops until the sink creates the tables. dev off; test/prod on."
  default     = false
}

variable "custom_domain" {
  type        = string
  description = "This env's UCPH custom domain, bare hostname (prod: aipla.ku.dk, test: aipla-test.ku.dk). Empty on dev. Setting it builds the global external ALB (loadbalancer.tf) AND adds the name to Firebase authorized_domains + the sandbox's allowed embedders, so both origins work during the run.app -> ku.dk cutover."
  default     = ""
  validation {
    condition     = var.custom_domain == "" || can(regex("^[a-z0-9.-]+$", var.custom_domain))
    error_message = "custom_domain must be a bare hostname (no scheme, no trailing slash), e.g. aipla.ku.dk."
  }
}

variable "sandbox_custom_domain" {
  type        = string
  description = "This env's UCPH custom domain for the MCP-App sandbox, bare hostname (prod: aipla-sandbox.ku.dk, test: aipla-test-sandbox.ku.dk). Empty on dev. Rides the frontend's load balancer on the same IP, split by Host header — a distinct hostname is a distinct origin, which is what ADR-013 requires. Requires custom_domain. Setting it does NOT repoint the app at the new sandbox origin: that is mcp_sandbox_url, flipped only once the certificate is ACTIVE."
  default     = ""
  validation {
    condition     = var.sandbox_custom_domain == "" || can(regex("^[a-z0-9.-]+$", var.sandbox_custom_domain))
    error_message = "sandbox_custom_domain must be a bare hostname (no scheme, no trailing slash), e.g. aipla-sandbox.ku.dk."
  }
}

variable "mcp_sandbox_url" {
  type        = string
  description = "This env's MCP-App sandbox URL (…/sandbox.html), baked into the frontend bundle as NEXT_PUBLIC_MCP_SANDBOX_URL. Empty until the sandbox service is first deployed — set on a later apply (same chicken-egg as frontend_url)."
  default     = ""
}

variable "preview_feature_flags" {
  type        = bool
  description = "Preview flags: bakes _AUTHORING_COPILOT/_CONCEPT_MAP/_AIPLA_HELP='1' into the frontend bundle on BOTH the deploy and promote paths. true on all three envs as of 2026-08-04 — while nobody is on test/prod, they should mirror dev. Set false per-env to hold a feature back deliberately."
  default     = false
}

variable "email_signin_enabled" {
  type        = bool
  description = "Enable Firebase email/password sign-in. dev/test=true (the test-teacher@example.dk convenience account for curriculum seed + teacher-flow testing); prod=false (teachers use UCPH SSO — ADR-001). Students always use the anonymous-group JWT regardless."
  default     = false
}

variable "admin_operator_members" {
  type        = list(string)
  description = "IAM members (e.g. \"user:m@sunholo.com\") granted serviceAccountTokenCreator on the runtime SA, so an operator can impersonate it to mint ID tokens for the HTTP admin ops (demo-code minting via scripts/seed-demo-codes.sh; HTTP seed). Declarative replacement for the manual gcloud grant dev got in May. Keep minimal — this is human→SA impersonation of a broadly-scoped SA."
  default     = []
}
