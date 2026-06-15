#!/usr/bin/env bash
# scripts/smoke-chat-resume.sh — chat RESUME / history-readback smoke.
#
# Guards the exact path that silently broke before a demo: a student joins a
# group, the tutor greets + turns are taken, and on RELOAD the history must
# load back. This drives a REAL tutor turn and reads it back through the SAME
# endpoint the frontend reload uses (`GET /api/sessions/{id}/messages`), TWICE
# (the second read simulates the page reload), asserting the turns persist and
# the readback is stable.
#
# Needs NO credentials — the anonymous group JWT carries the whole flow.
# Targets the DEPLOYED dev frontend proxy by default (the real demo target);
# override BASE / GROUP / SKILL_SLUG:
#
#   scripts/smoke-chat-resume.sh
#   BASE=https://<frontend>/api/proxy GROUP=aipla-demo-1 scripts/smoke-chat-resume.sh
#
# Exits 0 on success; non-zero on any failure.
set -euo pipefail

BASE="${BASE:-https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app/api/proxy}"
GROUP="${GROUP:-aipla-demo-1}"
SKILL_SLUG="${SKILL_SLUG:-concept-dialogue}"

log()  { printf '\033[36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
require() { command -v "$1" >/dev/null 2>&1 || fail "$1 not on PATH"; }
require curl
require python3

jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1') if d.get('$1') is not None else '')"; }

log "BASE=$BASE  GROUP=$GROUP  SKILL=$SKILL_SLUG"

# --- 1) Anonymous group join (no auth) --------------------------------------
JOIN=$(curl -fsS -X POST "$BASE/api/auth/group/join" \
  -H "Content-Type: application/json" -d "{\"group_id\":\"$GROUP\"}") \
  || fail "join failed — is GROUP=$GROUP a live code on this env?"
TOKEN=$(echo "$JOIN" | jget token)
SID=$(echo "$JOIN" | jget resumedSessionId)
[ -n "$TOKEN" ] || fail "join returned no token"
ok "joined $GROUP  (resumedSessionId=${SID:-<none>})"

AUTH=(-H "Authorization: Bearer $TOKEN")

# --- 2) Ensure the session has content (self-seed a fresh group) ------------
# If the group has no active session yet, bootstrap one + drive a real greet so
# there's something to read back. An existing session is used as-is (its turns
# are what a real student would resume).
if [ -z "$SID" ]; then
  log "no active session — resolving skillId for $SKILL_SLUG"
  SKILL_ID=$(curl -fsS "$BASE/api/skills" "${AUTH[@]}" | python3 -c "
import sys,json
slug='$SKILL_SLUG'
for s in json.load(sys.stdin):
    if s.get('slug')==slug or s.get('name')==slug:
        print(s['skillId']); break
")
  [ -n "$SKILL_ID" ] || fail "could not resolve skillId for $SKILL_SLUG (anon catalogue?)"
  SID=$(python3 -c "import uuid;print(uuid.uuid4())")
  log "bootstrap session $SID"
  curl -fsS -X POST "$BASE/api/sessions/$SID/bootstrap" "${AUTH[@]}" \
    -H "Content-Type: application/json" -d "{\"skillId\":\"$SKILL_ID\"}" >/dev/null \
    || fail "bootstrap failed"
  log "drive a real tutor greet (POST /greet)"
  curl -fsS -X POST "$BASE/api/sessions/$SID/greet" "${AUTH[@]}" \
    -H "Content-Type: application/json" -d "{\"skillId\":\"$SKILL_ID\"}" >/dev/null \
    || fail "greet failed"
  ok "seeded session $SID with a real tutor turn"
fi

# --- 3) Read history back (the endpoint the frontend reload uses) -----------
read_messages() {
  curl -fsS "$BASE/api/sessions/$SID/messages" "${AUTH[@]}"
}

log "GET /api/sessions/$SID/messages  (read #1)"
R1=$(read_messages) || fail "messages read #1 failed"
COUNT1=$(echo "$R1" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('messages',[])))")
HAS_ASSISTANT=$(echo "$R1" | python3 -c "import sys,json;print(any(m.get('role')=='assistant' for m in json.load(sys.stdin).get('messages',[])))")

[ "$COUNT1" -ge 1 ] || fail "resumed session has 0 messages — history would be empty on reload"
[ "$HAS_ASSISTANT" = "True" ] || fail "resumed session has no assistant turn — tutor history missing"
ok "read #1: $COUNT1 messages, assistant turn present"

# --- 4) Re-read (simulate the page reload) — must be stable -----------------
log "GET /api/sessions/$SID/messages  (read #2 — reload simulation)"
R2=$(read_messages) || fail "messages read #2 (reload) failed"
COUNT2=$(echo "$R2" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('messages',[])))")
[ "$COUNT2" = "$COUNT1" ] || fail "reload readback unstable: read#1=$COUNT1 vs read#2=$COUNT2"
ok "read #2: $COUNT2 messages — stable across reload"

echo
ok "chat-resume smoke green — history persists + reloads on $GROUP"
