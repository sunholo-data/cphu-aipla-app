#!/usr/bin/env bash
# Seed the AIPLA how-to guides into the platform: ingest the rendered guide PDFs
# into the SHARED curriculum corpus (subject "AIPLA guides") and build an
# onboarding class with teacher + student + researcher tutors grounded in them.
#
#   scripts/seed-guide-corpus.sh prod               # DRY RUN: what would change
#   GO=1 scripts/seed-guide-corpus.sh prod          # = make seed-guide-corpus ENV=prod GO=1
#   GUIDE_EXCLUDE=t5-introduce-the-tutor GO=1 scripts/seed-guide-corpus.sh prod
#   GUIDE_SLUGS=t1-set-up-a-class GO=1 scripts/seed-guide-corpus.sh dev   # subset, no prune
#
# DRY RUN UNLESS GO=1 (the repo's backfill/repair convention). A dry run reads
# and hashes; it never extracts text or touches the RAG corpus.
#
# Seeds the PUBLISHED PDFs (frontend/public/guides/, committed) — the exact bytes
# the /guides page serves — so the queryable corpus and the static pages cannot
# disagree. It does NOT render; `make guides-pdf` is the print step, and the
# staleness check below refuses to seed if you skipped it.
#
# Idempotent — re-running reconciles rather than duplicating, and since
# 2026-10-26 an unchanged guide is not re-ingested at all (content hash).
#
# IDENTITY (2026-10-26): the env's runtime service account, through the
# SA-allowlisted /api/admin/guide-corpus/* routes — no person's account, no
# password. It used to sign in as test-teacher@example.dk and call the teacher
# routes, which two later gates (shared ingest is researcher-only; ingest is a
# paid call) refuse — prod's corpus sat frozen at the 2026-08-05 text because of
# it. Needs roles/iam.serviceAccountTokenCreator on aipla-v6@<project>, the same
# grant `make list-roles` needs.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v gcloud >/dev/null 2>&1 && [ -x "$HOME/dev/google-cloud-sdk/bin/gcloud" ]; then
  PATH="$HOME/dev/google-cloud-sdk/bin:$PATH"
fi
# The ACTIVE gcloud config is not an AIPLA one (see scripts/aiplatform-admin.sh).
export CLOUDSDK_ACTIVE_CONFIG_NAME="${CLOUDSDK_ACTIVE_CONFIG_NAME:-aipla}"

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

echo "Resolving $SERVICE in ${PROJECT}…"
BASE_URL="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" \
  --format='value(status.url)' 2>/dev/null || true)"
if [ -z "$BASE_URL" ]; then
  echo "Could not resolve $SERVICE in $PROJECT/$REGION (gcloud auth login? env deployed?)" >&2
  exit 2
fi

GUIDE_DIR="frontend/public/guides"
SRC_DIR="frontend/content/guides"
if [ ! -d "$GUIDE_DIR" ] || [ -z "$(ls "$GUIDE_DIR"/*.pdf 2>/dev/null)" ]; then
  echo "No guide PDFs in $GUIDE_DIR — run 'make guides-pdf' first." >&2
  exit 2
fi

# Staleness gate. Seeding the PDFs means a guide edit that was never re-printed
# would seed the OLD text, while /guides serves the new one. 1.1.116 made that
# gap wider, not narrower: the page updates the moment the markdown ships, and
# only the PDF needs a print run.
#
# Compares COMMIT TIMES, not mtimes: a fresh clone stamps every file with the
# checkout time, so mtime comparison is pure noise on any machine but the one
# that did the printing. Uncommitted guide edits count as stale too.
# STALE_OK=1 to override (e.g. deliberately re-seeding an unchanged corpus).
if [ -z "${STALE_OK:-}" ] && git rev-parse --git-dir >/dev/null 2>&1; then
  stale=""
  if ! git diff --quiet -- "$SRC_DIR" 2>/dev/null || ! git diff --cached --quiet -- "$SRC_DIR" 2>/dev/null; then
    stale="uncommitted changes under $SRC_DIR/"
  else
    src_t="$(git log -1 --format=%ct -- "$SRC_DIR" "$GUIDE_DIR/assets" 2>/dev/null || echo 0)"
    pub_t="$(git log -1 --format=%ct -- "$GUIDE_DIR" 2>/dev/null || echo 0)"
    if [ "${src_t:-0}" -gt "${pub_t:-0}" ] 2>/dev/null; then
      stale="guide sources were committed after the PDFs were printed"
    fi
  fi
  if [ -n "$stale" ]; then
    echo "REFUSING to seed: $stale." >&2
    echo "  The corpus would carry text that /guides does not serve." >&2
    echo "  Run 'make guides-pdf' (prints the live pages into $GUIDE_DIR), commit, then re-run." >&2
    echo "  Override with STALE_OK=1 if you know the PDFs are current." >&2
    exit 2
  fi
fi

echo "Seeding guides from $GUIDE_DIR."

# The platform seeds platform content: an ID token for the env's runtime SA,
# which is what ADMIN_SEED_ALLOWED_SAS allowlists (same mint as
# scripts/aiplatform-admin.sh). Needs roles/iam.serviceAccountTokenCreator on it.
SA="aipla-v6@${PROJECT}.iam.gserviceaccount.com"
echo "Minting an admin ID token as ${SA}…"
# stderr suppressed on purpose: the impersonation WARNING otherwise prepends
# onto the JWT and the backend rejects it as malformed (seed-platform-skills.sh).
TOKEN="$(gcloud auth print-identity-token \
  --impersonate-service-account="$SA" \
  --audiences="$BASE_URL" \
  --include-email \
  2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  echo "Empty token — likely missing roles/iam.serviceAccountTokenCreator on $SA." >&2
  exit 1
fi

GUIDE_ADMIN_TOKEN="$TOKEN" BASE_URL="$BASE_URL" GO="${GO:-}" \
  GUIDE_SLUGS="${GUIDE_SLUGS:-}" GUIDE_EXCLUDE="${GUIDE_EXCLUDE:-}" \
  node scripts/seed-guide-corpus.mjs
