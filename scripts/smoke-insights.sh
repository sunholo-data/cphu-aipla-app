#!/usr/bin/env bash
# scripts/smoke-insights.sh — end-to-end smoke for the insights dashboard
# (sprint ANALYTICS-CHAT-AND-INSIGHTS, M10).
#
# Hits all five /api/insights/* routes against the dev backend plus a
# cross-tenant refusal check per route. The HARD GATE check at the
# per-class routes is the load-bearing assertion — a cross-tenant
# probe must return a 404 with the byte-identical "class not accessible"
# body, same as a class that doesn't exist.
#
# Requires:
#   - AIPLATFORM_ID_TOKEN env var
#   - SMOKE_CLASS_ID env var (a class the test teacher owns)
#   - SMOKE_UNOWNED_CLASS_ID env var (defaults to a missing-class id)
#
# Usage:
#   scripts/smoke-insights.sh                                # uses env URL
#   scripts/smoke-insights.sh https://aipla-v01-XXX.run.app
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

echo "== smoke-insights =="
echo "URL:           $URL"
echo "owned class:   $OWNED_CLASS"
echo "unowned class: $UNOWNED_CLASS"
echo

# --- non-per-class routes ---
echo "[1] GET /api/insights/summary"
STATUS="$(curl -sS -o /tmp/smoke_summary.json -w "%{http_code}" -H "$AUTH" "$URL/api/insights/summary")"
check "summary returns 200" "200" "$STATUS"

echo "[2] GET /api/insights/compare"
STATUS="$(curl -sS -o /tmp/smoke_compare.json -w "%{http_code}" -H "$AUTH" "$URL/api/insights/compare")"
check "compare returns 200" "200" "$STATUS"

# --- per-class routes ---
for route in kpis groups activities trend; do
  echo "[3.$route] owned class /classes/$OWNED_CLASS/$route"
  STATUS="$(curl -sS -o /tmp/smoke_${route}.json -w "%{http_code}" \
    -H "$AUTH" "$URL/api/insights/classes/$OWNED_CLASS/$route")"
  check "owned $route returns 200" "200" "$STATUS"

  echo "[4.$route] unowned class /classes/$UNOWNED_CLASS/$route (HARD GATE)"
  STATUS="$(curl -sS -o /tmp/smoke_${route}_unowned.json -w "%{http_code}" \
    -H "$AUTH" "$URL/api/insights/classes/$UNOWNED_CLASS/$route")"
  check "unowned $route returns 404" "404" "$STATUS"
  DETAIL="$(python3 -c "import json; print(json.load(open('/tmp/smoke_${route}_unowned.json'))['detail'])")"
  check "HARD GATE detail for $route" "class not accessible" "$DETAIL"
done

# Assert _debug.queries is present so the frontend's Show-data
# disclosure has something to render.
echo "[5] /summary response carries _debug payload"
HAS_DEBUG="$(python3 -c '
import json
d = json.load(open("/tmp/smoke_summary.json"))
print("yes" if "_debug" in d else "no")
')"
check "summary has _debug" "yes" "$HAS_DEBUG"

echo
echo "== summary: $PASS passed, $FAIL failed =="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
