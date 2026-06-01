#!/usr/bin/env bash
# scripts/smoke-v1-teacher-cli.sh — 1.G-Ph3 teacher CLI smoke test.
#
# Drives the full class lifecycle via `aiplatform class` CLI commands
# against a LOCAL_MODE backend (or a deployed URL via $URL).
#
# Steps:
#   1. Create a class (new)
#   2. List classes — verify the new class appears
#   3. Get class by id
#   4. Add a lesson (skills id from GET /api/skills)
#   5. Mint group codes under the class (groups --mint 2)
#   6. List group codes (groups --list)
#   7. Delete the class
#   8. Verify deleted class no longer appears in list
#
# Usage:
#   scripts/smoke-v1-teacher-cli.sh                       # localhost backend on 1956
#   URL=https://aipla-v01-backend-XYZ.a.run.app \
#     AIPLATFORM_ID_TOKEN=<firebase-id-token> \
#     scripts/smoke-v1-teacher-cli.sh
#
# Exits 0 on success; non-zero on any failure.
set -euo pipefail

URL="${URL:-http://localhost:1956}"
# LOCAL_MODE stub token — backend accepts without Firebase verification
AIPLATFORM_ID_TOKEN="${AIPLATFORM_ID_TOKEN:-local-mode-stub-token}"
export AIPLATFORM_ID_TOKEN

# aiplatform CLI resolves --env local → http://localhost:1956.
# For non-local envs set AIPLATFORM_API_URL so the CLI uses $URL.
if [[ "$URL" != "http://localhost:1956" ]]; then
  export AIPLATFORM_API_URL="$URL"
fi

log()  { printf '\033[36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

require() { command -v "$1" >/dev/null 2>&1 || fail "$1 not on PATH"; }
require aiplatform
require python3

log "URL=$URL"

# --- Step 1: create a class -----------------------------------------------

log "aiplatform class new --name 'CLI smoke class'"
CREATE_OUT=$(aiplatform --env local class new --name "CLI smoke class") || fail "class new failed"
CLASS_ID=$(echo "$CREATE_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['classId'])")
[[ -n "$CLASS_ID" ]] || fail "classId missing from new response"
ok "class created  id=$CLASS_ID"

# --- Step 2: list classes — new class must appear -------------------------

log "aiplatform class list"
LIST_OUT=$(aiplatform --env local class list) || fail "class list failed"
echo "$LIST_OUT" | python3 -c "
import sys, json
classes = json.load(sys.stdin).get('classes', [])
ids = [c['classId'] for c in classes]
assert '${CLASS_ID}' in ids, f'${CLASS_ID} not found in list: {ids}'
" || fail "class not found in list output"
ok "class appears in list"

# --- Step 3: get class by id ----------------------------------------------

log "aiplatform class get $CLASS_ID"
GET_OUT=$(aiplatform --env local class get "$CLASS_ID") || fail "class get failed"
GOT_ID=$(echo "$GET_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['classId'])")
[[ "$GOT_ID" == "$CLASS_ID" ]] || fail "get returned wrong classId: $GOT_ID"
ok "class get returned correct id"

# --- Step 4: add a lesson -------------------------------------------------

log "GET /api/skills — resolve a skill to add as lesson"
SKILLS_RESP=$(
  curl -fsS "$URL/api/skills" \
    -H "Authorization: Bearer $AIPLATFORM_ID_TOKEN"
) || fail "GET /api/skills returned non-2xx"
SKILL_ID=$(echo "$SKILLS_RESP" | python3 -c "
import sys, json
skills = json.load(sys.stdin)
if not skills:
    raise SystemExit('no skills returned')
print(skills[0]['skillId'])
") || fail "could not extract skillId"
ok "skill to add: $SKILL_ID"

log "aiplatform class lessons $CLASS_ID --add $SKILL_ID"
aiplatform --env local class lessons "$CLASS_ID" --add "$SKILL_ID" >/dev/null || fail "lessons add failed"
ok "lesson added"

# --- Step 5: mint group codes --------------------------------------------

log "aiplatform class groups $CLASS_ID --mint 2"
MINT_OUT=$(aiplatform --env local class groups "$CLASS_ID" --mint 2) || fail "groups mint failed"
CODES=$(echo "$MINT_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['codes'])")
[[ "$CODES" != "[]" ]] || fail "mint returned empty codes list"
ok "minted codes: $CODES"

# --- Step 6: list group codes --------------------------------------------

log "aiplatform class groups $CLASS_ID --list"
aiplatform --env local class groups "$CLASS_ID" --list >/dev/null || fail "groups list failed"
ok "groups list succeeded"

# --- Step 7: delete class ------------------------------------------------

log "aiplatform class delete $CLASS_ID"
DEL_OUT=$(aiplatform --env local class delete "$CLASS_ID") || fail "class delete failed"
REVOKED=$(echo "$DEL_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('revoked',''))") || fail "could not parse delete response"
[[ "$REVOKED" == "True" ]] || fail "delete response: revoked=$REVOKED (expected True)"
ok "class deleted (revoked=True)"

# --- Step 8: verify gone from list ---------------------------------------

log "aiplatform class list — deleted class should not appear"
LIST2_OUT=$(aiplatform --env local class list) || fail "class list (post-delete) failed"
echo "$LIST2_OUT" | python3 -c "
import sys, json
classes = json.load(sys.stdin).get('classes', [])
ids = [c['classId'] for c in classes if not c.get('revoked', False)]
assert '${CLASS_ID}' not in ids, f'deleted class ${CLASS_ID} still in active list: {ids}'
" || fail "deleted class still visible in list"
ok "deleted class no longer in active list"

printf '\n\033[32m✓ All teacher CLI smoke steps passed.\033[0m\n'
