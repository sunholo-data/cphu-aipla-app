# State/config mismatch tripwire.
#
# WHY THIS EXISTS (2026-08-03): prod was destroyed by a single wrong command.
# The sequence was:
#
#   terraform init -reconfigure ... -backend-config="prefix=aipla-env/prod"
#   terraform plan  -var-file=envs/prod.tfvars          # fine
#   terraform init ... prefix=aipla-env/test && terraform apply -var-file=envs/test.tfvars
#                                                       # ^ blocked, then RETRIED WITHOUT THE INIT
#   terraform apply -var-file=envs/test.tfvars          # <-- ran against PROD state
#
# Terraform did exactly what it was told: it compared prod's 77 resources in
# state against a config naming aipla-test-2026, concluded everything must go,
# and -auto-approve obliged. The runtime SA, all three Cloud Build triggers,
# every secret, two buckets and the chat_logs dataset were destroyed; the prod
# frontend served 500 until it was rebuilt. Firestore survived only because
# deletion protection is on.
#
# NOTHING in the configuration objected, because nothing tied the state file to
# the variables. That is the hole this closes.
#
# HOW IT WORKS. `input` is derived from the env identity, so a state written for
# one env and a tfvars for another disagree, which forces REPLACEMENT of this
# resource. `prevent_destroy` makes Terraform refuse to produce such a plan at
# all — the run dies with "Instance cannot be destroyed" before a single real
# resource is touched. Replaying the incident above now fails safe.
#
# This is a backstop, not the primary control. The primary control is that env,
# backend prefix and tfvars are chosen TOGETHER by one wrapper and cannot drift
# apart: `make tf-plan/tf-apply ENV=<env>` locally, and the _ENV substitution in
# cloudbuild.terraform.yaml in CI. Applies belong in CI (terraform-ci.tf); the
# only sanctioned local applies are bootstrap and disaster recovery, and both
# are exactly when a tired operator is most likely to paste half a command.
#
# IF YOU EVER LEGITIMATELY NEED TO CHANGE THIS: you don't. A different env is a
# different state file, not a re-pointed one. Hitting this error means the
# command is wrong, not the guard.

resource "terraform_data" "env_guard" {
  input = "${var.env}:${var.project_id}"

  lifecycle {
    prevent_destroy = true
  }
}
