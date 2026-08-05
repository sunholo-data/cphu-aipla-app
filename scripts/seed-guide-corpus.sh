#!/usr/bin/env bash
# Seed the AIPLA how-to guides into the platform: ingest the rendered guide PDFs
# into the SHARED curriculum corpus (subject "AIPLA guides") and build an
# onboarding class with teacher + student + researcher tutors grounded in them.
#
#   scripts/seed-guide-corpus.sh            # deployed dev (default)
#   scripts/seed-guide-corpus.sh test       # = make seed-guide-corpus ENV=test
#   scripts/seed-guide-corpus.sh prod
#
# Seeds the PUBLISHED PDFs (frontend/public/guides/, committed) — the exact bytes
# the /guides page serves — so the queryable corpus and the static pages cannot
# disagree. It does NOT render; `make guides-publish` is the render+commit step,
# and the staleness check below refuses to seed if you skipped it.
#
# Idempotent since 2026-08-04 — re-running reconciles rather than duplicating.
# Until then this took no env argument at all and the .mjs defaulted to dev's
# hardcoded URL, which is why the guides only ever existed in dev.
#
# Teacher account: defaults to test-teacher@example.dk, which exists on all three
# envs (verified on prod 2026-08-05). Override with TEACHER_EMAIL/TEACHER_PASSWORD.
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

GUIDE_DIR="frontend/public/guides"
SRC_DIR="docs/guides"
if [ ! -d "$GUIDE_DIR" ] || [ -z "$(ls "$GUIDE_DIR"/*.pdf 2>/dev/null)" ]; then
  echo "No published guide PDFs in $GUIDE_DIR — run 'make guides-publish' first." >&2
  exit 2
fi

# Staleness gate. Seeding the published PDFs means a .qmd edit that was never
# published would seed the OLD text — the render step this replaced made that
# impossible by always rendering first. This restores that guarantee without
# requiring the LaTeX toolchain on the seeding machine.
#
# Compares COMMIT TIMES, not mtimes: a fresh clone stamps every file with the
# checkout time, so mtime comparison is pure noise on any machine but the one
# that did the render. Uncommitted .qmd edits count as stale too.
# STALE_OK=1 to override (e.g. deliberately re-seeding an unchanged corpus).
if [ -z "${STALE_OK:-}" ] && git rev-parse --git-dir >/dev/null 2>&1; then
  stale=""
  if ! git diff --quiet -- "$SRC_DIR" 2>/dev/null || ! git diff --cached --quiet -- "$SRC_DIR" 2>/dev/null; then
    stale="uncommitted changes under $SRC_DIR/"
  else
    src_t="$(git log -1 --format=%ct -- "$SRC_DIR/"*.qmd "$SRC_DIR/assets" "$SRC_DIR/_quarto.yml" 2>/dev/null || echo 0)"
    pub_t="$(git log -1 --format=%ct -- "$GUIDE_DIR" 2>/dev/null || echo 0)"
    if [ "${src_t:-0}" -gt "${pub_t:-0}" ] 2>/dev/null; then
      stale="guide sources were committed after the published PDFs"
    fi
  fi
  if [ -n "$stale" ]; then
    echo "REFUSING to seed: $stale." >&2
    echo "  The corpus would carry text that /guides does not serve." >&2
    echo "  Run 'make guides-publish' (renders + copies into $GUIDE_DIR), commit, then re-run." >&2
    echo "  Override with STALE_OK=1 if you know the published PDFs are current." >&2
    exit 2
  fi
fi

echo "Seeding published guides from $GUIDE_DIR ($(ls "$GUIDE_DIR"/*.pdf | wc -l | tr -d ' ') PDFs)."

echo "Minting teacher token for $ENV…"
TOKEN="$(scripts/mint-test-teacher-token.sh "$ENV" 2>/dev/null | tail -1)"
[ -z "$TOKEN" ] && { echo "Could not mint a token for $ENV — aborting." >&2; exit 1; }

GUIDE_TEACHER_TOKEN="$TOKEN" BASE_URL="$BASE_URL" node scripts/seed-guide-corpus.mjs
