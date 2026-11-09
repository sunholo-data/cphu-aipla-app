#!/usr/bin/env bash
# smoke-student-view.sh [dev|test|prod] — the teacher's student-view choice
# (2026-11-09) reaches a student on a DEPLOYED env, through the same two routes
# the browser uses:
#
#   1. sign in as the test teacher (Firebase REST; the account exists on all
#      three envs and its password is in this repo by decision, 2026-09-28)
#   2. find (or create once) the teacher's "Smoke: student view" class and a
#      live join code for it — reused across runs, so codes do not pile up
#   3. join as that group (anonymous student token)
#   4. create an activity in the class with studentView=workbench, and read it
#      back as the STUDENT from /api/activity-configs/active -> "workbench"
#   5. change it to photo with the builder's full-payload PATCH -> "photo"
#   6. an activity saved without the field reads "chat" (today's layout)
#   7. soft-delete the smoke activities (always, via trap)
#
# Read-mostly and cheap: no model call. Writes one class (first run only), one
# join code (first run only) and two activities it deletes again.
set -euo pipefail

ENV="${1:-dev}"
case "$ENV" in
  dev)  URL="https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app" ;;
  test) URL="https://aipla-test.ku.dk" ;;
  prod) URL="https://aipla.ku.dk" ;;
  *) echo "usage: $0 [dev|test|prod]" >&2; exit 2 ;;
esac
URL="${SMOKE_URL:-$URL}"
PROXY="$URL/api/proxy"
FIREBASE_WEB_API_KEY="${FIREBASE_WEB_API_KEY:-AIzaSyBKcyTUDafaqwohqEjmqlx2feCrCAWob5I}"
TEACHER_EMAIL="${TEST_TEACHER_EMAIL:-test-teacher@example.dk}"
TEACHER_PASSWORD="${TEST_TEACHER_PASSWORD:-aipla-demo-1}"
CLASS_NAME="Smoke: student view"

fail() { echo "FAIL  $*" >&2; exit 1; }
ok() { echo "OK    $*"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "== smoke-student-view: $ENV ($URL) =="

TOKEN="$(curl -sS -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$FIREBASE_WEB_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEACHER_EMAIL\",\"password\":\"$TEACHER_PASSWORD\",\"returnSecureToken\":true}" \
  | json "d.get('idToken') or ''")"
[ -n "$TOKEN" ] || fail "could not sign in as $TEACHER_EMAIL"
ok "signed in as $TEACHER_EMAIL"
T=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

SKILL_ID="$(curl -fsS "${T[@]}" "$PROXY/api/skills" \
  | json "next((s.get('skillId') or s.get('skill_id') for s in (d if isinstance(d, list) else d.get('skills', [])) if s.get('name') == 'concept-dialogue'), '')")"
[ -n "$SKILL_ID" ] || fail "concept-dialogue is not seeded on $ENV"
ok "concept-dialogue skill $SKILL_ID"

CLASS_ROW="$(curl -fsS "${T[@]}" "$PROXY/api/classes" | CLASS_NAME="$CLASS_NAME" python3 -c "
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
CLASS_ID="${CLASS_ROW%% *}"
CODE="${CLASS_ROW#* }"
if [ -z "$CLASS_ID" ]; then
  CLASS_ID="$(curl -fsS -X POST "${T[@]}" "$PROXY/api/classes" -d "{\"name\":\"$CLASS_NAME\"}" | json "d['classId']")"
  CODE=""
  ok "created class $CLASS_ID (first run on $ENV)"
else
  ok "reusing class $CLASS_ID"
fi
if [ -z "$CODE" ] || [ "$CODE" = "$CLASS_ID" ]; then
  CODE="$(curl -fsS -X POST "${T[@]}" "$PROXY/api/classes/$CLASS_ID/groups" -d '{"count":1}' | json "d['codes'][0]")"
  ok "minted join code $CODE"
fi

STUDENT="$(curl -fsS -X POST -H "Content-Type: application/json" "$PROXY/api/auth/group/join" \
  -d "{\"group_id\":\"$CODE\"}" | json "d['token']")"
[ -n "$STUDENT" ] || fail "student join with $CODE returned no token"
ok "joined as group $CODE"
S=(-H "Authorization: Bearer $STUDENT")

CREATED=()
cleanup() {
  for aid in "${CREATED[@]:-}"; do
    [ -n "$aid" ] && curl -sS -o /dev/null -X DELETE "${T[@]}" "$PROXY/api/activities/$aid" || true
  done
}
trap cleanup EXIT

create() { # $1 = extra JSON fields (may be empty)
  local body="{\"skillId\":\"$SKILL_ID\",\"classId\":\"$CLASS_ID\",\"title\":\"Smoke: student view\",\"teachingGoal\":\"Smoke test - safe to delete\"${1:+,$1}}"
  local out status
  out="$(curl -sS -w '\n%{http_code}' -X POST "${T[@]}" "$PROXY/api/activities" -d "$body")"
  status="${out##*$'\n'}"
  # 422 here means the deployed backend does not know the field yet.
  [ "$status" = "201" ] || fail "create activity returned HTTP $status: ${out%$'\n'*}"
  printf '%s' "${out%$'\n'*}" | json "d['activityId']"
}
student_view() {
  curl -fsS "${S[@]}" "$PROXY/api/activity-configs/active/$1" | json "d.get('studentView', '<missing>')"
}
expect() { # $1 = got, $2 = want, $3 = what
  [ "$1" = "$2" ] || fail "$3: the student sees studentView=$1, want $2"
  ok "$3: the student sees studentView=$1"
}

AID="$(create '"studentView":"workbench"')" || exit 1
CREATED+=("$AID")
expect "$(student_view "$AID")" workbench "teacher picked work first ($AID)"

curl -fsS -o /dev/null -X PATCH "${T[@]}" "$PROXY/api/activities/$AID" \
  -d "{\"skillId\":\"$SKILL_ID\",\"title\":\"Smoke: student view\",\"teachingGoal\":\"Smoke test - safe to delete\",\"studentView\":\"photo\"}"
expect "$(student_view "$AID")" photo "teacher switched to photo"

LEGACY="$(create '')" || exit 1
CREATED+=("$LEGACY")
expect "$(student_view "$LEGACY")" chat "saved without the field ($LEGACY)"

echo "== PASS: the student view reaches the student on $ENV =="
