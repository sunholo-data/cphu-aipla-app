#!/usr/bin/env bash
# smoke-sim-author.sh [url] — end-to-end check of the Sim workshop on a
# deployed env (in-app-sim-authoring M4/M5): the REAL chat path a teacher's
# browser takes, then the drafts route the workshop page reads.
#
#   1. sign in as the test teacher (Firebase REST)
#   2. resolve the sim-author skill UUID (by-slug, as the browser does)
#   3. POST /api/skill/<uuid>/stream with a small brief; read the SSE turn
#      (the skill drafts, calls verify_sim, which calls the sim-verify service)
#   4. GET /api/sim-drafts: a draft exists, with a version and a level, and its
#      screenshot downloads as a PNG
#   5. with SIM_FOLLOWUP set: a SECOND turn in the same conversation, as a
#      teacher asking for a change after looking at the screenshots; a NEW
#      version must be stored (iteration works, not just generation)
#
# Env: SIM_BRIEF (first turn), SIM_FOLLOWUP (second turn), SIM_THREAD (reuse a
# conversation: then only SIM_FOLLOWUP is sent), SMOKE_OUT (dir to save each
# version's screenshots and index.html for a person to inspect).
#
# It COSTS MONEY (one build, ~EUR 0.3-0.5 of model time) and takes minutes.
# Defaults to dev. The test teacher's password is in this repo by decision
# (2026-09-28).
set -euo pipefail

URL="${1:-${AIPLATFORM_API_URL:-https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app}}"
URL="${URL%/}"
PROXY="$URL/api/proxy"
FIREBASE_WEB_API_KEY="${FIREBASE_WEB_API_KEY:-AIzaSyBKcyTUDafaqwohqEjmqlx2feCrCAWob5I}"
TEACHER_EMAIL="${TEST_TEACHER_EMAIL:-test-teacher@example.dk}"
TEACHER_PASSWORD="${TEST_TEACHER_PASSWORD:-aipla-demo-1}"
BRIEF="${SIM_BRIEF:-Build a simple pendulum sim. ID: pendul-smoke. The student sets the string length (0.2-1.5 m), releases the bob from 10 degrees, and records the period from a stopwatch into a small table. Fysik C. g = 9.82 m/s^2. Do NOT show g or the period formula.}"

echo "== smoke-sim-author: $URL =="
TOKEN="$(curl -sS -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$FIREBASE_WEB_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEACHER_EMAIL\",\"password\":\"$TEACHER_PASSWORD\",\"returnSecureToken\":true}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('idToken') or '')")"
[ -n "$TOKEN" ] || { echo "FAIL: could not sign in as $TEACHER_EMAIL" >&2; exit 1; }
echo "OK    signed in as $TEACHER_EMAIL"

SKILL_ID="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$PROXY/api/skills/by-slug/aipla-platform/sim-author" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('skillId') or d.get('skill_id') or '')")"
[ -n "$SKILL_ID" ] || { echo "FAIL: sim-author is not seeded on this env" >&2; exit 1; }
echo "OK    sim-author skill $SKILL_ID"

OUT_DIR="${SMOKE_OUT:-}"
THREAD="${SIM_THREAD:-smoke-sim-$(date +%s)}"

# One AG-UI turn on the thread; prints the tool calls and the reply, fails on RUN_ERROR
# or a turn that never called verify_sim.
turn() {
  local message="$1" stream body
  stream="$(mktemp -t smoke_sim.XXXX)"
  body="$(MSG="$message" THREAD="$THREAD" python3 -c "
import json, os, time
print(json.dumps({'threadId': os.environ['THREAD'], 'runId': f'r{int(time.time())}',
  'messages': [{'id': f'm{int(time.time())}', 'role': 'user', 'content': '[ui_language=en] ' + os.environ['MSG']}],
  'state': {}, 'tools': [], 'context': [], 'forwardedProps': {}}))")"
  echo "..    turn on $THREAD (minutes): ${message:0:90}"
  curl -sS -N --max-time 1200 -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" -d "$body" "$PROXY/api/skill/$SKILL_ID/stream" > "$stream" || true
  python3 - "$stream" <<'PY'
import json, sys
events = []
for line in open(sys.argv[1]):
    if line.startswith("data:"):
        try:
            events.append(json.loads(line[5:].strip()))
        except Exception:
            pass
calls = [e.get("toolCallName") for e in events if e.get("type") == "TOOL_CALL_START"]
errors = [e for e in events if e.get("type") == "RUN_ERROR"]
text = "".join(e.get("delta", "") for e in events if e.get("type") == "TEXT_MESSAGE_CONTENT")
print(f"OK    {len(events)} events; tool calls: {calls}")
if errors:
    sys.exit(f"FAIL: RUN_ERROR {errors[0]}")
if "verify_sim" not in calls:
    sys.exit("FAIL: the skill never called verify_sim this turn")
print("OK    reply: " + text.strip().replace("\n", " ")[:600])
PY
  local rc=$?
  rm -f "$stream"
  return $rc
}

# The newest draft's id, version and level.
latest() {
  curl -fsS -H "Authorization: Bearer $TOKEN" "$PROXY/api/sim-drafts" | python3 -c "
import json,sys; d=json.load(sys.stdin)['drafts']
print(f\"{d[0]['id']} {d[0]['latestVersion']} {d[0]['latestLevel']}\" if d else '- 0 -')"
}

# Save a version's screenshots + page for a person to look at.
save_version() {
  local id="$1" v="$2"
  [ -n "$OUT_DIR" ] || return 0
  mkdir -p "$OUT_DIR/v$v"
  for shot in 700 driven 390; do
    curl -fsS -H "Authorization: Bearer $TOKEN" "$PROXY/api/sim-drafts/$id/versions/$v/screenshot/$shot" -o "$OUT_DIR/v$v/$shot.png" 2>/dev/null || true
  done
  curl -fsS -H "Authorization: Bearer $TOKEN" "$PROXY/api/sim-drafts/$id/versions/$v/files/index.html" -o "$OUT_DIR/v$v/index.html" || true
  echo "OK    saved version $v to $OUT_DIR/v$v"
}

if [ -n "${SIM_THREAD:-}" ]; then
  [ -n "${SIM_FOLLOWUP:-}" ] || { echo "SIM_THREAD needs SIM_FOLLOWUP" >&2; exit 1; }
  read -r ID V0 L0 <<<"$(latest)"
  turn "$SIM_FOLLOWUP"
  read -r ID V1 L1 <<<"$(latest)"
  [ "$V1" -gt "$V0" ] || { echo "FAIL: no new version after the follow-up (still $V0)" >&2; exit 1; }
  echo "OK    iteration stored: version $V0 -> $V1, level $L1"
  for v in $(seq $((V0 + 1)) "$V1"); do save_version "$ID" "$v"; done
  echo "smoke-sim-author (follow-up) passed."
  exit 0
fi

BEFORE="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$PROXY/api/sim-drafts" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['drafts']))")"
turn "$BRIEF"

DRAFTS="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$PROXY/api/sim-drafts")"
python3 - "$DRAFTS" "$BEFORE" <<'PY'
import json, sys
drafts = json.loads(sys.argv[1])["drafts"]
if len(drafts) <= int(sys.argv[2]):
    sys.exit("FAIL: no new draft was stored")
d = drafts[0]
print(f"OK    draft {d['id']}: '{d['title']}', version {d['latestVersion']}, level {d['latestLevel']}")
open("/tmp/.smoke_sim_draft", "w").write(d["id"])
PY
DRAFT_ID="$(cat /tmp/.smoke_sim_draft)"; rm -f /tmp/.smoke_sim_draft
CT="$(curl -sS -o /dev/null -w '%{content_type}' -H "Authorization: Bearer $TOKEN" "$PROXY/api/sim-drafts/$DRAFT_ID/versions/1/screenshot/700")"
[ "$CT" = "image/png" ] && echo "OK    version 1 screenshot is a PNG" || echo "WARN  version 1 screenshot: $CT (no browser run?)"
read -r ID V1 L1 <<<"$(latest)"
for v in $(seq 1 "$V1"); do save_version "$ID" "$v"; done
echo "thread: $THREAD"
if [ -n "${SIM_FOLLOWUP:-}" ]; then
  turn "$SIM_FOLLOWUP"
  read -r ID V2 L2 <<<"$(latest)"
  [ "$V2" -gt "$V1" ] || { echo "FAIL: no new version after the follow-up (still $V1)" >&2; exit 1; }
  echo "OK    iteration stored: version $V1 -> $V2, level $L2"
  for v in $(seq $((V1 + 1)) "$V2"); do save_version "$ID" "$v"; done
fi
echo "smoke-sim-author passed."
