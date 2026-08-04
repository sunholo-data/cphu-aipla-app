#!/usr/bin/env bash
# scripts/seed-platform-skills.sh — apply the SKILL.md template upsert
# against a deployed env. Wraps the manual runbook in
# docs/design/aipla/v1.0.0-pilot/aipla-cloud-bootstrap.md §Manual seed
# runbook so it can be re-run reliably (and from CI eventually).
#
# Why: without a seed, edits to template frontmatter (tools list,
# accessControl, avatar, etc.) never propagate to Firestore for
# already-registered skills, and brand-new templates never register at
# all — the "works in tests, deployed app shows old skill data" footgun.
#
# THIS IS THE NO-DEPLOY PATH. Since P1.3 (2026-07-23) every deploy seeds
# automatically via the aipla-seed-skills Cloud Run job
# (scripts/deploy-seed-job.sh, run from both cloudbuild.yaml and — since
# 2026-08-04 — cloudbuild.promote.yaml). Use this script when you need a
# template change live WITHOUT shipping a build. Both paths call the same
# seed(), so they cannot drift.
#
# Pre-reqs
#   - gcloud installed + authenticated as a user with
#     roles/iam.serviceAccountTokenCreator on aipla-v6@<env>
#   - `python3 -m json.tool` on PATH (for pretty-printing the response)
#
# Usage
#   scripts/seed-platform-skills.sh                  # defaults to dev
#   scripts/seed-platform-skills.sh dev              # explicit
#   scripts/seed-platform-skills.sh test
#   scripts/seed-platform-skills.sh prod
#
# Exit codes
#   0  seed call returned 2xx
#   1  seed call returned non-2xx (body printed)
#   2  pre-req missing (gcloud, python3, unknown env)
set -euo pipefail

ENV="${1:-dev}"
REGION="europe-north1"
SERVICE="aipla-v01-frontend"

case "$ENV" in
  dev|test|prod) PROJECT="aipla-${ENV}-2026" ;;
  *)
    echo "Unknown env '$ENV' (expected: dev|test|prod)" >&2
    exit 2
    ;;
esac

SA="aipla-v6@${PROJECT}.iam.gserviceaccount.com"

command -v gcloud  >/dev/null 2>&1 || { echo "gcloud not on PATH" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "python3 not on PATH" >&2; exit 2; }

# Resolve the service URL LIVE rather than hardcoding it, matching
# scripts/smoke-deployed.sh. Until 2026-08-04 test and prod carried literal
# `…-{test,prod}-placeholder.a.run.app` strings here — this script had never
# been run against either env and would have failed at the curl if it were.
# Hardcoded run.app URLs also rot silently on any service recreate; there is one
# authority for "where does this env live", and it is the project itself.
URL="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" \
  --format='value(status.url)' 2>/dev/null || true)"
if [ -z "$URL" ]; then
  echo "Could not resolve $SERVICE in $PROJECT/$REGION." >&2
  echo "  Check: gcloud auth login, and that the env has been deployed." >&2
  exit 2
fi

echo "== seed-platform-skills =="
echo "env: $ENV"
echo "URL: $URL"
echo "SA:  $SA"
echo

# IMPORTANT: redirect stderr to /dev/null when capturing the token.
# gcloud prints "WARNING: This command is using service account
# impersonation. All API calls will be executed as [...]" to stderr;
# if combined into stdout via 2>&1, the warning text gets prepended
# to the JWT and the backend rejects it with `MalformedError: Wrong
# number of segments in token`. (Real bug, seen 2026-06-02.)
echo "[1] mint SA identity token (stderr suppressed to keep token clean)"
TOKEN="$(gcloud auth print-identity-token \
  --impersonate-service-account="$SA" \
  --audiences="$URL" \
  --include-email \
  2>/dev/null)"

if [ -z "$TOKEN" ]; then
  echo "  FAIL: empty token. Likely missing 'roles/iam.serviceAccountTokenCreator' on $SA." >&2
  echo "  Diagnose: gcloud auth print-identity-token --impersonate-service-account=$SA --audiences=$URL --include-email" >&2
  exit 1
fi
echo "  OK (token length=${#TOKEN})"

echo
echo "[2] POST /api/admin/seed-platform-skills"
HTTP_CODE="$(curl -sS -o /tmp/seed_result.json -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$URL/api/proxy/api/admin/seed-platform-skills")"

echo "  HTTP $HTTP_CODE"
echo
echo "--- response body ---"
python3 -m json.tool < /tmp/seed_result.json 2>/dev/null || cat /tmp/seed_result.json
echo "---"

if [ "$HTTP_CODE" != "200" ]; then
  echo "  FAIL: non-200 response" >&2
  exit 1
fi

# Pull a PASS/FAIL signal from the SeedSummary. Backend returns:
#   {"created": int, "updated": int, "skipped": int,
#    "failed": [str, ...], "tool_permissions_wildcard_seeded": bool}
# `created` + `updated` + `skipped` are counts; `failed` is a list.
SUMMARY="$(python3 -c "
import json, sys
d = json.load(open('/tmp/seed_result.json'))
created = int(d.get('created', 0))
updated = int(d.get('updated', 0))
skipped = int(d.get('skipped', 0))
failed = d.get('failed', [])
print(f'created={created} updated={updated} skipped={skipped} failed={len(failed)}')
if failed:
    print('FAILED:', json.dumps(failed, indent=2))
    sys.exit(1)
")" || { echo "  FAIL: seed reported errors"; exit 1; }
echo
echo "== summary: $SUMMARY =="
