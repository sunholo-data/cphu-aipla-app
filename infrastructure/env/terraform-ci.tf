# Terraform CI — the identity and triggers that run infrastructure/env in
# Cloud Build. Pipeline: cloudbuild.terraform.yaml (read it first; it explains
# the plan-always / apply-on-demand split).
#
# BOOTSTRAP IS UNAVOIDABLY LOCAL. The triggers that run Terraform are themselves
# Terraform resources, so the FIRST apply after this lands must come from a
# laptop. Every apply after that can go through `make tf-apply ENV=<env>`.
#
# A SEPARATE IDENTITY FROM THE APP. aipla-v6@ deploys Cloud Run and reads
# secrets at runtime; aipla-terraform@ can rewrite the project's IAM. Merging
# them would mean a compromised tutor container could re-grant itself anything.
# The roles below are enumerated rather than roles/owner so the privilege is
# auditable at handover — the cost is that a genuinely new resource TYPE may
# need a role added here, which shows up as a clean permission error in the
# build log rather than a silent over-grant.

resource "google_service_account" "terraform" {
  project      = var.project_id
  account_id   = "aipla-terraform"
  display_name = "AIPLA infrastructure/env Terraform runner"

  depends_on = [google_project_service.apis]
}

locals {
  # Each role is here because a specific resource in this config needs it.
  terraform_roles = toset([
    "roles/compute.admin",                     # loadbalancer.tf: addresses, NEGs, proxies, certs
    "roles/serviceusage.serviceUsageAdmin",    # apis.tf: google_project_service
    "roles/serviceusage.serviceUsageConsumer", # user_project_override in versions.tf needs services.use
    "roles/resourcemanager.projectIamAdmin",   # iam.tf: google_project_iam_member
    "roles/iam.serviceAccountAdmin",           # iam.tf: creates the runtime SA (and this one)
    "roles/iam.serviceAccountUser",            # setting `service_account` on a trigger requires actAs
    "roles/secretmanager.admin",               # secrets.tf + the curriculum-rag secret shell
    "roles/firebase.admin",                    # firebase.tf: web app, project config
    "roles/firebaseauth.admin",                # firebase.tf: identity platform config + authorized_domains
    "roles/datastore.owner",                   # firestore.tf: database, indexes
    "roles/firebaserules.admin",               # firestore.tf: rules
    "roles/bigquery.admin",                    # modules/chat-logs: dataset
    "roles/logging.configWriter",              # modules/chat-logs: the BigQuery log sink
    "roles/storage.admin",                     # storage.tf: buckets + their IAM
    "roles/artifactregistry.admin",            # artifact_registry.tf
    "roles/cloudbuild.builds.editor",          # cloudbuild.tf: the triggers themselves
  ])
}

resource "google_project_iam_member" "terraform" {
  for_each = local.terraform_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.terraform.email}"
}

# State lives in the central aipla-deploy bucket, outside every env project, so
# this grant crosses a project boundary. objectAdmin (not admin): the runner
# reads/writes state objects and their locks; it has no business reconfiguring
# the bucket.
resource "google_storage_bucket_iam_member" "terraform_state" {
  bucket = "aipla-deploy-tfstate"
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.terraform.email}"
}

# Cloud Build's PRE-BUILD validation calls storage.buckets.get on logsBucket,
# which objectAdmin does not grant — the same trap storage.tf already documents
# for the runtime SA. Without this the build fails before step 1 runs, with an
# error that points at logging rather than at IAM.
resource "google_storage_bucket_iam_member" "terraform_logs" {
  bucket = google_storage_bucket.admin["${var.project_id}-cloudbuild-logs"].name
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.terraform.email}"
}

# Cross-project IAM write, mirroring iam.tf's promote_source_reader: applying
# the TARGET env creates a binding on the SOURCE project, so the runner needs
# projectIamAdmin there. Without it the plan is clean and the apply 403s on a
# project the operator was not thinking about.
resource "google_project_iam_member" "terraform_promote_source_iam_admin" {
  count = contains(keys(local.promote_source_project), var.env) ? 1 : 0

  project = local.promote_source_project[var.env]
  role    = "roles/resourcemanager.projectIamAdmin"
  member  = "serviceAccount:${google_service_account.terraform.email}"
}

# ---- Triggers ---------------------------------------------------------------

locals {
  terraform_ci_substitutions = {
    _ENV          = var.env
    _PROJECT_ID   = var.project_id
    _STATE_BUCKET = "aipla-deploy-tfstate"
  }
}

# PLAN — fires on every push to dev that touches this directory. Read-only by
# construction: the pipeline's apply step no-ops without _CONFIRM. This is the
# drift detector the layer has never had.
resource "google_cloudbuild_trigger" "infra_plan" {
  count = var.env == "dev" ? 0 : 1

  project         = var.project_id
  location        = var.region
  name            = "aipla-${var.env}-infra-plan"
  description     = "terraform fmt/validate/plan for ${var.env} on push to dev. Never applies."
  service_account = "projects/${var.project_id}/serviceAccounts/${google_service_account.terraform.email}"

  # dev is deliberately excluded (count above): envs/dev.tfvars exists only to
  # plan against script-provisioned resources for drift-checking, and the README
  # is explicit that dev must never be applied. A trigger implying otherwise is
  # a footgun aimed at the one env that would silently adopt live resources.

  repository_event_config {
    repository = google_cloudbuildv2_repository.app.id
    push {
      branch = "^dev$"
    }
  }

  included_files = ["infrastructure/env/**"]

  filename      = "infrastructure/env/cloudbuild.terraform.yaml"
  substitutions = local.terraform_ci_substitutions
}

# APPLY — manual only. `source_to_build` + `git_file_source` are what let a
# trigger with no event config resolve a revision (same shape as prod_promote).
#
#   gcloud builds triggers run aipla-<env>-infra-apply \
#     --project=<env project> --region=europe-north1 --branch=dev \
#     --substitutions=_CONFIRM=APPLY
#
# or `make tf-apply ENV=<env>`.
resource "google_cloudbuild_trigger" "infra_apply" {
  count = var.env == "dev" ? 0 : 1

  project         = var.project_id
  location        = var.region
  name            = "aipla-${var.env}-infra-apply"
  description     = "Apply infrastructure/env to ${var.env}. Requires _CONFIRM=APPLY; without it the build plans and stops."
  service_account = "projects/${var.project_id}/serviceAccounts/${google_service_account.terraform.email}"

  source_to_build {
    repository = google_cloudbuildv2_repository.app.id
    ref        = "refs/heads/dev"
    repo_type  = "GITHUB"
  }

  git_file_source {
    path       = "infrastructure/env/cloudbuild.terraform.yaml"
    repository = google_cloudbuildv2_repository.app.id
    revision   = "refs/heads/dev"
    repo_type  = "GITHUB"
  }

  # _CONFIRM is deliberately NOT defaulted to APPLY here. Passing it per run is
  # the confirmation step — a trigger that applies whenever anyone clicks "Run"
  # in the console would be the auto-apply design we chose against.
  substitutions = local.terraform_ci_substitutions
}
