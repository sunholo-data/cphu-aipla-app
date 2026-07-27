#!/usr/bin/env bash
# scripts/seed-demo-codes.sh — (re)assert the known demo student join code(s)
# against a deployed env via the idempotent POST /api/admin/mint-demo-group
# upsert (auth.group_id_auth.upsert_group: create-or-extend by code).
#
# Why a script: demo codes are seeded by an admin SA call that 403s INSIDE
# Cloud Build (same constraint as scripts/seed-platform-skills.sh — see
# backend/admin/auth.py). So they're a MANUAL post-deploy step. They also carry
# a ~300-day TTL; if nobody re-asserts them they silently lapse and
# `make verify-chat-logs` / `smoke-*` (default GROUP=aipla-demo-1) break.
# Run this after a deploy, or whenever a demo code has gone missing.
#
# Pre-reqs
#   - gcloud authenticated as a user with
#     roles/iam.serviceAccountTokenCreator on aipla-v6@<env>
#   - python3 on PATH (pretty-print only)
#
# Usage
#   scripts/seed-demo-codes.sh            # dev, code aipla-demo-1
#   scripts/seed-demo-codes.sh dev
#   CODES="aipla-demo-1 aipla-demo-2" scripts/seed-demo-codes.sh dev
#   SKILL=problem-set-hints TTL_DAYS=300 scripts/seed-demo-codes.sh test
#
# Exit codes: 0 all upserts 2xx · 1 a call failed · 2 pre-req/unknown env
set -euo pipefail

ENV="${1:-dev}"
CODES="${CODES:-aipla-demo-1}"
SKILL="${SKILL:-problem-set-hints}"
TTL_DAYS="${TTL_DAYS:-300}"

case "$ENV" in
  dev) PROJECT="aipla-dev-2026" ;;
  test) PROJECT="aipla-test-2026" ;;
  prod) PROJECT="aipla-prod-2026" ;;
  *)
    echo "Unknown env '$ENV' (expected: dev|test|prod)" >&2
    exit 2
    ;;
esac
SA="aipla-v6@${PROJECT}.iam.gserviceaccount.com"
REGION="${REGION:-europe-north1}"
# Derive the live service URL — test/prod URLs are assigned at first deploy, so
# hardcoding them (the old *-placeholder.a.run.app) drifts. Resolve dynamically.
URL="$(gcloud run services describe aipla-v01-frontend --region="$REGION" --project="$PROJECT" --format='value(status.url)' 2>/dev/null)"
if [ -z "$URL" ]; then
  echo "Could not resolve aipla-v01-frontend URL in ${PROJECT}/${REGION} — is it deployed?" >&2
  exit 1
fi

command -v gcloud >/dev/null 2>&1 || { echo "gcloud not on PATH" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "python3 not on PATH" >&2; exit 2; }

echo "== seed-demo-codes =="
echo "env: $ENV   skill: $SKILL   ttl_days: $TTL_DAYS"
echo "codes: $CODES"
echo

# stderr suppressed so the impersonation WARNING doesn't taint the JWT
# (same gotcha as seed-platform-skills.sh, 2026-06-02).
TOKEN="$(gcloud auth print-identity-token \
  --impersonate-service-account="$SA" \
  --audiences="$URL" \
  --include-email \
  2>/dev/null)"
if [ -z "$TOKEN" ]; then
  echo "  FAIL: empty token. Likely missing 'roles/iam.serviceAccountTokenCreator' on $SA." >&2
  exit 1
fi

rc=0
for code in $CODES; do
  HTTP_CODE="$(curl -sS -o "/tmp/demo_${code}.json" -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"code\":\"${code}\",\"skill_name\":\"${SKILL}\",\"ttl_days\":${TTL_DAYS}}" \
    "$URL/api/proxy/api/admin/mint-demo-group")"
  echo "  $code -> HTTP $HTTP_CODE"
  python3 -m json.tool < "/tmp/demo_${code}.json" 2>/dev/null | sed 's/^/    /' || cat "/tmp/demo_${code}.json"
  [ "$HTTP_CODE" = "200" ] || rc=1
done

echo
[ "$rc" = "0" ] && echo "== all demo codes asserted ==" || echo "== one or more failed ==" >&2
exit $rc
