#!/usr/bin/env bash
# promote-env.sh — build-once artifact promotion (tag→test, copy→prod).
#
# Promotes a released version from one env to the next by COPYING the tested
# backend image (no rebuild) and rebuilding only the frontend from the same
# immutable tag with the target env's config. See
# docs/design/aipla/v1.0.0-pilot/build-once-artifact-promotion.md.
#
# The actual steps run in Cloud Build (cloudbuild.promote.yaml) in the TARGET
# project; this script validates, prints the plan, and submits that build.
# Both this script and the (increment-2) aipla-<env>-promote trigger run the
# same cloudbuild.promote.yaml, so there is one promotion implementation.
#
# Usage:
#   scripts/promote-env.sh --from test --to prod --version v1.1.40 [--dry-run] [--yes]
#
# --dry-run  print the exact gcloud plan and exit (no mutation).
# --yes      skip the interactive confirm and the HEAD==tag check.
#
# Safe by default: prompts before submitting; refuses if the working tree is
# not at the version tag (so you promote the bytes you tagged, not local edits).
set -euo pipefail

REGION="europe-north1"
REPO="cphu"
SERVICE="aipla-v01-frontend"
PROMOTE_CONFIG="cloudbuild.promote.yaml"
FROM_ENV=""
TO_ENV=""
VERSION=""
DRY_RUN=0
ASSUME_YES=0

die() { echo "ERROR: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM_ENV="${2:-}"; shift 2 ;;
    --to) TO_ENV="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --region) REGION="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --service) SERVICE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) die "unknown arg: $1 (try --help)" ;;
  esac
done

[ -n "$FROM_ENV" ] && [ -n "$TO_ENV" ] && [ -n "$VERSION" ] || \
  die "required: --from <env> --to <env> --version <tag>"

# Allowed promotion edges — never skip a tier, never promote backwards.
# (`:` delimiter, not `->`: bash 3.2 mis-parses `>` inside a case pattern.)
case "${FROM_ENV}:${TO_ENV}" in
  dev:test|test:prod) ;;
  *) die "illegal promotion edge ${FROM_ENV}->${TO_ENV} (allowed: dev->test, test->prod)" ;;
esac

SRC_PROJECT="aipla-${FROM_ENV}-2026"
DST_PROJECT="aipla-${TO_ENV}-2026"
SRC_AR="${REGION}-docker.pkg.dev/${SRC_PROJECT}/${REPO}/${SERVICE}"
DST_AR="${REGION}-docker.pkg.dev/${DST_PROJECT}/${REPO}/${SERVICE}"
SRC_BACKEND="${SRC_AR}/backend:${VERSION}"
DST_BACKEND="${DST_AR}/backend:${VERSION}"

command -v gcloud >/dev/null 2>&1 || die "gcloud not found on PATH"

# Resolve the source backend digest — the immutable identity we copy. (Best
# effort: skipped in dry-run / when the source image isn't reachable yet.)
DIGEST="<resolved-at-run>"
if [ "$DRY_RUN" -eq 0 ]; then
  DIGEST="$(gcloud artifacts docker images describe "${SRC_BACKEND}" \
    --format='value(image_summary.digest)' 2>/dev/null || echo '')"
  [ -n "$DIGEST" ] || die "source backend image not found: ${SRC_BACKEND} (is the ${FROM_ENV} release built?)"
fi

echo "== build-once promotion plan =="
echo "  release version : ${VERSION}"
echo "  from -> to       : ${FROM_ENV} (${SRC_PROJECT}) -> ${TO_ENV} (${DST_PROJECT})"
echo "  backend (COPY)   : ${SRC_BACKEND}"
echo "                     -> ${DST_BACKEND}   digest=${DIGEST}"
echo "  frontend (REBUILD from tag, target config) -> ${DST_AR}/ui:${VERSION}"
echo "  pipeline         : ${PROMOTE_CONFIG} (runs in ${DST_PROJECT}), then smoke ${TO_ENV}"
echo "  build source     : repo @ tag ${VERSION} (NOT your working tree)"
echo

# Run the promote TRIGGER, checked out AT THE TAG.
#
# This used to be `gcloud builds submit … .`, which uploads the operator's LOCAL
# WORKING TREE as the build source — so the frontend prod ran was built from
# whatever happened to be checked out on someone's laptop, and the script needed
# a HEAD==tag guard to compensate. `triggers run --tag` makes Cloud Build check
# the repo out at the tag instead: the tag becomes the single source of truth and
# the laptop leaves the supply chain. Same mechanism as
# sunholo-data/docparse `scripts/release.sh promote`.
#
# The trigger carries _SOURCE_PROJECT/_TARGET_PROJECT/_REGION/_REPO/_SERVICE_NAME
# and its own service account from Terraform; only _VERSION is per-run.
TRIGGER="aipla-${TO_ENV}-promote"

SUBMIT_CMD=(gcloud builds triggers run "${TRIGGER}"
  --project="${DST_PROJECT}"
  --region="${REGION}"
  --tag="${VERSION}"
  "--substitutions=_VERSION=${VERSION}")

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] would run:"
  printf '  %q ' "${SUBMIT_CMD[@]}"; echo
  echo "[dry-run] no mutation performed."
  exit 0
fi

# The trigger resolves ${VERSION} against the REMOTE, so that is what must exist.
# (The old HEAD==tag guard is gone with `builds submit`: the local working tree
# is no longer the build source, so what is checked out locally is irrelevant.)
git ls-remote --exit-code --tags origin "refs/tags/${VERSION}" >/dev/null 2>&1 || \
  die "tag ${VERSION} not found on origin — push it first (git push origin ${VERSION})"

if [ "$ASSUME_YES" -eq 0 ]; then
  # Without a TTY there is nobody to answer, so `read` returns EOF immediately
  # and the prompt "aborts" for a reason that has nothing to do with intent.
  # Say so, instead of letting a caller (make, CI, a pipe) read it as a failed
  # promotion — which is how it presented while prod was down on 2026-08-04.
  if [ ! -t 0 ]; then
    die "no TTY to confirm on. Pass --yes (or use: make promote VERSION=… FROM=… TO=… GO=1)."
  fi
  read -r -p "Promote ${VERSION} ${FROM_ENV} -> ${TO_ENV}? [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || die "aborted."
fi

"${SUBMIT_CMD[@]}"
echo "Promotion build submitted to ${DST_PROJECT}. Watch: gcloud builds list --project=${DST_PROJECT} --region=${REGION} --ongoing"
