#!/usr/bin/env bash
# check-iam-posture.sh — assert an env's IAM posture is what the repo claims.
#
# WHY THIS EXISTS (2026-08-03): `google_project_default_service_accounts` was
# applied with action=DISABLE, reported success, recorded `service_accounts = {}`
# — and did nothing. The compute default SA kept roles/editor. From then on
# `terraform plan` said "No changes" forever: the state asserted a hardening the
# project did not have, and nothing would ever have contradicted it.
#
# That is the same shape as the sign-in outage check-auth-config.sh was written
# for: a setting that looks configured, isn't, and is invisible because every
# green signal is measuring the wrong thing. The fix in both cases is the same —
# compare what is DEPLOYED against what the posture requires, rather than
# trusting the layer that claims to own it.
#
# Usage:
#   ./scripts/check-iam-posture.sh            # test + prod
#   ./scripts/check-iam-posture.sh prod
#
# Requires gcloud auth. Read-only.
set -uo pipefail

ENVS=("$@")
[ $# -eq 0 ] && ENVS=(test prod)

fail=0

for ENV in "${ENVS[@]}"; do
  case "${ENV}" in
    test) PROJECT="aipla-test-2026" ;;
    prod) PROJECT="aipla-prod-2026" ;;
    dev)
      echo "== ${ENV}: skipped (dev keeps the permissive local-dev posture by design)"
      continue
      ;;
    *) echo "Unknown env: ${ENV} (use test|prod)" >&2; exit 2 ;;
  esac

  echo "== IAM posture: ${ENV} (${PROJECT}) =="

  NUM="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)' 2>/dev/null)"
  if [ -z "${NUM}" ]; then
    echo "  ERROR: cannot read project ${PROJECT} (auth?)" >&2
    fail=1
    continue
  fi
  COMPUTE_SA="${NUM}-compute@developer.gserviceaccount.com"

  # 1. Nobody holds roles/editor. Terraform reasserts this via the authoritative
  #    empty binding (iam.tf google_project_iam_binding.no_editor).
  EDITORS="$(gcloud projects get-iam-policy "${PROJECT}" \
    --flatten='bindings[].members' --filter='bindings.role=roles/editor' \
    --format='value(bindings.members)' 2>/dev/null)"
  if [ -n "${EDITORS}" ]; then
    echo "  FAIL roles/editor is held by:"
    echo "${EDITORS}" | sed 's/^/         /'
    fail=1
  else
    echo "  ok   roles/editor held by nobody"
  fi

  # 2. The compute default SA is disabled. Terraform cannot express this (it
  #    only creates <project>.iam.gserviceaccount.com accounts), so this check
  #    IS the control, not a duplicate of one.
  DISABLED="$(gcloud iam service-accounts describe "${COMPUTE_SA}" \
    --project="${PROJECT}" --format='value(disabled)' 2>/dev/null)"
  if [ "${DISABLED}" = "True" ]; then
    echo "  ok   ${COMPUTE_SA} disabled"
  elif [ -z "${DISABLED}" ] && ! gcloud iam service-accounts describe "${COMPUTE_SA}" \
      --project="${PROJECT}" >/dev/null 2>&1; then
    echo "  ok   ${COMPUTE_SA} does not exist (deleted)"
  else
    echo "  FAIL ${COMPUTE_SA} is ENABLED — disable it:"
    echo "         gcloud iam service-accounts disable ${COMPUTE_SA} --project=${PROJECT}"
    fail=1
  fi

  # 3. Break-glass exists. The projects have NO parent organisation, so
  #    project-level owner is the only escape hatch: degrading the everyday
  #    account without a second owner is unrecoverable. Checked BEFORE (4)
  #    because (4) is only safe if this passes.
  OWNERS="$(gcloud projects get-iam-policy "${PROJECT}" \
    --flatten='bindings[].members' --filter='bindings.role=roles/owner' \
    --format='value(bindings.members)' 2>/dev/null)"
  BREAKGLASS="$(echo "${OWNERS}" | grep -c 'mark.edmondson@ind.ku.dk' || true)"
  if [ "${BREAKGLASS}" -ge 1 ]; then
    echo "  ok   break-glass owner present (mark.edmondson@ind.ku.dk)"
  else
    echo "  FAIL no break-glass owner — do NOT degrade any account until one exists"
    fail=1
  fi

  # 4. The everyday account is not an owner. Enforced since the authoritative
  #    google_project_iam_binding.owners landed — this is the WALL the rest of
  #    the 2026-08-03 work only approximates, so it fails rather than informs.
  if echo "${OWNERS}" | grep -q 'm@sunholo.com'; then
    echo "  FAIL m@sunholo.com holds roles/owner — apply project_owners (SEQUENCE 1.1.60)"
    fail=1
  else
    echo "  ok   m@sunholo.com is not an owner"
  fi

  # 5. ...but it must retain what it needs to DRIVE the pipelines. Degrading to
  #    pure viewer removes cloudbuild.builds.create, which is what
  #    `gcloud builds triggers run` needs — i.e. it would take away make tf-apply
  #    and make promote along with the danger. Checked so nobody "tidies up" the
  #    baseline grants later and silently severs the CI path.
  OPERATOR_ROLES="$(gcloud projects get-iam-policy "${PROJECT}" \
    --flatten='bindings[].members' --filter='bindings.members:m@sunholo.com' \
    --format='value(bindings.role)' 2>/dev/null)"
  if echo "${OPERATOR_ROLES}" | grep -q 'roles/cloudbuild.builds.editor'; then
    echo "  ok   m@sunholo.com can still run build triggers"
  else
    echo "  FAIL m@sunholo.com lacks roles/cloudbuild.builds.editor — make tf-apply / make promote will 403"
    fail=1
  fi
done

echo
if [ "${fail}" -ne 0 ]; then
  echo "IAM posture: FAIL"
  exit 1
fi
echo "IAM posture: OK"
