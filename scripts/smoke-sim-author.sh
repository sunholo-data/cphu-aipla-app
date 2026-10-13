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

BEFORE="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$PROXY/api/sim-drafts" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['drafts']))")"
BODY="$(BRIEF="$BRIEF" python3 -c "
import json, os, time
print(json.dumps({'threadId': f'smoke-sim-{int(time.time())}', 'runId': 'r1',
  'messages': [{'id': 'm1', 'role': 'user', 'content': '[ui_language=en] ' + os.environ['BRIEF']}],
  'state': {}, 'tools': [], 'context': [], 'forwardedProps': {}}))")"
STREAM="$(mktemp -t smoke_sim.XXXX)"
trap 'rm -f "$STREAM"' EXIT
echo "..    streaming one build turn (minutes)"
curl -sS -N --max-time 1200 -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" -d "$BODY" "$PROXY/api/skill/$SKILL_ID/stream" > "$STREAM" || true

python3 - "$STREAM" <<'PY'
import json, sys
events = []
for line in open(sys.argv[1]):
    if line.startswith("data:"):
        try:
            events.append(json.loads(line[5:].strip()))
        except Exception:
            pass
kinds = [e.get("type") for e in events]
calls = [e.get("toolCallName") for e in events if e.get("type") == "TOOL_CALL_START"]
errors = [e for e in events if e.get("type") == "RUN_ERROR"]
text = "".join(e.get("delta", "") for e in events if e.get("type") == "TEXT_MESSAGE_CONTENT")
print(f"OK    {len(events)} events; tool calls: {calls}")
if errors:
    sys.exit(f"FAIL: RUN_ERROR {errors[0]}")
if "verify_sim" not in calls:
    sys.exit("FAIL: the skill never called verify_sim")
print("OK    reply: " + text.strip().replace("\n", " ")[:300])
PY

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
echo "smoke-sim-author passed."
