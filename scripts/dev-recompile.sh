#!/bin/bash
# AIPLA — soft restart of just the frontend (Next.js).
#
# Use when the chat page (or any other route) starts returning 500 with:
#   - "Cannot find module './NNN.js'"
#   - "Cannot read properties of undefined (reading '/_app')"
#   - "Failed to collect page data for /chat/..."
#   - Other webpack-runtime / .next-cache-stale signatures
#
# Soft fix: kills ONLY the frontend listener on :3456, clears .next, and
# restarts the dev server. Backend (1956), MCP sandbox (3457), and your
# open Firefox tabs are untouched — you just hard-refresh (Cmd-Shift-R)
# once the server is back up.
#
# When to use this vs `make dev-local`:
#   - dev-recompile: mid-session frontend wedge, want to keep backend
#     state / browser session / sandbox running
#   - dev-local: starting fresh OR backend code changed too OR you need
#     to re-seed the in-memory fixtures
#
# Exit 0 when frontend is healthy again. The script blocks until either
# /api/proxy/health returns 200 or 30s elapses.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_PORT=3456

if [ -t 1 ]; then
    C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_RESET=$'\033[0m'
else
    C_BOLD=""; C_DIM=""; C_GREEN=""; C_RED=""; C_RESET=""
fi

# Listening PID only (NOT client connections — see dev-stop.sh comment).
FE_PID=$(lsof -nP -iTCP:$FRONTEND_PORT 2>/dev/null | awk '$NF == "(LISTEN)" { print $2 }')
if [ -n "$FE_PID" ]; then
    printf '%s[dev-recompile]%s Killing frontend listener (pid %s)\n' "$C_BOLD" "$C_RESET" "$FE_PID"
    kill "$FE_PID" 2>/dev/null || true
    sleep 2
else
    printf '%s[dev-recompile]%s No frontend listener on :%d — nothing to kill\n' "$C_BOLD" "$C_RESET" "$FRONTEND_PORT"
fi

if [ -d "$REPO_ROOT/frontend/.next" ]; then
    printf '%s[dev-recompile]%s Clearing %s/frontend/.next\n' "$C_BOLD" "$C_RESET" "$REPO_ROOT"
    rm -rf "$REPO_ROOT/frontend/.next"
fi

# Restart frontend. The env vars mirror what scripts/dev-local.sh sets,
# so the new server has the same LOCAL_MODE / auth-mode shape as before.
printf '%s[dev-recompile]%s Restarting frontend (logs → .dev-logs/frontend.log)\n' "$C_BOLD" "$C_RESET"
LOG_DIR="$REPO_ROOT/.dev-logs"
mkdir -p "$LOG_DIR"
(
    cd "$REPO_ROOT/frontend"
    PORT=$FRONTEND_PORT \
        NEXT_PUBLIC_LOCAL_MODE=1 \
        NEXT_PUBLIC_AUTH_MODE=anonymous_group_id \
        NEXT_PUBLIC_POST_JOIN_REDIRECT=/chat/@aipla-platform/problem-set-hints \
        NEXT_PUBLIC_MCP_SANDBOX_URL=http://localhost:3457/sandbox.html \
        nohup npm run dev >"$LOG_DIR/frontend.log" 2>&1 &
    disown
)

# Wait for /api/proxy/health (up to 30s).
DEADLINE=$(( $(date +%s) + 30 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$FRONTEND_PORT/api/proxy/health" 2>/dev/null; then
        printf '%s✓%s frontend healthy. Hard-reload your browser tab (Cmd-Shift-R) to clear stale JS.\n' "$C_GREEN" "$C_RESET"
        exit 0
    fi
    sleep 1
done

printf '%s✗%s frontend did not come up within 30s. Check %s/frontend.log\n' "$C_RED" "$C_RESET" "$LOG_DIR"
exit 1
