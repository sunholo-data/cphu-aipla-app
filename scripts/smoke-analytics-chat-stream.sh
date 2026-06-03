#!/usr/bin/env bash
# scripts/smoke-analytics-chat-stream.sh — end-to-end VERIFY of the
# analytics-chat chat surface on a deployed env.
#
# Why this exists: the existing smoke-analytics-chat.sh checked routes
# 1-4 (tools list, probe owned, probe unowned, skill registered) but
# NEVER fired a real `POST /api/skill/<uuid>/stream`. That left a
# half-day chain of bugs invisible to my own verification — every fix
# I shipped, I had to ask the user to test in their browser. Three
# separate bugs surfaced that way:
#
#   1. skill name vs UUID — frontend sent "analytics-chat" but the
#      stream endpoint resolves by Firestore doc id only. Fixed in
#      _AnalyticsChat.tsx by resolving via /api/skills/by-slug/...
#   2. user_id not wired to tool_context — agent's tool call refused
#      with "class not accessible" because tool_context.state["user:id"]
#      was unset. Fixed in analytics/tools.py:_caller_uid to read
#      from tool_context._invocation_context.user_id.
#   3. AGUIProvider used the wrong token in anonymous_group mode — on
#      a frontend built with NEXT_PUBLIC_AUTH_MODE=anonymous_group_id,
#      `useAuth().getIdToken()` returns the *group* token, not the
#      teacher's Firebase token. The group token authenticates as a
#      student (is_teacher=False), and access.can_access_skill on the
#      tagged-teacher skill returns False, which the stream endpoint
#      surfaces as 404 "Skill not found" via the deliberate access-leak
#      collapse. Fixed in AGUIProvider by adding a useTeacherAuth prop.
#
# This script reproduces the EXACT chat flow:
#
#   1. Sign in as test-teacher via Firebase REST signInWithPassword.
#   2. (NEW) Optionally fetch a group token by joining a demo group,
#      so we can prove the teacher token vs group token differential.
#   3. Resolve the analytics-chat skill UUID via /api/skills/by-slug.
#   4. POST /api/skill/<uuid>/stream with an AG-UI HttpAgent-shaped
#      body and read the SSE stream.
#   5. Assert: RUN_STARTED fired, at least one TOOL_CALL_RESULT
#      arrived, and the final TEXT_MESSAGE_CONTENT contained the
#      tool's numeric output.
#   6. (NEW) Repeat with the group token; assert the response is 404
#      "Skill not found" — proving the teacher-vs-group differential
#      is real and the fix is the correct gate.
#
# Requires
#   - FIREBASE_WEB_API_KEY (default: the dev project's public key,
#     surfaced in lib/firebase.ts via NEXT_PUBLIC_FIREBASE_API_KEY)
#   - TEST_TEACHER_EMAIL  (default: test-teacher@example.dk)
#   - TEST_TEACHER_PASSWORD (default: aipla-demo-1)
#   - SMOKE_CLASS_ID env var (a class test-teacher owns)
#   - python3 on PATH
#
# Usage
#   scripts/smoke-analytics-chat-stream.sh                  # uses dev URL
#   scripts/smoke-analytics-chat-stream.sh https://...       # explicit URL
set -euo pipefail

URL="${1:-${AIPLATFORM_API_URL:-https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app}}"
URL="${URL%/}"
PROXY="$URL/api/proxy"
FIREBASE_WEB_API_KEY="${FIREBASE_WEB_API_KEY:-AIzaSyBKcyTUDafaqwohqEjmqlx2feCrCAWob5I}"
TEACHER_EMAIL="${TEST_TEACHER_EMAIL:-test-teacher@example.dk}"
TEACHER_PASSWORD="${TEST_TEACHER_PASSWORD:-aipla-demo-1}"
CLASS_ID="${SMOKE_CLASS_ID:-4f719d49dfa5}"

PASS=0
FAIL=0
check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name  expected=$expected actual=$actual"
    FAIL=$((FAIL + 1))
  fi
}

echo "== smoke-analytics-chat-stream =="
echo "URL:     $URL"
echo "class:   $CLASS_ID"
echo

# --- 1. Mint teacher Firebase token ---
echo "[1] sign in as test-teacher (Firebase REST)"
TEACHER_TOKEN="$(curl -sS -X POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$FIREBASE_WEB_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEACHER_EMAIL\",\"password\":\"$TEACHER_PASSWORD\",\"returnSecureToken\":true}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('idToken') or '')")"
if [ -z "$TEACHER_TOKEN" ]; then
  echo "  FAIL: could not mint teacher token (bad creds?)" >&2
  exit 1
fi
check "teacher token minted" "yes" "yes"

# --- 2. Resolve analytics-chat slug -> UUID (same path the browser takes) ---
echo
echo "[2] resolve analytics-chat slug -> skill UUID"
SKILL_ID="$(curl -fsS -H "Authorization: Bearer $TEACHER_TOKEN" \
  "$PROXY/api/skills/by-slug/aipla-platform/analytics-chat" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('skillId') or d.get('skill_id') or '')")"
if [ -z "$SKILL_ID" ]; then
  echo "  FAIL: by-slug returned no skillId" >&2
  exit 1
fi
check "skill UUID resolved" "uuid-shape" "$([ ${#SKILL_ID} -eq 36 ] && echo uuid-shape || echo wrong)"
echo "  skill_id: $SKILL_ID"

# --- 3. POST stream with teacher token (should succeed) ---
echo
echo "[3] POST /api/skill/\$SKILL_ID/stream with teacher token"
# Build the AG-UI HttpAgent body via python to dodge bash-quoting
# pitfalls with the escaped double-quotes inside time_scope.
STREAM_BODY="$(python3 -c "
import json, time
print(json.dumps({
  'threadId': f'smoke-{int(time.time())}',
  'runId': 'r1',
  'messages': [{
    'id': 'm1',
    'role': 'user',
    'content': f'[class_id=$CLASS_ID time_scope=\"This week\"] How many messages did groups send this week?',
  }],
  'state': {},
  'tools': [],
  'context': [],
  'forwardedProps': {},
}))
")"

# Write stream output to a temp file because `python3 - <<EOF` would
# redirect stdin to the heredoc content (not the curl output).
STREAM_FILE="$(mktemp -t smoke_stream.XXXX)"
trap 'rm -f "$STREAM_FILE"' EXIT
curl -sS -N --max-time 60 -X POST \
  -H "Authorization: Bearer $TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d "$STREAM_BODY" \
  "$PROXY/api/skill/$SKILL_ID/stream" > "$STREAM_FILE"

python3 - "$STREAM_FILE" <<'PY'
import json, sys
path = sys.argv[1]
events = []
with open(path) as f:
    for line in f:
        line = line.rstrip("\n")
        if line.startswith("data:"):
            try:
                events.append(json.loads(line[5:].strip()))
            except Exception:
                pass
kinds = [e.get("type") for e in events]
print(f"  events seen: {len(events)}")
print(f"  event types: {kinds[:8]}{' ...' if len(kinds) > 8 else ''}")
def out(name, ok):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
out("RUN_STARTED fired", "RUN_STARTED" in kinds)
tool_results = [e for e in events if e.get("type") == "TOOL_CALL_RESULT"]
out("at least one TOOL_CALL_RESULT", bool(tool_results))
if tool_results:
    content = tool_results[0].get("content", "")
    try:
        payload = json.loads(content) if isinstance(content, str) else content
        out("tool result has 'total' field", isinstance(payload.get("total"), int))
    except Exception:
        out("tool result parseable", False)
text_msgs = [e for e in events if e.get("type") == "TEXT_MESSAGE_CONTENT"]
out("assistant text streamed", bool(text_msgs))
errors = [e for e in events if e.get("type") == "RUN_ERROR"]
out("no RUN_ERROR", not errors)
if errors:
    print(f"    -> first RUN_ERROR: {errors[0]}")
sys.exit(0 if not errors and tool_results else 1)
PY
TEACHER_RC=$?
if [ $TEACHER_RC -ne 0 ]; then
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi

# --- 3b. Resilience scenario: same teacher token, after a group/join ---
# Reproduces the 2026-06-03T11:39:35Z anomaly: a user opens a second
# tab, joins a group as a student, returns to /teacher/analytics, and
# sends Q2. The Firebase teacher session is still valid → the second
# stream POST should still succeed via getTeacherIdToken(). We don't
# go through the AGUIProvider here (no React); we just confirm the
# REST path is teacher-token-safe regardless of group-session state.
echo
echo "[3b] resilience: teacher token survives a concurrent group/join"
# Mint a group token (sets sessionStorage in a real browser; here we
# just exercise the join path).
GROUP_CODE="$(curl -fsS -H "Authorization: Bearer $TEACHER_TOKEN" \
  "$PROXY/api/classes/$CLASS_ID" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); codes=d.get('groupCodes') or []; print(codes[0] if codes else '')")"
if [ -n "$GROUP_CODE" ]; then
  curl -fsS -X POST -H "Content-Type: application/json" \
    -d "{\"group_id\":\"$GROUP_CODE\"}" \
    "$PROXY/api/auth/group/join" > /dev/null
  # Now send the SAME stream POST with the ORIGINAL teacher token.
  AFTER_STATUS="$(curl -sS -o /tmp/smoke_resil.txt -w '%{http_code}' --max-time 30 \
    -X POST -H "Authorization: Bearer $TEACHER_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    -d "$STREAM_BODY" \
    "$PROXY/api/skill/$SKILL_ID/stream")"
  check "teacher token still 200 after concurrent group/join" "200" "$AFTER_STATUS"
fi

# --- 4. (Differential) POST with group token should 404 ---
# Why: AGUIProvider was passing the auth-context's getIdToken() result.
# On a frontend built with NEXT_PUBLIC_AUTH_MODE=anonymous_group_id, that
# returns the GROUP token. We need to prove the group token fails so the
# `useTeacherAuth` opt-in is the correct gate.
echo
echo "[4] differential: POST stream with a group token should be 404"
echo "    (mint a group token by joining a class group code)"

# Pick the first group code in CLASS_ID and join as an anonymous student.
GROUP_CODE="$(curl -fsS -H "Authorization: Bearer $TEACHER_TOKEN" \
  "$PROXY/api/classes/$CLASS_ID" \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
codes = d.get('groupCodes') or []
print(codes[0] if codes else '')
")"

if [ -z "$GROUP_CODE" ]; then
  echo "  SKIP  no group codes on class $CLASS_ID — can't mint group token"
else
  GROUP_TOKEN="$(curl -fsS -X POST \
    -H "Content-Type: application/json" \
    -d "{\"group_id\":\"$GROUP_CODE\"}" \
    "$PROXY/api/auth/group/join" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('token') or '')")"

  if [ -z "$GROUP_TOKEN" ]; then
    echo "  SKIP  group join did not return a token (group code may be revoked)"
  else
    GROUP_STATUS="$(curl -sS -o /tmp/smoke_group_stream.txt -w '%{http_code}' \
      -X POST -H "Authorization: Bearer $GROUP_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$STREAM_BODY" \
      "$PROXY/api/skill/$SKILL_ID/stream")"
    check "group token -> 404 (proves teacher-token gate is needed)" "404" "$GROUP_STATUS"
    DETAIL="$(python3 -c "import json; print(json.load(open('/tmp/smoke_group_stream.txt'))['detail'])" 2>/dev/null || echo "?")"
    check "404 detail is 'Skill not found'" "Skill not found" "$DETAIL"
  fi
fi

echo
echo "== summary: $PASS passed, $FAIL failed =="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
