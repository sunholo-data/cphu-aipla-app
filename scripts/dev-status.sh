#!/bin/bash
# AIPLA — probe the local dev stack and print what's healthy.
#
# Reports for each service:
#   - whether the port is listening
#   - HTTP probe result
#   - quick functional check (e.g. LOCAL group still valid, problem-set-hints
#     skill present)
#
# Exit code: 0 if all three core services (backend/frontend/sandbox) are
# healthy AND the LOCAL group joins cleanly; 1 otherwise. Suitable for
# scripting / pre-flight checks.

set -uo pipefail

BACKEND_PORT=1956
FRONTEND_PORT=3456
SANDBOX_PORT=3457

if [ -t 1 ]; then
    C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_GREEN=$'\033[32m'
    C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_RESET=$'\033[0m'
else
    C_BOLD=""; C_DIM=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi

EXIT_CODE=0
note_fail() { EXIT_CODE=1; }

ok()   { printf '  %s✓%s  %s\n' "$C_GREEN"  "$C_RESET" "$*"; }
warn() { printf '  %s⚠%s   %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail() { printf '  %s✗%s  %s\n' "$C_RED"    "$C_RESET" "$*"; note_fail; }

probe_port() {
    # Returns 0 if listening
    lsof -ti ":$1" >/dev/null 2>&1
}

probe_http() {
    # Args: URL  → echo status code; 000 on connection failure
    curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$1" 2>/dev/null
}

section() { printf '\n%s%s%s\n' "$C_BOLD" "$1" "$C_RESET"; }

# ─── Backend ────────────────────────────────────────────────────────────────
section "Backend (http://localhost:${BACKEND_PORT})"
if ! probe_port "$BACKEND_PORT"; then
    fail "port ${BACKEND_PORT} not listening — backend not running"
else
    HEALTH=$(probe_http "http://127.0.0.1:${BACKEND_PORT}/health")
    if [ "$HEALTH" = "200" ]; then
        ok "/health returns 200"
    else
        fail "/health returned $HEALTH"
    fi
    SKILL_JSON=$(curl -s --max-time 3 "http://127.0.0.1:${BACKEND_PORT}/api/skills/marketplace" 2>/dev/null || echo "")
    if echo "$SKILL_JSON" | grep -q '"name":"problem-set-hints"'; then
        OWNER=$(echo "$SKILL_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); psh=[s for s in d if s.get('name')=='problem-set-hints']; print(psh[0]['ownerId'] if psh else '')" 2>/dev/null || echo "")
        ok "problem-set-hints skill seeded (ownerId=${OWNER:-?})"
    else
        fail "problem-set-hints skill not in marketplace — LOCAL_MODE seed didn't run, or PLATFORM_OWNER_UID drift"
    fi
fi

# ─── Frontend ───────────────────────────────────────────────────────────────
section "Frontend (http://localhost:${FRONTEND_PORT})"
if ! probe_port "$FRONTEND_PORT"; then
    fail "port ${FRONTEND_PORT} not listening — frontend not running"
else
    PROXY_HEALTH=$(probe_http "http://127.0.0.1:${FRONTEND_PORT}/api/proxy/health")
    if [ "$PROXY_HEALTH" = "200" ]; then
        ok "/api/proxy/health returns 200 (proxy → backend wired)"
    else
        fail "/api/proxy/health returned $PROXY_HEALTH"
    fi
    GROUP_PAGE=$(probe_http "http://127.0.0.1:${FRONTEND_PORT}/group")
    if [ "$GROUP_PAGE" = "200" ]; then
        ok "/group page serves 200"
    else
        warn "/group returned $GROUP_PAGE (expected 200)"
    fi
fi

# ─── Sandbox ────────────────────────────────────────────────────────────────
section "MCP App sandbox (http://localhost:${SANDBOX_PORT})"
if ! probe_port "$SANDBOX_PORT"; then
    warn "port ${SANDBOX_PORT} not listening — sandbox not running"
    warn "  artefacts unreachable locally; they still work in the deployed sandbox"
else
    SANDBOX_HEALTH=$(probe_http "http://127.0.0.1:${SANDBOX_PORT}/sandbox.html")
    if [ "$SANDBOX_HEALTH" = "200" ]; then
        ok "/sandbox.html returns 200"
    else
        fail "/sandbox.html returned $SANDBOX_HEALTH"
    fi
fi

# ─── LOCAL group join ───────────────────────────────────────────────────────
section "LOCAL group code"
if probe_port "$BACKEND_PORT"; then
    JOIN=$(curl -s --max-time 3 -X POST "http://127.0.0.1:${BACKEND_PORT}/api/auth/group/join" \
        -H "Content-Type: application/json" -d '{"group_id":"LOCAL"}' 2>/dev/null || echo "")
    if echo "$JOIN" | grep -q '"token":'; then
        SKILL_COUNT=$(echo "$JOIN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('skill_ids',[])))" 2>/dev/null || echo "?")
        ok "POST /api/auth/group/join {\"group_id\":\"LOCAL\"} → token (skill_ids: $SKILL_COUNT)"
    else
        fail "LOCAL group join failed — seed didn't run, or PLATFORM_OWNER_UID drift"
    fi
else
    fail "skipped — backend not running"
fi

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
if [ "$EXIT_CODE" = "0" ]; then
    printf '%s✓ All checks passed — open %shttp://localhost:%s/group%s and use code %sLOCAL%s\n' \
        "$C_GREEN" "$C_BOLD" "$FRONTEND_PORT" "$C_RESET$C_GREEN" "$C_BOLD" "$C_RESET"
else
    printf '%s✗ One or more checks failed.%s Start with: ./scripts/dev-local.sh\n' "$C_RED" "$C_RESET"
fi

exit "$EXIT_CODE"
