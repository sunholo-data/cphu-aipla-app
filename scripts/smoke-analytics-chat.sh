#!/usr/bin/env bash
# scripts/smoke-analytics-chat.sh — end-to-end smoke for the
# analytics-chat skill (sprint ANALYTICS-CHAT-AND-INSIGHTS, M10).
#
# Hits the four surfaces the chat depends on against the dev backend:
#   1. GET  /api/analytics/tools                — six tools listed
#   2. POST /api/analytics/probe/count_messages — owned class returns 200
#   3. POST /api/analytics/probe/count_messages — unowned returns 404
#      with the exact "class not accessible" body (HARD GATE check)
#   4. GET  /api/skills/analytics-chat          — frontmatter `tools:`
#      lists the six tool names (verifies the re-seed picked up M5's
#      SKILL.md change)
#
# Requires:
#   - AIPLATFORM_ID_TOKEN env var (`scripts/mint-test-teacher-token.sh`
#     or `gcloud auth print-identity-token` for a teacher account)
#   - AIPLATFORM_API_URL or pass --url
#   - SMOKE_CLASS_ID env var (a class the test teacher owns)
#   - SMOKE_UNOWNED_CLASS_ID env var (any other id; should refuse)
#
# Usage:
#   scripts/smoke-analytics-chat.sh                  # uses env URL
#   scripts/smoke-analytics-chat.sh https://aipla-v01-XXX.run.app
set -euo pipefail

URL="${1:-${AIPLATFORM_API_URL:-https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app/api/proxy}}"
TOKEN="${AIPLATFORM_ID_TOKEN:-}"
OWNED_CLASS="${SMOKE_CLASS_ID:-}"
UNOWNED_CLASS="${SMOKE_UNOWNED_CLASS_ID:-this-class-does-not-exist}"

if [ -z "$TOKEN" ]; then
  echo "AIPLATFORM_ID_TOKEN required" >&2
  exit 2
fi
if [ -z "$OWNED_CLASS" ]; then
  echo "SMOKE_CLASS_ID required (a class the test teacher owns)" >&2
  exit 2
fi

AUTH="Authorization: Bearer ${TOKEN}"
JSON="Content-Type: application/json"
PASS=0
FAIL=0

check() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name  expected=$expected actual=$actual"
    FAIL=$((FAIL + 1))
  fi
}

echo "== smoke-analytics-chat =="
echo "URL:           $URL"
echo "owned class:   $OWNED_CLASS"
echo "unowned class: $UNOWNED_CLASS"
echo

# (1) /api/analytics/tools
echo "[1] GET /api/analytics/tools"
TOOLS_JSON="$(curl -fsS -H "$AUTH" "$URL/api/analytics/tools")"
COUNT="$(echo "$TOOLS_JSON" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["tools"]))')"
check "six tools registered" "6" "$COUNT"

# (2) owned probe
echo "[2] POST /api/analytics/probe/count_messages (owned)"
STATUS="$(curl -sS -o /tmp/owned_probe.json -w "%{http_code}" -X POST \
  -H "$AUTH" -H "$JSON" \
  -d "{\"class_id\":\"$OWNED_CLASS\",\"kwargs\":{}}" \
  "$URL/api/analytics/probe/count_messages")"
check "owned class returns 200" "200" "$STATUS"

# (3) unowned probe — HARD GATE byte-identical check
echo "[3] POST /api/analytics/probe/count_messages (unowned)"
STATUS="$(curl -sS -o /tmp/unowned_probe.json -w "%{http_code}" -X POST \
  -H "$AUTH" -H "$JSON" \
  -d "{\"class_id\":\"$UNOWNED_CLASS\",\"kwargs\":{}}" \
  "$URL/api/analytics/probe/count_messages")"
check "unowned class returns 404" "404" "$STATUS"
DETAIL="$(python3 -c 'import json; print(json.load(open("/tmp/unowned_probe.json"))["detail"])')"
check "HARD GATE byte-identical detail" "class not accessible" "$DETAIL"

# (4) re-seed verification: skill exposes six tools
echo "[4] GET /api/skills/analytics-chat (re-seed check)"
SKILL_JSON="$(curl -fsS -H "$AUTH" "$URL/api/skills/analytics-chat")"
TOOLS_COUNT="$(echo "$SKILL_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
# Tools may live in metadata.tools or top-level tools depending on
# the serializer version. Accept either path.
tools = d.get("metadata", {}).get("tools") or d.get("tools") or []
print(len(tools))
')"
check "skill frontmatter tools=6" "6" "$TOOLS_COUNT"

echo
echo "== summary: $PASS passed, $FAIL failed =="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
