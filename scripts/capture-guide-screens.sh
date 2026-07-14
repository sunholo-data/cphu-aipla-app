#!/usr/bin/env bash
# Capture real screenshots for the teacher guides by logging into the DEPLOYED
# DEV frontend as the test teacher with Playwright. Writes PNGs into
# docs/guides/assets/, replacing placeholders. Then re-render: make guides
#
# Env overrides:
#   BASE_URL         dev frontend (default: the aipla-v01 dev URL in capture.mjs)
#   TEACHER_EMAIL    default test-teacher@example.dk
#   TEACHER_PASSWORD default aipla-demo-1
#
# The "activity created" shot creates one throwaway activity on shared dev and
# soft-deletes it afterwards; that cleanup needs a teacher token, which this
# script mints via scripts/mint-test-teacher-token.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

# Mint a teacher id-token for post-capture cleanup (best-effort — capture still
# runs without it, but the throwaway activity would then need manual deletion).
CLEANUP_TOKEN=""
if [ -x scripts/mint-test-teacher-token.sh ]; then
  echo "Minting test-teacher token for cleanup…"
  CLEANUP_TOKEN="$(scripts/mint-test-teacher-token.sh 2>/dev/null | tail -1 || true)"
  [ -n "$CLEANUP_TOKEN" ] && echo "  token minted" || echo "  (warn) could not mint token — cleanup will be skipped"
fi

cd docs/guides/screenshots

if [ ! -d node_modules ]; then
  echo "Installing screenshot tooling (Playwright)…"
  npm install
fi
npx playwright install chromium

GUIDE_TEACHER_TOKEN="$CLEANUP_TOKEN" node capture.mjs

# Student guide (S1): anonymous group-code join, no login. Uses the seeded demo
# code by default; override with GROUP=<code>.
echo
echo "Capturing student guide (S1)…"
node capture-student.mjs

echo
echo "Screenshots updated in docs/guides/assets/. Re-render with: make guides"
