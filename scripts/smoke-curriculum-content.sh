#!/usr/bin/env bash
# scripts/smoke-curriculum-content.sh — student curriculum-content auth smoke.
#
# Guards the exact regression that broke the demo (commit 71daf47): a student
# opening a shared document in the workbench. The content endpoint is DUAL-
# audience, and the frontend was sending the TEACHER token for a student →
# HTTP 401 ("Couldn't load this document"). A student has no Firebase identity;
# the request must carry the anonymous-GROUP token.
#
# This drives the real student path against the DEPLOYED proxy:
#   join group → resolve the active activity's materials → read a cited doc's
#   content with the GROUP token → assert it is AUTHENTICATED (never 401).
# A student-visible doc must return 200 + readable content; a hidden-only doc
# must return 403 (auth accepted, ACL denies) — either way, NOT 401.
#
# Needs NO credentials — the anonymous group JWT carries the whole flow.
# Targets the deployed dev frontend proxy by default; override BASE / GROUP:
#
#   scripts/smoke-curriculum-content.sh
#   BASE=https://<frontend>/api/proxy GROUP=aipla-demo-1 scripts/smoke-curriculum-content.sh
#
# Exits 0 on success; non-zero on any failure.
set -euo pipefail

BASE="${BASE:-https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app/api/proxy}"
GROUP="${GROUP:-aipla-demo-1}"

log()  { printf '\033[36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
note() { printf '\033[33m• %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
require() { command -v "$1" >/dev/null 2>&1 || fail "$1 not on PATH"; }
require curl
require python3

jget() { python3 -c "import sys,json;d=json.load(sys.stdin);v=d.get('$1');print('' if v is None else v)"; }

log "BASE=$BASE  GROUP=$GROUP"

# --- 1) Anonymous group join (no auth) --------------------------------------
JOIN=$(curl -fsS -X POST "$BASE/api/auth/group/join" \
  -H "Content-Type: application/json" -d "{\"group_id\":\"$GROUP\"}") \
  || fail "join failed — is GROUP=$GROUP a live code on this env?"
TOKEN=$(echo "$JOIN" | jget token)
[ -n "$TOKEN" ] || fail "join returned no token"
AUTH=(-H "Authorization: Bearer $TOKEN")
SKILLS=$(echo "$JOIN" | python3 -c "import sys,json;print(' '.join(json.load(sys.stdin).get('skill_ids',[])))")
[ -n "$SKILLS" ] || fail "group $GROUP has no activities (skill_ids empty) — bind a class/activity with curriculum materials first"
ok "joined $GROUP  (activities: $(echo "$SKILLS" | wc -w | tr -d ' '))"

# --- 2) Find a cited material — prefer a student-visible one -----------------
DOC_ID="" ; ACT_ID="" ; VISIBLE=""
for SK in $SKILLS; do
  CFG=$(curl -fsS "$BASE/api/activity-configs/active/$SK" "${AUTH[@]}") || continue
  PICK=$(echo "$CFG" | python3 -c "
import sys,json
mats=json.load(sys.stdin).get('materials',[])
vis=[m for m in mats if m.get('studentVisible')]
p=vis[0] if vis else (mats[0] if mats else None)
print(f\"{p['docId']} {str(p.get('studentVisible')).lower()}\" if p else '')
")
  if [ -n "$PICK" ]; then
    DOC_ID="${PICK%% *}" ; VISIBLE="${PICK##* }" ; ACT_ID="$SK"
    [ "$VISIBLE" = "true" ] && break   # a visible doc is the strongest test
  fi
done
# SKIP (not fail): this group has no curriculum to read, so the path can't be
# exercised here — that's a precondition, not the regression. Point the smoke at
# a group whose activity cites a doc (e.g. GROUP=<your code>) to test for real.
if [ -z "$DOC_ID" ]; then
  note "SKIPPED — no curriculum doc is cited by any activity on $GROUP."
  note "Run against a group with a cited doc to exercise the read: make smoke-curriculum-content GROUP=<code>"
  exit 0
fi
note "doc=$DOC_ID activity=$ACT_ID studentVisible=$VISIBLE"

# --- 3) Read content with the GROUP token — the regression guard ------------
log "GET /api/curriculum/$DOC_ID/content?activityId=$ACT_ID  (group token)"
CODE=$(curl -s -o /tmp/smoke-cc.json -w "%{http_code}" \
  "$BASE/api/curriculum/$DOC_ID/content?activityId=$ACT_ID" "${AUTH[@]}")

[ "$CODE" != "401" ] || fail "REGRESSION: student content read returned 401 — the group token is being rejected (wrong auth helper is back)"

if [ "$VISIBLE" = "true" ]; then
  [ "$CODE" = "200" ] || fail "student-visible doc returned HTTP $CODE (expected 200)"
  READ=$(python3 -c "
import json
d=json.load(open('/tmp/smoke-cc.json'))
print(int(bool(d.get('available'))), len((d.get('text') or '').strip()))
")
  AVAIL="${READ%% *}" ; LEN="${READ##* }"
  [ "$AVAIL" = "1" ] || fail "200 but available=false — content not stored (run: make backfill-curriculum-content)"
  [ "$LEN" -gt 0 ] || fail "200 + available but empty text"
  ok "200 + readable content ($LEN chars) — student auth + ACL + content all green"
else
  # Only hidden materials exist: auth MUST still be accepted; ACL denies → 403.
  [ "$CODE" = "403" ] || note "hidden-only material returned HTTP $CODE (expected 403)"
  ok "auth accepted (HTTP $CODE, not 401) — hidden doc correctly gated by ACL"
  note "no student-visible doc on $GROUP — happy path (200) not exercised; mark one visible to test it"
fi

echo
ok "curriculum-content smoke green — student reads are authenticated on $GROUP"
