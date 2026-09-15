#!/usr/bin/env bash
# scripts/check-user-role.sh — read a Firebase user's custom claims
# (role:researcher, admin, programmeAdmin) against a deployed env.
#
# Why: claims are granted per environment (dev/test/prod each have their own
# Firebase project) via /api/admin/grant-researcher etc., and nothing syncs a
# grant between them. Before this script the only way to check "does this
# person have researcher on prod" was a Firebase Console trip or a raw
# Identity Toolkit call — which is how a researcher-gated skill 404'd with a
# message pointing at the seed script when the real cause was a missing
# per-env claim (2026-09-15). GET /api/admin/user-roles is read-only, no
# mutation, same SA-allowlist gate as every other admin/* route.
#
# Pre-reqs
#   - gcloud installed + authenticated as a user with
#     roles/iam.serviceAccountTokenCreator on aipla-v6@<env>
#   - `python3 -m json.tool` on PATH (for pretty-printing the response)
#
# Usage
#   scripts/check-user-role.sh <env> <uid-or-email>
#   scripts/check-user-role.sh prod m@sunholo.com
#   scripts/check-user-role.sh dev  mark@aitanalabs.com
#
# Exit codes
#   0  call returned 2xx
#   1  call returned non-2xx (body printed) — e.g. 404 no such user
#   2  pre-req missing (gcloud, python3, unknown env, missing arg)
set -euo pipefail

# gcloud lives outside the default Bash-tool PATH on some laptops (e.g. at
# ~/dev/google-cloud-sdk/bin) — fall back to it so this script is runnable
# standalone (`scripts/check-user-role.sh dev me@example.com`) without an
# `export PATH=...` prefix first. A real `gcloud` already on PATH wins.
if ! command -v gcloud >/dev/null 2>&1 && [ -x "$HOME/dev/google-cloud-sdk/bin/gcloud" ]; then
  PATH="$HOME/dev/google-cloud-sdk/bin:$PATH"
fi

ENV="${1:-}"
TARGET="${2:-}"
REGION="europe-north1"
SERVICE="aipla-v01-frontend"

case "$ENV" in
  dev|test|prod) PROJECT="aipla-${ENV}-2026" ;;
  *)
    echo "Unknown env '$ENV' (expected: dev|test|prod)" >&2
    echo "Usage: scripts/check-user-role.sh <dev|test|prod> <uid-or-email>" >&2
    exit 2
    ;;
esac

if [ -z "$TARGET" ]; then
  echo "Missing uid-or-email argument." >&2
  echo "Usage: scripts/check-user-role.sh <dev|test|prod> <uid-or-email>" >&2
  exit 2
fi

SA="aipla-v6@${PROJECT}.iam.gserviceaccount.com"

command -v gcloud  >/dev/null 2>&1 || { echo "gcloud not on PATH" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "python3 not on PATH" >&2; exit 2; }

# Resolve the service URL LIVE, same reasoning as seed-platform-skills.sh —
# one authority for "where does this env live", never a hardcoded run.app.
URL="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" \
  --format='value(status.url)' 2>/dev/null || true)"
if [ -z "$URL" ]; then
  echo "Could not resolve $SERVICE in $PROJECT/$REGION." >&2
  echo "  Check: gcloud auth login, and that the env has been deployed." >&2
  exit 2
fi

echo "== check-user-role =="
echo "env:    $ENV"
echo "URL:    $URL"
echo "SA:     $SA"
echo "target: $TARGET"
echo

# IMPORTANT: redirect stderr to /dev/null when capturing the token — see
# seed-platform-skills.sh for why (the impersonation WARNING line otherwise
# prepends onto the JWT and the backend rejects it as malformed).
echo "[1] mint SA identity token (stderr suppressed to keep token clean)"
TOKEN="$(gcloud auth print-identity-token \
  --impersonate-service-account="$SA" \
  --audiences="$URL" \
  --include-email \
  2>/dev/null)"

if [ -z "$TOKEN" ]; then
  echo "  FAIL: empty token. Likely missing 'roles/iam.serviceAccountTokenCreator' on $SA." >&2
  exit 1
fi
echo "  OK (token length=${#TOKEN})"

echo
echo "[2] GET /api/admin/user-roles?uid=$TARGET"
HTTP_CODE="$(curl -sS -G -o /tmp/user_role_result.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "uid=$TARGET" \
  "$URL/api/proxy/api/admin/user-roles")"

echo "  HTTP $HTTP_CODE"
echo
echo "--- response body ---"
python3 -m json.tool < /tmp/user_role_result.json 2>/dev/null || cat /tmp/user_role_result.json
echo "---"

if [ "$HTTP_CODE" != "200" ]; then
  echo "  FAIL: non-200 response" >&2
  exit 1
fi
