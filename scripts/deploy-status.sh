#!/usr/bin/env bash
# deploy-status.sh — what is ACTUALLY running in each environment?
#
# WHY THIS EXISTS (2026-08-04). Restoring prod after INFRA-1, the version to
# promote was taken from two sources that both said v0.1.4: the dead Cloud Run
# revision, and docs/ops/deployed-urls.md. Both were stale — test had moved to
# v0.1.5 the day before. Prod was restored a release behind, and nothing in the
# process would have caught it.
#
# The deploy runbook's own example is `make promote VERSION=v0.1.4 …`, which is
# exactly the number that was wrong. A runbook cannot carry a current version,
# and a doc that must be hand-updated on every tag will drift. So: ask the
# services.
#
# Read-only. Run before any promotion.
set -uo pipefail

REGION="europe-north1"
declare -a ENVS=("$@")
[ $# -eq 0 ] && ENVS=(dev test prod)

# Pull the image tag (or digest) a service is actually serving.
running_image() { # $1=project $2=service $3=container-substring
  gcloud run services describe "$2" --region="${REGION}" --project="$1" \
    --format='value(spec.template.spec.containers[].image)' 2>/dev/null \
    | tr ';' '\n' | grep "$3" | head -1
}

version_of() { # strip everything up to the tag/digest
  local img="$1"
  case "${img}" in
    *@sha256:*) echo "digest:${img##*@sha256:}" | cut -c1-19 ;;
    *:*)        echo "${img##*:}" ;;
    "")         echo "(not deployed)" ;;
    *)          echo "(untagged)" ;;
  esac
}

# Plain variables, not an associative array: macOS ships bash 3.2, where
# `declare -A` is a syntax error. This script has to run on the operator's
# laptop, which is a Mac.
FE_VER_TEST=""
FE_VER_PROD=""

for ENV in "${ENVS[@]}"; do
  case "${ENV}" in
    dev|test|prod) PROJECT="aipla-${ENV}-2026" ;;
    *) echo "Unknown env: ${ENV}" >&2; exit 2 ;;
  esac

  UI="$(running_image "${PROJECT}" aipla-v01-frontend '/ui')"
  BE="$(running_image "${PROJECT}" aipla-v01-frontend '/backend')"
  SB="$(running_image "${PROJECT}" aipla-v01-sandbox '/sandbox')"

  UIV="$(version_of "${UI}")"
  [ "${ENV}" = "test" ] && FE_VER_TEST="${UIV}"
  [ "${ENV}" = "prod" ] && FE_VER_PROD="${UIV}"

  echo "== ${ENV} (${PROJECT})"
  printf "   %-9s %s\n" "ui"      "${UIV}"
  printf "   %-9s %s\n" "backend" "$(version_of "${BE}")"
  printf "   %-9s %s\n" "sandbox" "$(version_of "${SB}")"

  # Serving or not. A version number is not health — prod sat on a perfectly
  # correct v0.1.4 reference while returning 500, because the images behind it
  # had been deleted.
  URL="$(gcloud run services describe aipla-v01-frontend --region="${REGION}" \
        --project="${PROJECT}" --format='value(status.url)' 2>/dev/null)"
  if [ -n "${URL}" ]; then
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 45 "${URL}/" 2>/dev/null)"
    [ "${CODE}" = "200" ] && printf "   %-9s %s (%s)\n" "serving" "200" "${URL}" \
                          || printf "   %-9s %s (%s)  <-- NOT HEALTHY\n" "serving" "${CODE}" "${URL}"
  fi
done

# The comparison the promote step actually needs. prod behind test is normal
# between releases; it is only a problem when it is UNINTENDED, which is the
# case this makes visible.
if [ -n "${FE_VER_TEST}" ] && [ -n "${FE_VER_PROD}" ]; then
  echo
  if [ "${FE_VER_TEST}" = "${FE_VER_PROD}" ]; then
    echo "test and prod are level (${FE_VER_PROD})."
  else
    echo "DRIFT: test=${FE_VER_TEST}  prod=${FE_VER_PROD}"
    echo "  To bring prod level:"
    echo "    make promote VERSION=${FE_VER_TEST} FROM=test TO=prod          # dry-run"
    echo "    make promote VERSION=${FE_VER_TEST} FROM=test TO=prod GO=1"
  fi
fi
