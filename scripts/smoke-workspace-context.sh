#!/usr/bin/env bash
# scripts/smoke-workspace-context.sh — pin the human-tool-use-cards
# observability pipeline end-to-end against a running LOCAL_MODE backend.
#
# Closes the 2026-05-21 debug gap where backend.log was the only signal
# whether iframe-context POSTs were reaching the agent.
#
# What this exercises:
#   1. POST /api/sessions/{id}/bootstrap        — pre-create ChatSessionIndex
#   2. POST /api/sessions/{id}/iframe-context   — boldkast snapshot
#   3. POST /api/sessions/{id}/iframe-context   — progress snapshot
#   4. GET  /api/sessions/{id}/state            — verify both keys present
#
# Pre-conditions:
#   - `make dev-local` (or equivalent) running on http://localhost:1956
#   - LOCAL_MODE=1 set on the backend
#   - problem-set-hints skill seeded
#
# Exits 0 if all four steps pass, non-zero otherwise. Designed to be
# cheap enough to wire into a pre-deploy gate (~5 requests, <2s).

set -euo pipefail

BACKEND="${BACKEND_URL:-http://localhost:1956}"
TOKEN="${LOCAL_MODE_STUB_TOKEN:-local-mode-stub-token}"
SKILL_SLUG="${SKILL_SLUG:-problem-set-hints}"
SESSION_ID="${SESSION_ID:-smoke-$(date +%s)-$$}"

AUTH=(-H "Authorization: Bearer ${TOKEN}")
CT=(-H "Content-Type: application/json")

echo "smoke-workspace-context — target ${BACKEND}, session ${SESSION_ID}"

# Resolve slug → UUID. The bootstrap endpoint (and skill_config.get_skill
# under the hood) takes the canonical UUID, not the human slug. Mirrors
# what useSlugResolution does on the frontend.
SKILL_ID=$(curl -s "${AUTH[@]}" "${BACKEND}/api/skills" \
  | python3 -c "import json,sys; ss=json.load(sys.stdin); print(next((s['skillId'] for s in (ss if isinstance(ss,list) else ss.get('skills',[])) if s.get('slug')=='${SKILL_SLUG}'), ''))")
if [ -z "$SKILL_ID" ]; then
  echo "FAIL: could not resolve skill slug '${SKILL_SLUG}' to a UUID" >&2
  exit 1
fi
echo "  [resolve] ${SKILL_SLUG} -> ${SKILL_ID}"

# --- 1. Bootstrap -----------------------------------------------------------
code=$(curl -s -o /tmp/sm.boot -w "%{http_code}" -X POST \
  "${AUTH[@]}" "${CT[@]}" \
  -d "{\"skillId\":\"${SKILL_ID}\"}" \
  "${BACKEND}/api/sessions/${SESSION_ID}/bootstrap")
if [ "$code" != "204" ]; then
  echo "FAIL: bootstrap returned ${code}" >&2
  cat /tmp/sm.boot >&2
  exit 1
fi
echo "  [OK] bootstrap → 204"

# --- 2. iframe-context: boldkast --------------------------------------------
code=$(curl -s -o /tmp/sm.bk -w "%{http_code}" -X POST \
  "${AUTH[@]}" "${CT[@]}" \
  -d '{
    "serverId": "boldkast",
    "toolName": "state",
    "structuredContent": {
      "lastEvent": "boldkast.show_value",
      "revealedMarkers": ["y_max"],
      "v0": 15, "theta": 40, "g": 9.82
    }
  }' \
  "${BACKEND}/api/sessions/${SESSION_ID}/iframe-context")
if [ "$code" != "204" ]; then
  echo "FAIL: iframe-context boldkast returned ${code}" >&2
  cat /tmp/sm.bk >&2
  exit 1
fi
echo "  [OK] iframe-context boldkast → 204"

# --- 3. iframe-context: progress --------------------------------------------
code=$(curl -s -o /tmp/sm.pg -w "%{http_code}" -X POST \
  "${AUTH[@]}" "${CT[@]}" \
  -d '{
    "serverId": "progress",
    "toolName": "state",
    "structuredContent": {
      "done": ["a"],
      "items": [{"id":"a","label":"Find v_x og v_y"}],
      "total": 4
    }
  }' \
  "${BACKEND}/api/sessions/${SESSION_ID}/iframe-context")
if [ "$code" != "204" ]; then
  echo "FAIL: iframe-context progress returned ${code}" >&2
  cat /tmp/sm.pg >&2
  exit 1
fi
echo "  [OK] iframe-context progress → 204"

# --- 4. GET state and assert both keys present -----------------------------
state=$(curl -s "${AUTH[@]}" "${BACKEND}/api/sessions/${SESSION_ID}/state")
if ! echo "$state" | grep -q "mcp_app_context.boldkast.state"; then
  echo "FAIL: GET /state missing mcp_app_context.boldkast.state" >&2
  echo "$state" >&2
  exit 1
fi
if ! echo "$state" | grep -q "mcp_app_context.progress.state"; then
  echo "FAIL: GET /state missing mcp_app_context.progress.state" >&2
  echo "$state" >&2
  exit 1
fi
echo "  [OK] GET /state contains both mcp_app_context keys"

echo ""
echo "RESULT: PASS — workspace observability pipeline is healthy."
