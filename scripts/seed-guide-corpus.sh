#!/usr/bin/env bash
# Seed the AIPLA how-to guides into the platform: ingest the rendered guide PDFs
# into the SHARED curriculum corpus (subject "AIPLA guides") and build an
# onboarding class with teacher + student + researcher tutors grounded in them.
#
#   scripts/seed-guide-corpus.sh            # deployed dev (default)
#   scripts/seed-guide-corpus.sh test       # = make seed-guide-corpus ENV=test
#   scripts/seed-guide-corpus.sh prod
#
# Renders the guides first (needs the PDFs), mints a teacher token for the
# target env, resolves that env's frontend URL live, then runs the seeder.
#
# Idempotent since 2026-08-04 — re-running reconciles rather than duplicating.
# Until then this took no env argument at all and the .mjs defaulted to dev's
# hardcoded URL, which is why the guides only ever existed in dev.
#
# Prod note: prod has email sign-in on for the pilot but no seeded test-teacher,
# so pass TEACHER_EMAIL / TEACHER_PASSWORD for a real prod teacher account.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV="${1:-dev}"
case "$ENV" in
  dev|test|prod) : ;;
  *) echo "Unknown env '$ENV' (expected: dev|test|prod)" >&2; exit 2 ;;
esac

PROJECT="aipla-${ENV}-2026"
REGION="europe-north1"
SERVICE="aipla-v01-frontend"

command -v gcloud >/dev/null 2>&1 || { echo "gcloud not on PATH" >&2; exit 2; }
command -v node   >/dev/null 2>&1 || { echo "node not on PATH" >&2; exit 2; }

echo "Resolving $SERVICE in $PROJECT…"
BASE_URL="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" \
  --format='value(status.url)' 2>/dev/null || true)"
if [ -z "$BASE_URL" ]; then
  echo "Could not resolve $SERVICE in $PROJECT/$REGION (gcloud auth login? env deployed?)" >&2
  exit 2
fi

echo "Rendering guides (ensuring PDFs exist)…"
scripts/render-guides.sh >/dev/null

echo "Minting teacher token for $ENV…"
TOKEN="$(scripts/mint-test-teacher-token.sh "$ENV" 2>/dev/null | tail -1)"
[ -z "$TOKEN" ] && { echo "Could not mint a token for $ENV — aborting." >&2; exit 1; }

GUIDE_TEACHER_TOKEN="$TOKEN" BASE_URL="$BASE_URL" node scripts/seed-guide-corpus.mjs
