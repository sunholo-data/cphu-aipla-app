#!/bin/bash
# AIPLA — launch backend + frontend + MCP sandbox in LOCAL_MODE.
#
# Usage: ./scripts/dev-local.sh   (or `make dev-local`)
#
# What you get on a clean checkout:
#   - Backend on http://localhost:1956 (LOCAL_MODE, in-memory Firestore,
#     auto-seeded with the AIPLA platform skills incl. problem-set-hints)
#   - Frontend on http://localhost:3456 (yellow LOCAL_MODE banner)
#   - MCP App sandbox on http://localhost:3457 (separate origin per
#     ADR-013; serves /sandbox.html + /artefacts/<name>/v<version>/)
#   - A known group code `local-demo` pre-seeded so /group join works
#     without curl-ing the admin endpoint (case-insensitive; whitespace
#     tolerant — "Local-Demo" or "LOCAL-DEMO" both work)
#
# Model auth is NOT stubbed. Either:
#   - Set GEMINI_API_KEY=... in backend/.env (Express Mode, no GCP needed)
#   - OR `gcloud auth application-default login` + leave backend/.env's
#     GOOGLE_GENAI_USE_VERTEXAI=True (Vertex AI via ADC)
#
# Companion scripts:
#   ./scripts/dev-status.sh   — probe all three services + LOCAL group
#   ./scripts/dev-stop.sh     — kill everything on the dev ports
#
# Ctrl-C stops everything.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

BACKEND_PORT=1956
FRONTEND_PORT=3456
SANDBOX_PORT=3457
HEALTH_TIMEOUT=60   # seconds to wait for each service to become healthy

# ─── colours (TTY only) ─────────────────────────────────────────────────────
if [ -t 1 ]; then
    C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_GREEN=$'\033[32m'
    C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_RED=$'\033[31m'; C_RESET=$'\033[0m'
else
    C_BOLD=""; C_DIM=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""; C_RED=""; C_RESET=""
fi

log()  { printf '%s[dev-local]%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s⚠%s  %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }

# ─── LOCAL_MODE pinning ─────────────────────────────────────────────────────
export LOCAL_MODE=1
export NEXT_PUBLIC_LOCAL_MODE=1
export AITANA_LOCAL_SESSION=memory
if [ -z "${GROUP_AUTH_SIGNING_SECRET:-}" ]; then
    export GROUP_AUTH_SIGNING_SECRET="local-mode-anon-group-dev-secret-DO-NOT-USE-IN-PROD"
fi

unset GCP_PROJECT GOOGLE_CLOUD_PROJECT GOOGLE_APPLICATION_CREDENTIALS
unset OTEL_EXPORTER_OTLP_ENDPOINT OTEL_EXPORTER_OTLP_PROTOCOL \
      OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE \
      OTEL_LOGS_EXPORTER OTEL_METRICS_EXPORTER OTEL_TRACES_EXPORTER \
      OTEL_LOG_USER_PROMPTS OTEL_RESOURCE_ATTRIBUTES

# Load backend/.env for model auth + AIPLA-specific overrides
# (PLATFORM_OWNER_UID, etc.). LOCAL_MODE pins re-applied below.
ENV_FILE="$REPO_ROOT/backend/.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    export LOCAL_MODE=1
    export AITANA_LOCAL_SESSION=memory
    unset GCP_PROJECT GOOGLE_CLOUD_PROJECT
    unset AGENT_ENGINE_ID
    if [ -n "${GEMINI_API_KEY:-}" ]; then
        export GOOGLE_GENAI_USE_VERTEXAI=false
        unset GOOGLE_API_KEY GOOGLE_GENAI_API_KEY
        log "Using GEMINI_API_KEY (Express Mode) — no GCP project needed."
    elif [ -n "${GOOGLE_API_KEY:-}" ]; then
        unset GOOGLE_API_KEY GOOGLE_GENAI_API_KEY GEMINI_API_KEY
        export GOOGLE_GENAI_USE_VERTEXAI=True
        warn "GOOGLE_API_KEY was set but not unambiguously a Gemini key — falling back to Vertex AI via ADC."
        warn "For Express Mode (no GCP touch): set GEMINI_API_KEY in backend/.env."
    else
        export GOOGLE_GENAI_USE_VERTEXAI=True
        log "Using Vertex AI via ADC. (Set GEMINI_API_KEY in backend/.env for no-GCP Express Mode.)"
    fi
fi

# ─── pre-flight: free ports + install sandbox deps if missing ───────────────
LOG_DIR="$REPO_ROOT/.dev-logs"
mkdir -p "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
SANDBOX_LOG="$LOG_DIR/sandbox.log"

log "Freeing dev ports if held…"
# `-sTCP:LISTEN` + bare `:PORT` don't combine on macOS lsof 4.91, so we
# scope by port via `-iTCP:PORT` and awk-filter the LISTEN row. Without
# this filter, lsof returns ESTABLISHED client PIDs (open Firefox tabs)
# too, and `kill` murders the browser.
listening_pid() {
    lsof -nP -iTCP:"$1" 2>/dev/null | awk '$NF == "(LISTEN)" { print $2 }'
}
for PORT in $BACKEND_PORT $FRONTEND_PORT $SANDBOX_PORT; do
    PIDS=$(listening_pid "$PORT")
    if [ -n "$PIDS" ]; then
        log "  killing server pid(s) on :$PORT — $PIDS"
        kill $PIDS 2>/dev/null || true
    fi
done
# Wait a beat for the OS to actually release the sockets.
sleep 1

SANDBOX_DIR="$REPO_ROOT/infrastructure/mcp-sandbox"
if [ ! -d "$SANDBOX_DIR/node_modules" ]; then
    warn "MCP sandbox node_modules missing — running npm install (first time only)…"
    (cd "$SANDBOX_DIR" && npm install --no-audit --no-fund --loglevel=error >>"$SANDBOX_LOG" 2>&1) \
        || warn "  sandbox npm install failed; check $SANDBOX_LOG"
fi
if [ -d "$SANDBOX_DIR/node_modules" ]; then
    (cd "$SANDBOX_DIR" && npm run build >>"$SANDBOX_LOG" 2>&1) || true
fi

# ─── start services ─────────────────────────────────────────────────────────
cleanup() {
    echo ""
    log "Stopping dev servers…"
    kill "${BACKEND_PID:-}" "${FRONTEND_PID:-}" "${SANDBOX_PID:-}" 2>/dev/null || true
    wait "${BACKEND_PID:-}" "${FRONTEND_PID:-}" "${SANDBOX_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd "$REPO_ROOT/backend" && uv run uvicorn fast_api_app:app \
    --host 127.0.0.1 --port $BACKEND_PORT --reload 2>&1 | tee "$BACKEND_LOG") &
BACKEND_PID=$!

(cd "$REPO_ROOT/frontend" && PORT=$FRONTEND_PORT npm run dev 2>&1 | tee "$FRONTEND_LOG") &
FRONTEND_PID=$!

if [ -d "$SANDBOX_DIR/node_modules" ] && [ -f "$SANDBOX_DIR/public/sandbox.html" ]; then
    (cd "$SANDBOX_DIR" && SANDBOX_PORT=$SANDBOX_PORT \
        ALLOWED_HOST_ORIGINS="http://localhost:${FRONTEND_PORT}" \
        npm run dev 2>&1 | tee "$SANDBOX_LOG") &
    SANDBOX_PID=$!
else
    warn "MCP sandbox not started (no node_modules or no public/sandbox.html). Artefacts won't be reachable locally — they still work in the deployed sandbox."
fi

# ─── health probes ──────────────────────────────────────────────────────────
wait_for_http() {
    # Args: service name, URL, timeout-sec
    local name="$1" url="$2" deadline=$(( $(date +%s) + ${3:-$HEALTH_TIMEOUT} ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
            ok "$name ready ($url)"
            return 0
        fi
        sleep 1
    done
    err "$name failed to come up within ${HEALTH_TIMEOUT}s — see $LOG_DIR/"
    return 1
}

echo ""
log "Waiting for services to become healthy…"
wait_for_http "Backend "   "http://127.0.0.1:${BACKEND_PORT}/health" || true
wait_for_http "Frontend"   "http://127.0.0.1:${FRONTEND_PORT}/api/proxy/health" || true
if [ -n "${SANDBOX_PID:-}" ]; then
    wait_for_http "Sandbox " "http://127.0.0.1:${SANDBOX_PORT}/sandbox.html" 30 || true
fi

# ─── ready banner ───────────────────────────────────────────────────────────
echo ""
printf '%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$C_BOLD" "$C_RESET"
printf '%s  AIPLA — LOCAL_MODE dev servers ready%s\n' "$C_BOLD" "$C_RESET"
printf '%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$C_BOLD" "$C_RESET"
echo ""
printf '  %s→ Open this:%s   %shttp://localhost:%d/group%s\n' "$C_BOLD" "$C_RESET" "$C_GREEN" "$FRONTEND_PORT" "$C_RESET"
printf '  %s→ Group code:%s  %slocal-demo%s   (pre-seeded; pinned to problem-set-hints; case-insensitive)\n' "$C_BOLD" "$C_RESET" "$C_GREEN" "$C_RESET"
echo ""
echo "  Services:"
printf '    Frontend  → http://localhost:%d   %s(yellow LOCAL_MODE banner)%s\n'   $FRONTEND_PORT "$C_DIM" "$C_RESET"
printf '    Backend   → http://localhost:%d   %s(in-memory Firestore)%s\n'        $BACKEND_PORT  "$C_DIM" "$C_RESET"
if [ -n "${SANDBOX_PID:-}" ]; then
    printf '    Sandbox   → http://localhost:%d   %s(MCP App iframe origin)%s\n'    $SANDBOX_PORT  "$C_DIM" "$C_RESET"
fi
echo ""
echo "  Tools:"
printf '    ./scripts/dev-status.sh  — probe all services + LOCAL group  %s(or: make dev-status)%s\n' "$C_DIM" "$C_RESET"
printf '    Ctrl-C                   — stop all services\n'
echo ""
printf '  %sLogs: %s/%s\n' "$C_DIM" "$LOG_DIR" "$C_RESET"
echo ""

wait "$BACKEND_PID" "$FRONTEND_PID"
