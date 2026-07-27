#!/usr/bin/env bash
# Provision the Vertex AI Agent Engine for <env> and store its numeric id in the
# AGENT_ENGINE_ID secret. Mirrors ensure_agent_engine() in bootstrap-aipla-dev.sh,
# extracted as a standalone per-env post-apply step: Terraform creates the secret
# SHELL (secrets.tf) + grants the SA accessor; this fills the value.
#
# Vertex Agent Engine lives in europe-west1 (NOT the europe-north1 compute pin).
#
# Usage:  scripts/provision-agent-engine.sh <dev|test|prod>
#         make provision-agent-engine ENV=test
set -euo pipefail

ENV="${1:?usage: provision-agent-engine.sh <dev|test|prod>}"
case "$ENV" in dev | test | prod) ;; *) echo "bad env '$ENV' (dev|test|prod)" >&2; exit 2 ;; esac

PROJECT="aipla-${ENV}-2026"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[provision-agent-engine] env=${ENV} project=${PROJECT} region=europe-west1"
ID="$(
  GOOGLE_CLOUD_PROJECT="$PROJECT" \
  GOOGLE_CLOUD_LOCATION="europe-west1" \
  AGENT_ENGINE_STAGING_BUCKET="gs://${PROJECT}-artifacts" \
  uv --project "$REPO_ROOT/backend" run python "$REPO_ROOT/backend/scripts/bootstrap_agent_engine.py" \
    --display-name aipla-v01 2>&1 | tail -1
)"
[[ "$ID" =~ ^[0-9]+$ ]] || { echo "ERROR: non-numeric engine id '$ID' — see output above" >&2; exit 1; }

printf '%s' "$ID" | gcloud secrets versions add AGENT_ENGINE_ID --data-file=- --project="$PROJECT" >/dev/null
echo "[provision-agent-engine] ✓ AGENT_ENGINE_ID (${ENV}) = ${ID}"
