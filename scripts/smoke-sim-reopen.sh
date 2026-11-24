#!/usr/bin/env bash
# smoke-sim-reopen.sh [dev|test|prod] — does what a student TYPED into a sim
# survive closing the sim and opening it again, on a DEPLOYED env, in a real
# browser? (1.1.160 M1, docs/design/aipla/v2.1.0-extension/sim-state-survives-close.md)
#
# On 2026-11-23 three of five groups lost a written prediction this way: closing
# a sim unmounted its iframe. Fixed in v0.1.113. This check printed
# survived:false (2 iframe loads) on the old code and survived:true (0 loads) on
# the new, so it can tell the two apart.
#
#   1. sign in as the test teacher (scripts/mint-test-teacher-token.sh — the
#      account exists on all three envs, accepted 2026-09-28)
#   2. find (or create once) the "Smoke: student view" class and a live join
#      code — the same class smoke-student-view.sh uses, reused across runs
#   3. create a throwaway activity with the sim attached (Danish)
#   4. a headless Chromium joins as the group, opens the sim, types into a
#      field, closes the sim, reopens it, and reads the field back
#   5. delete the activity (always, via trap)
#
# Costs one tutor greeting (a model call) per run. Screenshots go to
# $OUT (default /tmp/smoke-sim-reopen-<env>).
#
# Any built-in sim with a text field works: SIM=<id> FIELD=<css selector>. The
# default is sekant-intro's function field. Needs Playwright from the sandbox
# package (cd infrastructure/mcp-sandbox && npm ci).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV="${1:-dev}"
case "$ENV" in
  dev)  URL="https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app" ;;
  test) URL="https://aipla-test.ku.dk" ;;
  prod) URL="https://aipla.ku.dk" ;;
  *) echo "usage: $0 [dev|test|prod]" >&2; exit 2 ;;
esac
URL="${SMOKE_URL:-$URL}"
PROXY="$URL/api/proxy"
SIM="${SIM:-sekant-intro}"
FIELD="${FIELD:-#func-in}"
TMP="${TMPDIR:-/tmp}"
OUT="${OUT:-${TMP%/}/smoke-sim-reopen-$ENV}"
CLASS_NAME="Smoke: student view"
mkdir -p "$OUT"

fail() { echo "FAIL  $*" >&2; exit 1; }
ok() { echo "OK    $*"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

YAML="$ROOT/backend/artefacts/$SIM.yaml"
[ -f "$YAML" ] || fail "no built-in sim $SIM ($YAML)"
NAME="${SIM_NAME:-$(python3 -c "import sys,yaml; print(yaml.safe_load(open(sys.argv[1]))['displayName'])" "$YAML" 2>/dev/null \
  || sed -nE 's/^displayName: *"?([^"]*)"?$/\1/p' "$YAML")}"
[ -n "$NAME" ] || fail "could not read displayName from $YAML"

echo "== smoke-sim-reopen: $ENV ($URL), sim $SIM, field $FIELD =="

TOKEN="$("$ROOT/scripts/mint-test-teacher-token.sh" "$ENV")" || fail "could not sign in as the test teacher on $ENV"
ok "signed in as the test teacher"
T=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

SKILL_ID="$(curl -fsS "${T[@]}" "$PROXY/api/skills" \
  | json "next((s.get('skillId') or s.get('skill_id') for s in (d if isinstance(d, list) else d.get('skills', [])) if s.get('name') == 'concept-dialogue'), '')")"
[ -n "$SKILL_ID" ] || fail "concept-dialogue is not seeded on $ENV"

ROW="$(curl -fsS "${T[@]}" "$PROXY/api/classes" | CLASS_NAME="$CLASS_NAME" python3 -c "
import json, os, sys
d = json.load(sys.stdin)
rows = d if isinstance(d, list) else d.get('classes', [])
for c in rows:
    if c.get('name') == os.environ['CLASS_NAME'] and not c.get('revoked'):
        revoked = set(c.get('revokedGroupCodes') or [])
        live = [g for g in (c.get('groupCodes') or []) if g not in revoked]
        print(c['classId'], live[0] if live else '')
        break
")"
CLASS_ID="${ROW%% *}"
CODE="${ROW#* }"
if [ -z "$CLASS_ID" ]; then
  CLASS_ID="$(curl -fsS -X POST "${T[@]}" "$PROXY/api/classes" -d "{\"name\":\"$CLASS_NAME\"}" | json "d['classId']")"
  CODE=""
  ok "created class $CLASS_ID (first run on $ENV, reused afterwards)"
fi
if [ -z "$CODE" ] || [ "$CODE" = "$CLASS_ID" ]; then
  CODE="$(curl -fsS -X POST "${T[@]}" "$PROXY/api/classes/$CLASS_ID/groups" -d '{"count":1}' | json "d['codes'][0]")"
  ok "minted join code $CODE"
fi
ok "class $CLASS_ID, join code $CODE"

AID="$(curl -fsS -X POST "${T[@]}" "$PROXY/api/activities" \
  -d "{\"skillId\":\"$SKILL_ID\",\"classId\":\"$CLASS_ID\",\"title\":\"Smoke: sim reopen\",\"teachingGoal\":\"Smoke test - safe to delete\",\"artefactId\":\"$SIM\",\"language\":\"da\"}" \
  | json "d['activityId']")" || fail "could not create the activity"
cleanup() { curl -sS -o /dev/null -X DELETE "${T[@]}" "$PROXY/api/activities/$AID" && echo "OK    deleted $AID" || true; }
trap cleanup EXIT
ok "activity $AID with $SIM"

set +e
node "$ROOT/scripts/smoke-sim-reopen.mjs" "$URL" "$CODE" "$SKILL_ID" "$AID" "$NAME" "$FIELD" "$OUT"
rc=$?
set -e
echo "      screenshots: $OUT"
case "$rc" in
  0) echo "== PASS: what the student typed survives a close and reopen on $ENV ==" ;;
  3) echo "== FAIL: the typed text was LOST on close and reopen on $ENV ==" >&2 ;;
  *) echo "== ERROR: the check could not run (see the ERROR line and $OUT/error.png) ==" >&2 ;;
esac
exit "$rc"
