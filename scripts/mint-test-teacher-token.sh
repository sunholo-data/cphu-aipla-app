#!/usr/bin/env bash
# Mint a Firebase ID token for the AIPLA dev test-teacher, for authenticating the
# `aiplatform` CLI against teacher-only endpoints (curriculum, classes, …) in dev.
#
# Prints ONLY the idToken to stdout, so:
#   export AIPLATFORM_ID_TOKEN="$(scripts/mint-test-teacher-token.sh)"
#
# The Firebase Web API key is PUBLIC (shipped in the frontend bundle); read from
# frontend/.env.local (NEXT_PUBLIC_FIREBASE_API_KEY) or $FIREBASE_API_KEY. The
# test-teacher creds default to the known dev account (test-teacher@example.dk /
# aipla-demo-1); override with TEACHER_EMAIL / TEACHER_PASSWORD. Neither the key
# nor the token is echoed — only the token reaches stdout for capture.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMAIL="${TEACHER_EMAIL:-test-teacher@example.dk}"
PASSWORD="${TEACHER_PASSWORD:-aipla-demo-1}"

API_KEY="${FIREBASE_API_KEY:-}"
if [ -z "$API_KEY" ]; then
  API_KEY="$(grep -hoE 'NEXT_PUBLIC_FIREBASE_API_KEY=[^[:space:]]+' "$REPO_ROOT"/frontend/.env.local 2>/dev/null | head -1 | cut -d= -f2-)"
fi
if [ -z "$API_KEY" ]; then
  echo "ERROR: Firebase Web API key not found. Set FIREBASE_API_KEY or add" >&2
  echo "       NEXT_PUBLIC_FIREBASE_API_KEY to frontend/.env.local." >&2
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
  echo "       (Does ${EMAIL} exist in aipla-dev-2026 Firebase with that password?)" >&2
  exit 1
fi
printf '%s' "$TOKEN"
