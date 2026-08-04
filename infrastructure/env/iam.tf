# Runtime service account + project role bindings.
# Mirrors ensure_sa() in scripts/bootstrap-aipla-dev.sh (14 roles).
resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = var.sa_name
  display_name = "AIPLA v0.1 Cloud Run runtime"

  depends_on = [google_project_service.apis]
}

locals {
  runtime_roles = toset([
    "roles/run.invoker",
    "roles/run.admin", # deploy Cloud Run services (M5)
    "roles/datastore.user",
    "roles/aiplatform.user",
    "roles/secretmanager.secretAccessor",
    "roles/cloudtrace.agent",
    "roles/logging.logWriter",
    "roles/artifactregistry.writer", # push Docker images (M5)
    "roles/iam.serviceAccountUser",  # act as itself when CB deploys Cloud Run as this SA
    "roles/firebaserules.admin",     # deploy firestore.rules
    "roles/firebaseauth.admin",      # 1.1.5: grant-researcher sets a custom claim (set_custom_user_claims); viewer is not enough
    "roles/datastore.indexAdmin",    # deploy firestore.indexes.json
    "roles/bigquery.dataViewer",     # read chat_logs for the teacher report route
    "roles/bigquery.jobUser",        # run query jobs against chat_logs
  ])
}

resource "google_project_iam_member" "runtime" {
  for_each = local.runtime_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# --- The Compute Engine default service account -------------------------------
#
# Every GCP project is created with `<number>-compute@developer.gserviceaccount.com`
# holding roles/EDITOR — a standing, project-wide write privilege nobody asked
# for and nothing here uses. Found during the 2026-08-03 IAM audit: on prod it
# was the single broadest grant in the project, wider than anything Terraform
# creates.
#
# AIPLA does not use it. Cloud Run services run as aipla-v6@; every Cloud Build
# trigger sets `service_account` explicitly. The one path that ever fell back to
# it was `gcloud builds submit` without --service-account, and promotion stopped
# using `builds submit` on 2026-07-30 (see promote_source_reader above).
#
# DISABLE, not DELETE: identical in effect — a disabled SA cannot authenticate —
# but instantly reversible if something undocumented turns out to depend on it,
# whereas deletion has a 30-day undelete window and then is permanent. If
# nothing breaks through the pilot, escalating to DELETE is a one-word change.
#
# NOTE the ordering consequence: this also applies during prod's recovery apply.
# That is safe — nothing in the recovery path authenticates as this SA.
# WHAT DID NOT WORK, so nobody tries it again: `google_project_default_service_accounts`.
# It is the purpose-built resource for this and it is INERT in these projects.
# Applied with action=DISABLE it reported success and recorded
# `service_accounts = {}` — it enumerated nothing — while the SA stayed enabled
# and kept roles/editor. Adding depends_on and forcing a -replace did not change
# the empty map. A resource that succeeds without acting is worse than one that
# fails: `terraform plan` then reports "No changes" forever and the state
# asserts a hardening the project does not have.
#
# So the privilege is removed directly instead. `google_project_iam_binding` is
# AUTHORITATIVE for the single role it names: an empty members list means "no
# principal holds roles/editor on this project", which strips the auto-granted
# default-SA binding and keeps it stripped — reasserted on every apply rather
# than being a one-off click.
#
# VERIFIED SAFE BEFORE USE (2026-08-03): the compute default SA is the ONLY
# holder of roles/editor on both test and prod, so this removes exactly it. An
# authoritative binding is a loaded gun if that ever stops being true — check
# before adding an env:
#   gcloud projects get-iam-policy <p> --flatten="bindings[].members" \
#     --filter="bindings.role=roles/editor" --format="value(bindings.members)"
#
# Removing the role leaves the SA existing but powerless. Disabling the account
# itself is stronger and is asserted separately by scripts/check-iam-posture.sh,
# because Terraform cannot represent a `developer.gserviceaccount.com` account
# (google_service_account only creates `<project>.iam.gserviceaccount.com`).
resource "google_project_iam_binding" "no_editor" {
  count = var.remove_default_editor ? 1 : 0

  project = var.project_id
  role    = "roles/editor"
  members = []
}

# --- Who may own this project -------------------------------------------------
#
# THE WALL, as opposed to the seatbelts. Everything else added on 2026-08-03 —
# the state guard, scripts/tf.sh, the CI pipeline — makes the destroy-by-typo
# harder to repeat by that route. None of it stops a credential that simply has
# the rights, and m@sunholo.com held roles/owner on all three projects: the
# everyday shell, and the identity agentic tooling runs as.
#
# AUTHORITATIVE for roles/owner. `members` is the complete list of owners, so
# this both removes the everyday account AND keeps break-glass — in one
# declaration that is reasserted on every apply, rather than a console click
# nothing would ever re-check.
#
# BREAK-GLASS IS NOT OPTIONAL HERE. These projects have NO parent organisation
# (`gcloud projects describe` returns no parent), so project-level owner is the
# only escape hatch: there is no org admin to re-grant from. An empty or wrong
# members list is unrecoverable. Verified present on both test and prod before
# writing this, and scripts/check-iam-posture.sh asserts it on every run.
resource "google_project_iam_binding" "owners" {
  count = length(var.project_owners) > 0 ? 1 : 0

  project = var.project_id
  role    = "roles/owner"
  members = var.project_owners

  lifecycle {
    precondition {
      condition     = contains(var.project_owners, "user:mark.edmondson@ind.ku.dk")
      error_message = "project_owners must retain the break-glass owner (user:mark.edmondson@ind.ku.dk). These projects have no parent org, so removing the last owner cannot be undone."
    }
  }
}

# The everyday account keeps exactly what it needs to DRIVE the pipelines it no
# longer has the power to bypass:
#   * viewer            — read any resource, which is most of debugging
#   * builds.editor     — `gcloud builds triggers run`, i.e. make tf-apply and
#                         make promote. roles/viewer alone does NOT grant
#                         cloudbuild.builds.create, so degrading to pure viewer
#                         would take away the CI path along with the danger.
# It does NOT get projectIamAdmin: that is self-escalating, and an everyday
# credential that can re-grant itself owner is not degraded in any real sense.
resource "google_project_iam_member" "operator_baseline" {
  for_each = length(var.project_owners) > 0 ? toset([
    "roles/viewer",
    "roles/cloudbuild.builds.editor",
  ]) : toset([])

  project = var.project_id
  role    = each.value
  member  = "user:m@sunholo.com"
}

resource "google_project_default_service_accounts" "default" {
  count = var.default_service_accounts_action == "NONE" ? 0 : 1

  project = var.project_id
  action  = var.default_service_accounts_action

  # On destroy, put back what we found rather than leaving the project in a
  # state Terraform invented. IGNORE_FAILURE because a destroy is not worth
  # failing over an SA that may itself have been removed by then.
  restore_policy = "REVERT_AND_IGNORE_FAILURE"

  # Without this the resource has NO dependencies, so it runs at the very front
  # of the graph. On prod's 2026-08-03 apply it did exactly that: it was created
  # (and is in state) while the compute default SA stayed ENABLED, because it
  # acted before the APIs it needs to enumerate and modify service accounts were
  # in place. A resource that reports success having done nothing is worse than
  # one that fails, so pin it behind enablement.
  #
  # NOTE: this resource acts only at CREATE time. Because it is already in state
  # having no-opped, a plain re-apply will not retry it — it must be forced:
  #   ./scripts/tf.sh prod apply -replace='google_project_default_service_accounts.default[0]'
  depends_on = [google_project_service.apis]
}

# Operator impersonation: members who may mint ID tokens AS the runtime SA, for
# the HTTP admin ops (demo-code minting, HTTP seed). Declarative replacement for
# the manual `gcloud ... add-iam-policy-binding tokenCreator` dev got in May.
# Keys are the static member strings from the tfvars → known at plan time.
resource "google_service_account_iam_member" "operator_token_creator" {
  for_each = toset(var.admin_operator_members)

  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value
}

# --- Build-once promotion: cross-project image read (1.3a, runbook step 6) ----
# The promote pipeline's `copy-backend` step runs IN the target project but
# reads the tested backend image OUT of the source project's Artifact Registry
# (`gcloud artifacts docker images describe|copy`). That read is the one
# permission the target's runtime SA does not already hold, so grant it on the
# SOURCE project.
#
# Both promotion paths run as this SA: the trigger sets `service_account`, and
# scripts/promote-env.sh passes `--service-account` explicitly (without it,
# `gcloud builds submit` silently falls back to the Compute Engine default SA
# and the promote 403s from the CLI while working from the console).
#
# Edges mirror promote-env.sh's allow-list: dev->test, test->prod. Applying the
# TARGET env's workspace creates the binding on the SOURCE project, so the
# operator needs projectIamAdmin there too.
locals {
  promote_source_project = {
    test = "aipla-dev-2026"
    prod = "aipla-test-2026"
  }
}

resource "google_project_iam_member" "promote_source_reader" {
  count = contains(keys(local.promote_source_project), var.env) ? 1 : 0

  project = local.promote_source_project[var.env]
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# REMOVED 2026-08-03: `google_storage_bucket_iam_member.promote_source_upload_reader`.
#
# It granted the runtime SA read on `<project>_cloudbuild`, the bucket
# `gcloud builds submit` uploads its source tarball to. That was necessary while
# promote-env.sh used `builds submit`; it became dead the same day, when promote
# switched to `gcloud builds triggers run --tag` (source now comes from the repo,
# never from GCS).
#
# Leaving it in place was not merely untidy — it BROKE `terraform apply` on test:
# the bucket is created lazily by Cloud Build on first submit, and test has never
# had one (it deploys by trigger), so the resource 404'd on a bucket that will
# never exist. A grant whose target is created as a side effect of a code path
# you have just deleted is a latent apply failure, not leftover config.
