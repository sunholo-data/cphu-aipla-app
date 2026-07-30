#!/usr/bin/env bash
# 1.1.60 migration: seed the nine Danish stx physics areas as SHARED curriculum
# folders, and relocate any doc still carrying a physics area in `subject` onto
# the new model (subject = broad class "Fysik", folder = the area).
#
# Maps the target env to its GCP project and runs against that project's
# Firestore (uses your ADC). Idempotent — safe to re-run.
#
# Usage:
#   scripts/seed-curriculum-folders.sh dev --dry-run   # inspect first
#   scripts/seed-curriculum-folders.sh dev
set -euo pipefail

ENV="${1:-dev}"
shift || true

case "$ENV" in
dev) PROJECT="aipla-dev-2026" ;;
test) PROJECT="aipla-test-2026" ;;
prod) PROJECT="aipla-prod-2026" ;;
*)
  echo "ERROR: unknown env '${ENV}' (use dev/test/prod)" >&2
  exit 1
  ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "[seed-folders] env=${ENV} project=${PROJECT}"
cd "${REPO_ROOT}/backend"
GOOGLE_CLOUD_PROJECT="${PROJECT}" uv run python scripts/seed_curriculum_folders.py "$@"
