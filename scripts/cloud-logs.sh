#!/bin/bash
# AIPLA — fetch Cloud Run + Cloud Trace logs for the deployed services.
#
# Usage:
#   ./scripts/cloud-logs.sh                      # tail frontend (ui+sidecar) live
#   ./scripts/cloud-logs.sh tail                 # same as above
#   ./scripts/cloud-logs.sh tail backend         # backend sidecar only
#   ./scripts/cloud-logs.sh tail frontend        # frontend ui only
#   ./scripts/cloud-logs.sh tail sandbox         # mcp-sandbox service
#   ./scripts/cloud-logs.sh errors               # last 50 errors across all services
#   ./scripts/cloud-logs.sh session <id>         # everything tagged with this session_id
#   ./scripts/cloud-logs.sh trace <session_id>   # open Cloud Trace UI filtered to this session
#   ./scripts/cloud-logs.sh build                # the most recent Cloud Build (tail or last status)
#   ./scripts/cloud-logs.sh save [errors|tail]   # dump to .dev-logs/cloud-<service>-<timestamp>.log
#
# Defaults to project aipla-dev-2026. Override via:
#   AIPLA_ENV=test ./scripts/cloud-logs.sh tail
#   AIPLA_PROJECT=aipla-test-2026 ./scripts/cloud-logs.sh tail

set -uo pipefail

# ─── Env resolution ─────────────────────────────────────────────────────────
ENV="${AIPLA_ENV:-dev}"
case "$ENV" in
    dev)
        PROJECT="${AIPLA_PROJECT:-aipla-dev-2026}"
        REGION="europe-north1"
        FRONTEND="aipla-v01-frontend"
        SANDBOX="aipla-v01-sandbox"
        ;;
    test|prod)
        echo "ERROR: env=$ENV not cut yet; only dev exists. Set AIPLA_PROJECT explicitly." >&2
        exit 2
        ;;
    *)
        PROJECT="${AIPLA_PROJECT:?Set AIPLA_PROJECT for env=$ENV}"
        REGION="${AIPLA_REGION:-europe-north1}"
        FRONTEND="${AIPLA_FRONTEND_SERVICE:-aipla-v01-frontend}"
        SANDBOX="${AIPLA_SANDBOX_SERVICE:-aipla-v01-sandbox}"
        ;;
esac

CMD="${1:-tail}"
TARGET="${2:-frontend}"

# ─── Colours (TTY only) ─────────────────────────────────────────────────────
if [ -t 1 ]; then
    C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_GREEN=$'\033[32m'; C_RESET=$'\033[0m'
else
    C_BOLD=""; C_DIM=""; C_RED=""; C_YELLOW=""; C_GREEN=""; C_RESET=""
fi

banner() {
    printf '%s[cloud-logs]%s %s (project=%s, region=%s)\n' \
        "$C_BOLD" "$C_RESET" "$1" "$PROJECT" "$REGION"
}

# ─── tail — stream logs in real time ────────────────────────────────────────
do_tail() {
    case "$TARGET" in
        frontend|ui)
            banner "Tailing ${FRONTEND} (frontend container only)"
            gcloud beta logging tail \
                "resource.type=cloud_run_revision AND resource.labels.service_name=${FRONTEND} AND labels.\"run.googleapis.com/container_name\"=\"ui\"" \
                --project="$PROJECT" --format='value(timestamp,severity,textPayload,jsonPayload.message)'
            ;;
        backend|sidecar)
            banner "Tailing ${FRONTEND} (backend sidecar container)"
            gcloud beta logging tail \
                "resource.type=cloud_run_revision AND resource.labels.service_name=${FRONTEND} AND labels.\"run.googleapis.com/container_name\"=\"backend\"" \
                --project="$PROJECT" --format='value(timestamp,severity,textPayload,jsonPayload.message)'
            ;;
        sandbox)
            banner "Tailing ${SANDBOX} (MCP App sandbox)"
            gcloud beta logging tail \
                "resource.type=cloud_run_revision AND resource.labels.service_name=${SANDBOX}" \
                --project="$PROJECT" --format='value(timestamp,severity,textPayload,jsonPayload.message)'
            ;;
        all)
            banner "Tailing ALL AIPLA services"
            gcloud beta logging tail \
                "resource.type=cloud_run_revision AND (resource.labels.service_name=${FRONTEND} OR resource.labels.service_name=${SANDBOX})" \
                --project="$PROJECT" --format='value(timestamp,resource.labels.service_name,labels."run.googleapis.com/container_name",severity,textPayload,jsonPayload.message)'
            ;;
        *)
            echo "Unknown tail target: $TARGET (use: frontend|backend|sandbox|all)" >&2
            exit 1
            ;;
    esac
}

# ─── errors — last N error-severity entries ─────────────────────────────────
do_errors() {
    local limit="${TARGET:-50}"
    case "$limit" in ''|*[!0-9]*) limit=50 ;; esac
    banner "Last ${limit} errors across AIPLA services (severity>=ERROR)"
    gcloud logging read \
        "resource.type=cloud_run_revision AND (resource.labels.service_name=${FRONTEND} OR resource.labels.service_name=${SANDBOX}) AND severity>=ERROR" \
        --project="$PROJECT" \
        --limit="$limit" \
        --order=desc \
        --format='value(timestamp,resource.labels.service_name,severity,textPayload,jsonPayload.message)'
}

# ─── session — everything tagged with this group_id / session_id ────────────
do_session() {
    local sid="${TARGET:-}"
    if [ -z "$sid" ]; then
        echo "Usage: $0 session <session-or-group-id>" >&2
        exit 1
    fi
    banner "Logs mentioning ${sid} (group_id / session_id / threadId)"
    gcloud logging read \
        "resource.type=cloud_run_revision AND (resource.labels.service_name=${FRONTEND} OR resource.labels.service_name=${SANDBOX}) AND (textPayload:\"${sid}\" OR jsonPayload.message:\"${sid}\" OR jsonPayload.group_id=\"${sid}\" OR jsonPayload.session_id=\"${sid}\")" \
        --project="$PROJECT" \
        --limit=200 \
        --order=desc \
        --format='value(timestamp,resource.labels.service_name,severity,textPayload,jsonPayload.message)'
}

# ─── trace — open Cloud Trace UI for a session ──────────────────────────────
do_trace() {
    local sid="${TARGET:-}"
    if [ -z "$sid" ]; then
        echo "Usage: $0 trace <session-or-group-id>" >&2
        exit 1
    fi
    local url="https://console.cloud.google.com/traces/list?project=${PROJECT}&tid=&pageState=(%22groupId%22:(%22f%22:%22${sid}%22))"
    banner "Opening Cloud Trace UI filtered to ${sid}"
    printf '  %s\n' "$url"
    if command -v open >/dev/null 2>&1; then
        open "$url"
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url"
    else
        printf '%sOpen the URL above in your browser.%s\n' "$C_DIM" "$C_RESET"
    fi
}

# ─── build — last Cloud Build status / log ──────────────────────────────────
do_build() {
    banner "Recent AIPLA Cloud Builds"
    gcloud builds list --project="$PROJECT" --region="$REGION" --limit=5 \
        --format='table(id,status,createTime,duration,substitutions._SERVICE_NAME)'
    echo
    local last_id
    last_id=$(gcloud builds list --project="$PROJECT" --region="$REGION" --limit=1 --format='value(id)')
    if [ -n "$last_id" ]; then
        printf '%sLatest build log (id=%s):%s\n' "$C_DIM" "$last_id" "$C_RESET"
        gcloud builds log "$last_id" --project="$PROJECT" --region="$REGION" 2>&1 | tail -30
    fi
}

# ─── save — dump a finite slice to .dev-logs/ ───────────────────────────────
do_save() {
    local kind="${TARGET:-errors}"
    local ts; ts=$(date +%Y%m%d-%H%M%S)
    mkdir -p .dev-logs
    local out=".dev-logs/cloud-${kind}-${ts}.log"
    case "$kind" in
        errors)
            banner "Dumping last 200 errors to ${out}"
            gcloud logging read \
                "resource.type=cloud_run_revision AND (resource.labels.service_name=${FRONTEND} OR resource.labels.service_name=${SANDBOX}) AND severity>=ERROR" \
                --project="$PROJECT" --limit=200 --order=desc > "$out"
            ;;
        all|recent)
            banner "Dumping last 500 log entries to ${out}"
            gcloud logging read \
                "resource.type=cloud_run_revision AND (resource.labels.service_name=${FRONTEND} OR resource.labels.service_name=${SANDBOX})" \
                --project="$PROJECT" --limit=500 --order=desc > "$out"
            ;;
        *)
            echo "Unknown save kind: $kind (use: errors|all)" >&2
            exit 1
            ;;
    esac
    printf '%s✓ saved to %s%s\n' "$C_GREEN" "$out" "$C_RESET"
    wc -l "$out"
}

case "$CMD" in
    tail)     do_tail ;;
    errors)   do_errors ;;
    session)  do_session ;;
    trace)    do_trace ;;
    build)    do_build ;;
    save)     do_save ;;
    *)
        echo "Usage: $0 {tail|errors|session <id>|trace <id>|build|save} [target]" >&2
        exit 1
        ;;
esac
