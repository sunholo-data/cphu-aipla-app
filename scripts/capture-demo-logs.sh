#!/usr/bin/env bash
#
# capture-demo-logs.sh — snapshot live Cloud Run logs from a demo/pilot session
# into a durable, append-only JSONL file before they age out of the _Default
# log bucket (30-day retention).
#
# Idempotent: dedupes by Cloud Logging insertId, so it can be polled on a loop
# during a live session and each run only appends genuinely new entries.
#
# Usage:
#   scripts/capture-demo-logs.sh [ENV] [FRESHNESS]
#     ENV        dev | test | prod          (default: dev)
#     FRESHNESS  Cloud Logging --freshness   (default: 10m)
#
# Output:
#   demo-captures/<UTC-date>/raw.jsonl   one JSON log entry per line (deduped)
#   demo-captures/<UTC-date>/seen-ids    insertIds already captured
#   prints a one-line summary + any new >=400 responses to stdout
#
set -euo pipefail

ENV="${1:-dev}"
FRESHNESS="${2:-10m}"

case "$ENV" in
  dev)  PROJECT="aipla-dev-2026"  ;;
  test) PROJECT="aipla-test-2026" ;;
  prod) PROJECT="aipla-prod-2026" ;;
  *) echo "unknown ENV: $ENV (want dev|test|prod)" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAY="$(date -u +%Y-%m-%d)"
OUT_DIR="$REPO_ROOT/demo-captures/$DAY"
RAW="$OUT_DIR/raw.jsonl"
SEEN="$OUT_DIR/seen-ids"
mkdir -p "$OUT_DIR"
touch "$RAW" "$SEEN"

# Pull the window as structured JSON (full entries: httpRequest, payloads, labels, trace).
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
gcloud logging read 'resource.type="cloud_run_revision"' \
  --project="$PROJECT" \
  --freshness="$FRESHNESS" \
  --format=json > "$TMP"

# Flatten to JSONL, drop entries whose insertId we've already stored, append the rest.
NEW="$(jq -c --rawfile seen "$SEEN" '
  ($seen | split("\n") | map(select(length>0)) | INDEX(.)) as $seenset
  | .[] | select(($seenset[.insertId] // null) == null)
' "$TMP")"

NEW_COUNT=0
if [[ -n "$NEW" ]]; then
  printf '%s\n' "$NEW" >> "$RAW"
  printf '%s\n' "$NEW" | jq -r '.insertId' >> "$SEEN"
  NEW_COUNT="$(printf '%s\n' "$NEW" | grep -c '' || true)"
fi

TOTAL="$(grep -c '' "$RAW" || true)"
echo "[$ENV] +${NEW_COUNT} new entries (last $FRESHNESS) -> $RAW (total: $TOTAL)"

# Surface any new >=400 HTTP responses this run (the thing worth flagging live).
if [[ -n "$NEW" ]]; then
  ERRS="$(printf '%s\n' "$NEW" \
    | jq -r 'select(.httpRequest.status >= 400)
             | [.timestamp, (.httpRequest.status|tostring), .httpRequest.requestMethod, .httpRequest.requestUrl]
             | @tsv' 2>/dev/null || true)"
  if [[ -n "$ERRS" ]]; then
    echo "--- NEW >=400 responses this run ---"
    echo "$ERRS"
  fi
fi
