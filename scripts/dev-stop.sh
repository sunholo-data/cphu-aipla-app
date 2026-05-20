#!/bin/bash
# AIPLA — stop all local dev services cleanly.
#
# Kills anything listening on the dev ports (backend 1956, frontend 3456,
# sandbox 3457). Use when dev-local.sh died ungracefully and its trap
# didn't fire, or when iterating on the script itself.

set -uo pipefail

BACKEND_PORT=1956
FRONTEND_PORT=3456
SANDBOX_PORT=3457

if [ -t 1 ]; then
    C_GREEN=$'\033[32m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
    C_GREEN=""; C_DIM=""; C_RESET=""
fi

KILLED=0
for PORT in $BACKEND_PORT $FRONTEND_PORT $SANDBOX_PORT; do
    PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        printf 'Stopping :%d (pid %s)…\n' "$PORT" "$PIDS"
        kill $PIDS 2>/dev/null || true
        KILLED=1
    fi
done

if [ "$KILLED" = "0" ]; then
    printf '%sNothing to stop.%s\n' "$C_DIM" "$C_RESET"
else
    sleep 1
    # Confirm
    STILL_UP=""
    for PORT in $BACKEND_PORT $FRONTEND_PORT $SANDBOX_PORT; do
        if lsof -ti ":$PORT" >/dev/null 2>&1; then
            STILL_UP="$STILL_UP $PORT"
        fi
    done
    if [ -z "$STILL_UP" ]; then
        printf '%s✓ All dev ports clear.%s\n' "$C_GREEN" "$C_RESET"
    else
        printf 'Still holding ports:%s — try: kill -9 $(lsof -ti :%s)\n' "$STILL_UP" "${STILL_UP# }"
    fi
fi
