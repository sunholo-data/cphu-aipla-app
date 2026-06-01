#!/usr/bin/env bash
# scripts/smoke-v1-session-persistence.sh — 1.F session-persistence smoke.
#
# Drives the full join → bootstrap → rejoin → restore → reset chain against
# a LOCAL_MODE backend (or a deployed URL via $URL):
#
#   1. Teacher creates a class + mints a group code
#   2. Student joins (first time) → resumedSessionId must be null
#   3. Student bootstraps a session → group→session mapping is written
#   4. Student joins again → resumedSessionId must match the bootstrapped id
#   5. GET /api/sessions/{id}/restore → 200 + expected shape
#   6. Teacher resets the session
#   7. Student joins again → resumedSessionId must be null (reset)
#
# Usage:
#   scripts/smoke-v1-session-persistence.sh                     # localhost
#   URL=https://... scripts/smoke-v1-session-persistence.sh
#
# Exits 0 on success; non-zero on any failure.
set -euo pipefail

URL="${URL:-http://localhost:1956}"
LOCAL_MODE_TOKEN="${LOCAL_MODE_TOKEN:-local-mode-stub-token}"
# A public skill that exists in the LOCAL_MODE seed data.
SKILL_SLUG="${SKILL_SLUG:-problem-set-hints}"

log()  { printf '\033[36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 not on PATH"
}
require curl
require python3

log "URL=$URL"

# --- Resolve skill ID from slug ---------------------------------------------
# bootstrap requires a skillId; pick the first public skill we can see.

log "GET /api/skills  (resolving skillId for bootstrap)"
SKILL_ID=$(
  curl -fsS "$URL/api/skills" \
    -H "Authorization: Bearer $LOCAL_MODE_TOKEN" \
  | python3 -c "
import sys, json
skills = json.load(sys.stdin)
slug = '$SKILL_SLUG'
for s in skills:
    if s.get('slug') == slug or s.get('name') == slug:
        print(s['skillId'])
        break
"
) || fail "GET /api/skills returned non-2xx"
[ -n "$SKILL_ID" ] || fail "Could not find skill with slug '$SKILL_SLUG' — is the backend seeded?"
ok "resolved skillId=$SKILL_ID  (slug=$SKILL_SLUG)"

# --- Step 1: teacher creates a class + mints a group code -------------------

log "POST /api/classes  name=\"1.F smoke class\""
CREATE_RESP=$(
  curl -fsS -X POST "$URL/api/classes" \
    -H "Authorization: Bearer $LOCAL_MODE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name": "1.F smoke class"}'
) || fail "create class returned non-2xx"

CLASS_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['classId'])")
ok "class created  id=$CLASS_ID"

log "POST /api/classes/$CLASS_ID/groups  count=1"
MINT_RESP=$(
  curl -fsS -X POST "$URL/api/classes/$CLASS_ID/groups" \
    -H "Authorization: Bearer $LOCAL_MODE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"count": 1}'
) || fail "mint groups returned non-2xx"

CODE=$(echo "$MINT_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['codes'][0])")
ok "minted code=$CODE"

# --- Step 2: first student join → resumedSessionId must be null -------------

log "POST /api/auth/group/join  code=$CODE  (first join)"
JOIN1_RESP=$(
  curl -fsS -X POST "$URL/api/auth/group/join" \
    -H "Content-Type: application/json" \
    -d "{\"group_id\": \"$CODE\"}"
) || fail "first join returned non-2xx"

STUDENT_TOKEN=$(echo "$JOIN1_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
RESUMED1=$(echo "$JOIN1_RESP" | python3 -c "import sys,json;v=json.load(sys.stdin).get('resumedSessionId');print(v if v is not None else 'null')")

if [ "$RESUMED1" != "null" ] && [ "$RESUMED1" != "None" ]; then
  fail "first join should return resumedSessionId=null; got $RESUMED1"
fi
ok "first join  resumedSessionId=null  (correct)"

# --- Step 3: student bootstraps a session -----------------------------------

SESSION_ID=$(python3 -c "import uuid; print(str(uuid.uuid4()))")
log "POST /api/sessions/$SESSION_ID/bootstrap  (student token)"
BOOTSTRAP_RESP=$(
  curl -fsS -X POST "$URL/api/sessions/$SESSION_ID/bootstrap" \
    -H "Authorization: Bearer $STUDENT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"skillId\": \"$SKILL_ID\"}"
) || fail "bootstrap returned non-2xx"

ok "bootstrapped session  id=$SESSION_ID"

# --- Step 4: second join → resumedSessionId must match ----------------------

log "POST /api/auth/group/join  code=$CODE  (rejoin)"
JOIN2_RESP=$(
  curl -fsS -X POST "$URL/api/auth/group/join" \
    -H "Content-Type: application/json" \
    -d "{\"group_id\": \"$CODE\"}"
) || fail "rejoin returned non-2xx"

RESUMED2=$(echo "$JOIN2_RESP" | python3 -c "import sys,json;v=json.load(sys.stdin).get('resumedSessionId');print(v if v is not None else 'null')")

if [ "$RESUMED2" != "$SESSION_ID" ]; then
  fail "rejoin should return resumedSessionId=$SESSION_ID; got $RESUMED2"
fi
ok "rejoin  resumedSessionId=$RESUMED2  (correct)"

STUDENT_TOKEN2=$(echo "$JOIN2_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# --- Step 5: GET /api/sessions/{id}/restore → 200 + expected shape ---------

log "POST /api/sessions/$SESSION_ID/restore  (student token)"
RESTORE_RESP=$(
  curl -fsS -X POST "$URL/api/sessions/$SESSION_ID/restore" \
    -H "Authorization: Bearer $STUDENT_TOKEN2" \
    -H "Content-Type: application/json" \
    -d "{}"
) || fail "restore returned non-2xx"

# Validate expected top-level keys.
python3 - <<EOF
import sys, json
data = json.loads('''$RESTORE_RESP''')
for key in ("messages", "workbenchState"):
    if key not in data:
        print(f"restore response missing key: {key}", file=sys.stderr)
        sys.exit(1)
print("restore shape ok")
EOF
ok "restore returned expected shape"

# --- Step 6: teacher resets the session -------------------------------------

log "POST /api/classes/$CLASS_ID/groups/$CODE/reset-session"
HTTP_CODE=$(
  curl -s -o /dev/null -w '%{http_code}' \
    -X POST "$URL/api/classes/$CLASS_ID/groups/$CODE/reset-session" \
    -H "Authorization: Bearer $LOCAL_MODE_TOKEN"
)
if [ "$HTTP_CODE" != "204" ]; then
  fail "reset-session expected 204; got $HTTP_CODE"
fi
ok "session reset  http=204"

# --- Step 7: third join → resumedSessionId must be null (reset) -------------

log "POST /api/auth/group/join  code=$CODE  (post-reset join)"
JOIN3_RESP=$(
  curl -fsS -X POST "$URL/api/auth/group/join" \
    -H "Content-Type: application/json" \
    -d "{\"group_id\": \"$CODE\"}"
) || fail "post-reset join returned non-2xx"

RESUMED3=$(echo "$JOIN3_RESP" | python3 -c "import sys,json;v=json.load(sys.stdin).get('resumedSessionId');print(v if v is not None else 'null')")

if [ "$RESUMED3" != "null" ] && [ "$RESUMED3" != "None" ]; then
  fail "post-reset join should return resumedSessionId=null; got $RESUMED3"
fi
ok "post-reset join  resumedSessionId=null  (correct)"

# --- Done -------------------------------------------------------------------

echo
ok "1.F session-persistence smoke green"
