#!/usr/bin/env bash
# Seed the AIPLA how-to guides into the platform: ingest the rendered guide PDFs
# into the SHARED curriculum corpus (subject "AIPLA guides") and build an
# onboarding class with teacher + student tutors grounded in them.
#
#   make seed-guide-corpus            # deployed dev (default)
#
# Renders the guides first (needs the PDFs), mints a test-teacher token for the
# ingest/create calls, then runs the seeder. NOT idempotent — see the .mjs header.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Rendering guides (ensuring PDFs exist)…"
scripts/render-guides.sh >/dev/null

echo "Minting test-teacher token…"
TOKEN="$(scripts/mint-test-teacher-token.sh 2>/dev/null | tail -1)"
[ -z "$TOKEN" ] && { echo "Could not mint a token — aborting." >&2; exit 1; }

GUIDE_TEACHER_TOKEN="$TOKEN" node scripts/seed-guide-corpus.mjs
