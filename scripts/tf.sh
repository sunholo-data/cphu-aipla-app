#!/usr/bin/env bash
# tf.sh — run terraform against infrastructure/env with the backend prefix and
# the tfvars chosen TOGETHER, from one argument.
#
# WHY THIS EXISTS (2026-08-03): prod was destroyed because `terraform init
# -reconfigure ... prefix=aipla-env/test && terraform apply -var-file=envs/
# test.tfvars` was blocked as one command and then retried as only its SECOND
# half. The apply inherited the PREVIOUS init's prod backend, compared prod
# state against test config, and -auto-approve destroyed 77 resources.
#
# Two independently-specified things (which state, which variables) that must
# agree, with no mechanism forcing them to, is the whole bug. Here they are one
# input: `./scripts/tf.sh prod plan` cannot address test's state, because the
# operator never types a prefix at all.
#
# APPLIES SHOULD NORMALLY GO THROUGH CI — `make tf-apply ENV=<env> GO=1` runs
# the Cloud Build trigger as aipla-terraform@, so no laptop credential is in the
# path. This script exists for the two cases CI cannot cover:
#   * BOOTSTRAP — the CI triggers are themselves Terraform resources, so the
#     first apply in a fresh env has nothing to run it.
#   * RECOVERY — if the triggers are gone (as on prod, 2026-08-03), CI is gone
#     with them.
# Both are exactly when someone is moving fast under pressure, which is why the
# wrapper matters more here than in the routine path.
#
# Usage:
#   ./scripts/tf.sh <dev|test|prod> plan
#   ./scripts/tf.sh <test|prod> apply         # prompts; never -auto-approve
#   ./scripts/tf.sh <dev|test|prod> output [name]
#   ./scripts/tf.sh <test|prod> import <addr> <id>   # e.g. the console-OAuth
#                                                    # GitHub connection (G1)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${REPO_ROOT}/infrastructure/env"
STATE_BUCKET="aipla-deploy-tfstate"

ENV_NAME="${1:-}"
ACTION="${2:-plan}"
shift 2 2>/dev/null || true

case "${ENV_NAME}" in
  dev | test | prod) ;;
  *)
    echo "Usage: $0 <dev|test|prod> <plan|apply|output> [args]" >&2
    exit 2
    ;;
esac

PROJECT="aipla-${ENV_NAME}-2026"
VARFILE="envs/${ENV_NAME}.tfvars"

# dev is plan-only, per infrastructure/env/README.md: its resources were created
# imperatively by bootstrap-aipla-dev.sh, so an apply would adopt (and then
# reshape) live infrastructure the config only approximates.
if [ "${ENV_NAME}" = "dev" ] && [ "${ACTION}" = "apply" ]; then
  echo "REFUSED: dev is plan-only — applying would adopt script-provisioned live resources." >&2
  echo "See infrastructure/env/README.md." >&2
  exit 2
fi

cd "${TF_DIR}"

echo "== terraform ${ACTION} :: env=${ENV_NAME} project=${PROJECT} prefix=aipla-env/${ENV_NAME}"

# -reconfigure every time: the .terraform/ dir may be pointing at ANOTHER env
# from a previous run, and silently reusing it is precisely the failure mode
# this script exists to prevent.
terraform init -input=false -reconfigure \
  -backend-config="bucket=${STATE_BUCKET}" \
  -backend-config="prefix=aipla-env/${ENV_NAME}" >/dev/null

# Belt and braces: prove the state we just initialised actually belongs to this
# env before doing anything with it. terraform_data.env_guard carries the
# env:project identity (see state-guard.tf). On a fresh env it is absent, which
# is fine — there is nothing to destroy yet.
GUARD="$(terraform show -json 2>/dev/null \
  | python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
for r in d.get("values",{}).get("root_module",{}).get("resources",[]):
    if r.get("address")=="terraform_data.env_guard":
        print(r.get("values",{}).get("input",""))' 2>/dev/null || true)"

if [ -n "${GUARD}" ] && [ "${GUARD}" != "${ENV_NAME}:${PROJECT}" ]; then
  echo "REFUSED: state at prefix aipla-env/${ENV_NAME} is stamped '${GUARD}', expected '${ENV_NAME}:${PROJECT}'." >&2
  echo "Do not proceed — this state does not belong to this env." >&2
  exit 3
fi

case "${ACTION}" in
  plan)
    terraform plan -input=false -lock-timeout=5m -var-file="${VARFILE}" "$@"
    ;;
  apply)
    # Deliberately NO -auto-approve. An interactive confirmation is the last
    # thing standing between a wrong var-file and a destroyed environment, and
    # the incident that prompted this script had it switched off.
    terraform apply -input=false -lock-timeout=5m -var-file="${VARFILE}" "$@"
    ;;
  output)
    terraform output "$@"
    ;;
  import)
    # Writes to state, so it gets the same env binding as apply. The canonical
    # use is the 2nd-gen GitHub connection, which is a console-OAuth artifact
    # Terraform cannot create (manual gate G1 — see cloudbuild.tf).
    terraform import -input=false -lock-timeout=5m -var-file="${VARFILE}" "$@"
    ;;
  *)
    echo "Unknown action: ${ACTION} (plan|apply|output|import)" >&2
    exit 2
    ;;
esac
