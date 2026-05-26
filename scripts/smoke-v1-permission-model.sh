#!/usr/bin/env bash
# scripts/smoke-v1-permission-model.sh — 1.A teacher-permission-model smoke.
#
# Drives the full chain against a LOCAL_MODE backend (or a deployed
# URL via $URL):
#
#   1. Teacher signs in (LOCAL_MODE stub)
#   2. Teacher creates a class
#   3. Teacher mints a group code under that class
#   4. Anonymous student joins via the code
#   5. Student GETs /api/skills — class binding scopes the catalogue
#   6. Teacher soft-deletes the class — anon JWT is locked out on next verify
#
# Usage:
#   scripts/smoke-v1-permission-model.sh                                 # localhost backend on 1956
#   URL=https://aipla-v01-frontend-XYZ.a.run.app  scripts/smoke-v1-permission-model.sh
#
# Exits 0 on success; non-zero (with a clear log line) on any failure.
set -euo pipefail

# Default to localhost backend; CI / deployed runs override via $URL.
URL="${URL:-http://localhost:1956}"
LOCAL_MODE_TOKEN="${LOCAL_MODE_TOKEN:-local-mode-stub-token}"

log() { printf '\033[36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[32m✓ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 not on PATH"
}
require curl
require python3

log "URL=$URL"

# --- Step 1+2: create a class as the LOCAL_MODE teacher --------------------

log "POST /api/classes  name=\"Smoke test class\""
CREATE_RESP=$(
  curl -fsS -X POST "$URL/api/classes" \
    -H "Authorization: Bearer $LOCAL_MODE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name": "Smoke test class"}'
) || fail "create class returned non-2xx"

CLASS_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['classId'])")
TAG_NAMESPACE=$(echo "$CREATE_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['tagNamespace'])")
ok "class created  id=$CLASS_ID  namespace=$TAG_NAMESPACE"

# --- Step 3: mint a group code -------------------------------------------

log "POST /api/classes/$CLASS_ID/groups  count=1"
MINT_RESP=$(
  curl -fsS -X POST "$URL/api/classes/$CLASS_ID/groups" \
    -H "Authorization: Bearer $LOCAL_MODE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"count": 1}'
) || fail "mint groups returned non-2xx"

CODE=$(echo "$MINT_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['codes'][0])")
ok "minted code=$CODE"

# --- Step 4: anonymous student joins via the code -------------------------

log "POST /api/auth/group/join  code=$CODE"
JOIN_RESP=$(
  curl -fsS -X POST "$URL/api/auth/group/join" \
    -H "Content-Type: application/json" \
    -d "{\"group_id\": \"$CODE\"}"
) || fail "anon join returned non-2xx"

STUDENT_TOKEN=$(echo "$JOIN_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
ok "student joined  token=${STUDENT_TOKEN:0:24}…"

# --- Step 5: student fetches skills — the class binding should shape it ----

log "GET /api/skills  (student token)"
SKILLS=$(
  curl -fsS "$URL/api/skills" \
    -H "Authorization: Bearer $STUDENT_TOKEN"
) || fail "GET /api/skills returned non-2xx"
SKILLS_COUNT=$(echo "$SKILLS" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('skills', [])))")
ok "/api/skills returned $SKILLS_COUNT skills"

# --- Step 6: revoke the class — the anon JWT should now fail --------------

log "DELETE /api/classes/$CLASS_ID  (soft-delete)"
curl -fsS -X DELETE "$URL/api/classes/$CLASS_ID" \
  -H "Authorization: Bearer $LOCAL_MODE_TOKEN" \
  > /dev/null \
  || fail "soft-delete returned non-2xx"
ok "class revoked"

log "GET /api/skills (same student token, post-revocation)"
HTTP_CODE=$(
  curl -s -o /dev/null -w '%{http_code}' "$URL/api/skills" \
    -H "Authorization: Bearer $STUDENT_TOKEN"
)
if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  ok "stale token rejected  http=$HTTP_CODE  (live-revocation working)"
else
  fail "expected 401/403 after class revocation; got http=$HTTP_CODE"
fi

# --- Done ------------------------------------------------------------------

echo
ok "1.A teacher-permission-model smoke green"
