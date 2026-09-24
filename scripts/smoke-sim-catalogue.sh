#!/usr/bin/env bash
# Verify a sim is REALLY in the library on a deployed env, as a teacher sees it.
#
#   scripts/smoke-sim-catalogue.sh <dev|test|prod> [<artefact-id>]
#   make smoke-sim ENV=test ID=sol-jord-maane
#
# Checks, in the order a teacher would hit them:
#   1. the sandbox serves the artefact HTML (200)
#   2. every /vendor/ library the artefact loads is served (200)
#   3. the teacher catalogue (GET /api/artefacts?status=live — what SimPicker
#      requests) lists the id, signed in as the test teacher
#   4. no catalogue entry leaks its server-side tutorBlock to the browser
#
# Step 3 needs a teacher token; it is minted by mint-test-teacher-token.sh
# (test-teacher@example.dk on dev and test). Prod has NO seeded test teacher, by
# design — its password is in this repo. On prod pass TEACHER_EMAIL /
# TEACHER_PASSWORD for a real account, or accept steps 1-2 plus
# `make deploy-status` (prod's backend is test's tested digest, promoted).
# A check that could not run is reported as SKIPPED, never as OK.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV="${1:-}"
ID="${2:-}"
case "$ENV" in dev|test|prod) : ;; *) echo "usage: $0 <dev|test|prod> [<artefact-id>]" >&2; exit 2 ;; esac

PROJECT="aipla-${ENV}-2026"
REGION="europe-north1"
FRONTEND="$(gcloud run services describe aipla-v01-frontend --project="$PROJECT" --region="$REGION" --format='value(status.url)' 2>/dev/null)"
SANDBOX="$(gcloud run services describe aipla-v01-sandbox --project="$PROJECT" --region="$REGION" --format='value(status.url)' 2>/dev/null)"
if [ -z "$FRONTEND" ] || [ -z "$SANDBOX" ]; then
  echo "CANNOT READ service URLs in $PROJECT as $(gcloud config get account 2>/dev/null) — no verdict." >&2
  exit 2
fi

fail=0
ok()   { echo "  OK      $*"; }
bad()  { echo "  FAIL    $*"; fail=1; }
skip() { echo "  SKIPPED $*"; }

echo "== $ENV  frontend $FRONTEND"
echo "        sandbox  $SANDBOX"

if [ -n "$ID" ]; then
  HTML="$(curl -fsS "$SANDBOX/artefacts/$ID/v1/index.html" 2>/dev/null)"
  if [ -n "$HTML" ]; then ok "sandbox serves $ID/v1/index.html"; else bad "sandbox does not serve $ID/v1/index.html"; fi
  for src in $(printf '%s' "$HTML" | grep -oE 'src="/vendor/[^"]+"' | cut -d'"' -f2 | sort -u); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$SANDBOX$src")"
    if [ "$code" = "200" ]; then ok "vendor $src"; else bad "vendor $src -> $code"; fi
  done
fi

TOKEN="$("$REPO_ROOT/scripts/mint-test-teacher-token.sh" "$ENV" 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  skip "teacher catalogue — no teacher token for $ENV (prod: set TEACHER_EMAIL / TEACHER_PASSWORD)"
else
  BODY="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$FRONTEND/api/proxy/api/artefacts?status=live" 2>/dev/null)"
  if [ -z "$BODY" ]; then
    bad "teacher catalogue request failed"
  else
    printf '%s' "$BODY" | python3 -c '
import json, sys
want = sys.argv[1]
d = json.load(sys.stdin)
items = d if isinstance(d, list) else next((v for v in d.values() if isinstance(v, list)), [])
ids = [a.get("id") for a in items]
print("  ..      live:", ", ".join(ids))
leak = [a.get("id") for a in items if "tutorBlock" in a or "tutor_block" in a]
rc = 0
if leak:
    print("  FAIL    tutorBlock serialised to the browser for:", ", ".join(leak)); rc = 1
else:
    print("  OK      no tutorBlock in the teacher catalogue")
if want:
    if want in ids: print("  OK      " + want + " is live in the teacher catalogue")
    else: print("  FAIL    " + want + " is NOT in the teacher catalogue"); rc = 1
sys.exit(rc)
' "$ID" || fail=1
  fi
fi

echo
if [ "$fail" -eq 0 ]; then echo "sim catalogue smoke passed on $ENV."; else echo "sim catalogue smoke FAILED on $ENV."; fi
exit "$fail"
