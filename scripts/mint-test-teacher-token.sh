#!/usr/bin/env bash
# Mint a Firebase ID token for the AIPLA test-teacher, for authenticating the
# `aiplatform` CLI (or a seed script) against teacher-only endpoints
# (curriculum, classes, …) in a deployed env.
#
# Prints ONLY the idToken to stdout, so:
#   export AIPLATFORM_ID_TOKEN="$(scripts/mint-test-teacher-token.sh)"
#   scripts/mint-test-teacher-token.sh test
#
# Firebase is per-project, so the Web API key is per-env. dev reads it from
# frontend/.env.local; test/prod read it from that project's FIREBASE_ENV secret
# — the same secret get-firebase-config.sh feeds the frontend build, so there is
# one authority per env rather than a table of keys to keep in sync. The key is
# PUBLIC either way (it ships in the bundle). $FIREBASE_API_KEY overrides all.
#
# The test-teacher creds default to the known account (test-teacher@example.dk /
# aipla-demo-1); override with TEACHER_EMAIL / TEACHER_PASSWORD. Prod has email
# sign-in on for the pilot but no seeded test-teacher — pass creds explicitly.
# Neither the key nor the token is echoed — only the token reaches stdout.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV="${1:-dev}"
case "$ENV" in
  dev|test|prod) : ;;
  *) echo "ERROR: unknown env '$ENV' (expected: dev|test|prod)" >&2; exit 1 ;;
esac

EMAIL="${TEACHER_EMAIL:-test-teacher@example.dk}"
PASSWORD="${TEACHER_PASSWORD:-aipla-demo-1}"

API_KEY="${FIREBASE_API_KEY:-}"
if [ -z "$API_KEY" ] && [ "$ENV" = "dev" ]; then
  API_KEY="$(grep -hoE 'NEXT_PUBLIC_FIREBASE_API_KEY=[^[:space:]]+' "$REPO_ROOT"/frontend/.env.local 2>/dev/null | head -1 | cut -d= -f2-)"
fi
if [ -z "$API_KEY" ]; then
  # test/prod (and dev without a local .env.local): the env's own build secret.
  API_KEY="$(gcloud secrets versions access latest \
    --secret=FIREBASE_ENV --project="aipla-${ENV}-2026" 2>/dev/null \
    | grep -hoE 'NEXT_PUBLIC_FIREBASE_API_KEY=[^[:space:]]+' | head -1 | cut -d= -f2-)"
fi
if [ -z "$API_KEY" ]; then
  echo "ERROR: Firebase Web API key not found for env '$ENV'. Either set" >&2
  echo "       FIREBASE_API_KEY, or make sure you can read the FIREBASE_ENV" >&2
  echo "       secret in aipla-${ENV}-2026 (gcloud auth login)." >&2
  exit 1
fi

RESP="$(curl -fsS -X POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"returnSecureToken\":true}" 2>/dev/null)" || {
  echo "ERROR: signInWithPassword request failed for ${EMAIL} (check creds / network)." >&2
  exit 1
}

TOKEN="$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("idToken",""))' 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  ERR="$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("error",{}).get("message",""))' 2>/dev/null || true)"
  echo "ERROR: no idToken returned. Firebase says: ${ERR:-<unparseable response>}" >&2
  echo "       (Does ${EMAIL} exist in aipla-${ENV}-2026 Firebase with that password?" >&2
  echo "        Set TEACHER_EMAIL / TEACHER_PASSWORD for a different account.)" >&2
  exit 1
fi
printf '%s' "$TOKEN"
