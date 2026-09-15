#!/usr/bin/env bash
# scripts/aiplatform-admin.sh — run an `aiplatform users …` admin verb against
# a deployed env with the SA-impersonated identity token already minted.
#
# Why: every /api/admin/* verb (grant-researcher, list-roles, list-access …)
# needs a Google ID token whose email is on ADMIN_SEED_ALLOWED_SAS, which
# means impersonating aipla-v6@<env> with `--include-email` and the service
# URL as audience. The CLI's own fallback (`gcloud auth print-identity-token`
# with no impersonation) produces a USER token, which the gate 403s — so a
# bare `aiplatform --env prod users grant-researcher …` never worked from a
# laptop. Until now the incantation lived in the docstring of users.py and
# in two sibling scripts; this is the one place that does it.
#
# Usage
#   scripts/aiplatform-admin.sh <dev|test|prod> <users subcommand…>
#   scripts/aiplatform-admin.sh prod list-roles
#   scripts/aiplatform-admin.sh prod grant-researcher m@sunholo.com
#   scripts/aiplatform-admin.sh test list-access --json
#
# Pre-reqs: gcloud on PATH (or at ~/dev/google-cloud-sdk/bin), authenticated
# as someone with roles/iam.serviceAccountTokenCreator on aipla-v6@<env>;
# the `aiplatform` CLI installed (`make cli-install`).
set -euo pipefail

if ! command -v gcloud >/dev/null 2>&1 && [ -x "$HOME/dev/google-cloud-sdk/bin/gcloud" ]; then
  PATH="$HOME/dev/google-cloud-sdk/bin:$PATH"
fi
# The default gcloud config points at the template's project — see the ops
# runbook's first line. Inherit an explicit choice, else force the right one.
export CLOUDSDK_ACTIVE_CONFIG_NAME="${CLOUDSDK_ACTIVE_CONFIG_NAME:-sunholo}"

ENV="${1:-}"
case "$ENV" in
  dev|test|prod) PROJECT="aipla-${ENV}-2026" ;;
  *)
    echo "Usage: scripts/aiplatform-admin.sh <dev|test|prod> <users subcommand…>" >&2
    exit 2
    ;;
esac
shift
if [ $# -eq 0 ]; then
  echo "Missing users subcommand (e.g. list-roles, grant-researcher <uid-or-email>)." >&2
  exit 2
fi

command -v gcloud     >/dev/null 2>&1 || { echo "gcloud not on PATH" >&2; exit 2; }
command -v aiplatform >/dev/null 2>&1 || { echo "aiplatform CLI not installed — run: make cli-install" >&2; exit 2; }

SA="aipla-v6@${PROJECT}.iam.gserviceaccount.com"
URL="$(gcloud run services describe aipla-v01-frontend \
  --project="$PROJECT" --region=europe-north1 \
  --format='value(status.url)' 2>/dev/null || true)"
if [ -z "$URL" ]; then
  echo "Could not resolve aipla-v01-frontend in $PROJECT — gcloud auth login? env deployed?" >&2
  exit 2
fi

# stderr suppressed on purpose: the impersonation WARNING otherwise prepends
# onto the JWT and the backend rejects it as malformed (seed-platform-skills.sh).
TOKEN="$(gcloud auth print-identity-token \
  --impersonate-service-account="$SA" \
  --audiences="$URL" \
  --include-email \
  2>/dev/null)"
if [ -z "$TOKEN" ]; then
  echo "Empty token — likely missing roles/iam.serviceAccountTokenCreator on $SA." >&2
  exit 1
fi

echo "== aiplatform-admin: env=$ENV as $SA ==" >&2
AIPLATFORM_ID_TOKEN="$TOKEN" exec aiplatform --env "$ENV" users "$@"
