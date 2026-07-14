#!/usr/bin/env bash
# Capture real screenshots for the teacher guides by logging into the DEPLOYED
# DEV frontend as the test teacher with Playwright. Writes PNGs into
# docs/guides/assets/, replacing placeholders. Then re-render: make guides
#
# Env overrides:
#   BASE_URL            dev frontend (default: the aipla-v01 dev URL in capture.mjs)
#   TEACHER_EMAIL       default test-teacher@example.dk
#   TEACHER_PASSWORD    default aipla-demo-1
#   RESEARCHER_EMAIL    default test-researcher@example.dk (R1 shots)
#   RESEARCHER_PASSWORD default aipla-demo-1
#
# Three passes: teacher (T1-T4), student (S1), and researcher (R1). The R1 pass
# only runs if the researcher account actually carries the role:researcher claim
# (grant it with `aiplatform --env dev users grant-researcher <uid>`), else those
# surfaces render "access required"; the pass is skipped with a note.
#
# The "activity created" shot creates one throwaway activity on shared dev and
# soft-deletes it afterwards; that cleanup needs a teacher token, which this
# script mints via scripts/mint-test-teacher-token.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

BASE="${BASE_URL:-https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app}"
RESEARCHER_EMAIL="${RESEARCHER_EMAIL:-test-researcher@example.dk}"
RESEARCHER_PASSWORD="${RESEARCHER_PASSWORD:-aipla-demo-1}"

# Mint a teacher id-token for post-capture cleanup (best-effort — capture still
# runs without it, but the throwaway activity would then need manual deletion).
CLEANUP_TOKEN=""
if [ -x scripts/mint-test-teacher-token.sh ]; then
  echo "Minting test-teacher token for cleanup…"
  CLEANUP_TOKEN="$(scripts/mint-test-teacher-token.sh 2>/dev/null | tail -1 || true)"
  [ -n "$CLEANUP_TOKEN" ] && echo "  token minted" || echo "  (warn) could not mint token — cleanup will be skipped"
fi

# Does the researcher account carry the claim yet? (scope=all → 200 researcher).
DO_R1=0
RTOKEN="$(TEACHER_EMAIL="$RESEARCHER_EMAIL" TEACHER_PASSWORD="$RESEARCHER_PASSWORD" scripts/mint-test-teacher-token.sh 2>/dev/null | tail -1 || true)"
if [ -n "$RTOKEN" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/proxy/api/activities?scope=all" -H "Authorization: Bearer $RTOKEN")" = "200" ]; then
  DO_R1=1
fi

cd docs/guides/screenshots

if [ ! -d node_modules ]; then
  echo "Installing screenshot tooling (Playwright)…"
  npm install
fi
npx playwright install chromium

# Teacher pass (T1-T4) — skip the researcher-only shots.
SKIP=r1-01-research,r1-02-lenses GUIDE_TEACHER_TOKEN="$CLEANUP_TOKEN" node capture.mjs

# Student guide (S1): anonymous group-code join, no login. Uses the seeded demo
# code by default; override with GROUP=<code>.
echo
echo "Capturing student guide (S1)…"
node capture-student.mjs

# Researcher pass (R1) — only if the account has the claim.
echo
if [ "$DO_R1" = "1" ]; then
  echo "Capturing researcher guide (R1) as $RESEARCHER_EMAIL…"
  TEACHER_EMAIL="$RESEARCHER_EMAIL" TEACHER_PASSWORD="$RESEARCHER_PASSWORD" \
    ONLY=r1-01-research,r1-02-lenses node capture.mjs
else
  echo "Skipping R1 (researcher) shots — $RESEARCHER_EMAIL is not a researcher yet."
  echo "  Grant it, then re-run: aiplatform --env dev users grant-researcher <uid>"
fi

echo
echo "Screenshots updated in docs/guides/assets/. Re-render with: make guides"
