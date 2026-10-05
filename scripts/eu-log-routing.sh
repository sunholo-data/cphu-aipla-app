#!/usr/bin/env bash
# Keep application logs in the EU — apply AND verify.
#
# WHY
#   Every project's `_Default` log bucket is created in location `global`, and
#   a log bucket's location cannot be changed. AIPLA's application logs include
#   the `aipla_chat_turn` lines (student + tutor text) on their way to the
#   BigQuery research sink, so with the default routing that text sat in a
#   global bucket for 30 days. KU's data-protection review needs it EU-resident.
#
# WHAT IT DOES
#   1. Creates `aipla-logs-eu` in europe-north1 (30-day retention, like _Default).
#   2. Points the `_Default` SINK at it. The sink keeps its filter, so the same
#      logs go to the same kind of place — only the location changes.
#   The `aipla-chat-logs` sink to BigQuery (europe-north1) is a separate sink and
#   is untouched. `_Required` (Google's admin-activity audit logs) cannot be
#   rerouted; it holds no app data.
#
#   Plain `gcloud logging read --project=…` still finds the logs (verified on dev
#   2026-10-05), so scripts/cloud-logs.sh etc. need no change. A routing change
#   takes ~5 minutes to apply.
#
#   Entries already in the global `_Default` bucket stay there until its 30-day
#   retention expires them.
#
# Usage:
#   scripts/eu-log-routing.sh <dev|test|prod>            # verify only (default)
#   scripts/eu-log-routing.sh <dev|test|prod> --apply    # apply, then verify
set -euo pipefail

ENV="${1:-}"
APPLY=0
[[ "${2:-}" == "--apply" ]] && APPLY=1

case "$ENV" in
  dev)  PROJECT="aipla-dev-2026" ;;
  test) PROJECT="aipla-test-2026" ;;
  prod) PROJECT="aipla-prod-2026" ;;
  *) echo "usage: $0 <dev|test|prod> [--apply]" >&2; exit 2 ;;
esac

BUCKET="aipla-logs-eu"
LOCATION="europe-north1"
DEST="logging.googleapis.com/projects/${PROJECT}/locations/${LOCATION}/buckets/${BUCKET}"

echo "=== EU log routing — ${ENV} (${PROJECT}) ==="

if [[ "$APPLY" == "1" ]]; then
  if gcloud logging buckets describe "$BUCKET" --location="$LOCATION" --project="$PROJECT" >/dev/null 2>&1; then
    echo "bucket ${BUCKET} already exists"
  else
    gcloud logging buckets create "$BUCKET" --location="$LOCATION" --retention-days=30 \
      --description="Application logs, EU-resident (the _Default sink's destination; see scripts/eu-log-routing.sh)" \
      --project="$PROJECT"
  fi
  gcloud logging sinks update _Default "$DEST" --project="$PROJECT" >/dev/null
  echo "applied: _Default sink -> ${DEST}"
fi

# Read back. A read failure must fail, not pass.
LOC="$(gcloud logging buckets describe "$BUCKET" --location="$LOCATION" --project="$PROJECT" --format='value(name)' 2>&1)" || {
  echo "FAIL: cannot read bucket ${BUCKET} in ${LOCATION}: ${LOC}" >&2; exit 1; }
GOT="$(gcloud logging sinks describe _Default --project="$PROJECT" --format='value(destination)' 2>&1)" || {
  echo "FAIL: cannot read the _Default sink: ${GOT}" >&2; exit 1; }
if [[ "$GOT" != "$DEST" ]]; then
  echo "FAIL: _Default sink -> ${GOT}" >&2
  echo "      expected ${DEST}. Run: $0 ${ENV} --apply" >&2
  exit 1
fi
echo "OK: _Default sink -> ${DEST}"
