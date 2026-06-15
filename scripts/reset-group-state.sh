#!/usr/bin/env bash
# scripts/reset-group-state.sh — wipe anonymous-group session state for a
# clean slate. Built 2026-06-15 after the June-13 uid-scheme change orphaned
# pre-existing group sessions: the group→session pointer is first-wins with a
# 30-day TTL, so reused codes kept resuming a session whose owner_uid was the
# OLD synthetic-uid scheme, and history (saved under one uid) was unreadable
# by the reader (querying under the other). See the conversation/notes.
#
# Collections:
#   group_sessions  — group_id -> active session pointer (THE thing to clear;
#                     clearing it makes every code start a fresh session owned
#                     by the current stable uid). Always wiped.
#   chat_sessions   — per-session metadata mirror (title, turnCount, owner).
#                     Optional (--sessions): clears orphan/old session docs so
#                     teacher listings are clean. Does NOT delete the ADK event
#                     store in Agent Engine — those orphan harmlessly.
#   anon_groups     — the group codes themselves (code -> class binding).
#                     Optional (--groups): wiping invalidates ALL existing
#                     codes (joins 404). Only use for a full reset.
#
# Usage:
#   scripts/reset-group-state.sh dev               # group_sessions only (safe default)
#   scripts/reset-group-state.sh dev --sessions    # + chat_sessions
#   scripts/reset-group-state.sh dev --sessions --groups   # full nuke (invalidates codes)
#   scripts/reset-group-state.sh dev --yes         # skip the confirm prompt
#
# Pre-reqs: gcloud auth with Firestore write (datastore.user) on the env's project.
set -euo pipefail

ENV="${1:-dev}"; shift || true
WIPE_SESSIONS=0
WIPE_GROUPS=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --sessions) WIPE_SESSIONS=1 ;;
    --groups)   WIPE_GROUPS=1 ;;
    --yes|-y)   ASSUME_YES=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

case "$ENV" in
  dev)  PROJECT="aipla-dev-2026" ;;
  test) PROJECT="aipla-test-2026" ;;
  prod) PROJECT="aipla-prod-2026" ;;
  *) echo "Unknown env: $ENV (use dev|test|prod)" >&2; exit 2 ;;
esac

command -v gcloud  >/dev/null 2>&1 || { echo "gcloud not on PATH" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "python3 not on PATH" >&2; exit 2; }

TOKEN="$(gcloud auth print-access-token 2>/dev/null)"
[ -n "$TOKEN" ] || { echo "empty access token — run 'gcloud auth login'" >&2; exit 1; }
BASE="https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents"

# Build the collection list per flags.
COLLECTIONS=("group_sessions")
[ "$WIPE_SESSIONS" = 1 ] && COLLECTIONS+=("chat_sessions")
[ "$WIPE_GROUPS" = 1 ]   && COLLECTIONS+=("anon_groups")

echo "== reset-group-state =="
echo "env:         $ENV ($PROJECT)"
echo "collections: ${COLLECTIONS[*]}"
[ "$WIPE_GROUPS" = 1 ] && echo "WARNING: --groups wipes anon_groups — ALL existing join codes will 404."
echo

if [ "$ASSUME_YES" != 1 ]; then
  read -r -p "Delete every document in those collections on $ENV? [y/N] " ans
  case "$ans" in y|Y|yes|YES) ;; *) echo "aborted."; exit 0 ;; esac
fi

# List all document resource names in a collection (handles >300 via the
# select-__name__ projection; one query, limit 10000 is plenty here).
list_doc_names() {
  local col="$1"
  curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    "${BASE}:runQuery" \
    -d "{\"structuredQuery\":{\"from\":[{\"collectionId\":\"${col}\"}],\"select\":{\"fields\":[{\"fieldPath\":\"__name__\"}]},\"limit\":10000}}" \
    | python3 -c "import sys,json
for r in json.load(sys.stdin):
    d=r.get('document')
    if d: print(d['name'])"
}

total=0
for col in "${COLLECTIONS[@]}"; do
  echo "-- $col --"
  seen=0
  deleted=0
  # Process-substitution + while-read keeps the loop in the current shell
  # (so counters persist) and avoids mapfile (absent in macOS bash 3.2).
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    seen=$((seen+1))
    code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
      -H "Authorization: Bearer $TOKEN" \
      "https://firestore.googleapis.com/v1/${name}")
    if [ "$code" = "200" ]; then
      deleted=$((deleted+1))
    else
      echo "  WARN delete $code for ${name##*/}" >&2
    fi
  done < <(list_doc_names "$col")
  if [ "$seen" = 0 ]; then echo "  (empty)"; else echo "  deleted $deleted/$seen"; fi
  total=$((total+deleted))
done

echo
echo "== done: $total documents deleted =="
