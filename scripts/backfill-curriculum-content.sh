#!/usr/bin/env bash
# One-time backfill of curriculum_content for SHARED docs seeded before 1.1.33 M3.
# Maps the target env to its GCP project and runs the Python backfill against
# that project's Firestore (uses your ADC). Idempotent — safe to re-run.
#
# Usage:
#   scripts/backfill-curriculum-content.sh dev [--dry-run]
#
# Source markdown is read from CURRICULUM_SRC_DIR (defaults to the gitignored
# scoping-site dir, same as seed-curriculum.sh).
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
echo "[backfill] env=${ENV} project=${PROJECT}"
cd "${REPO_ROOT}/backend"
GOOGLE_CLOUD_PROJECT="${PROJECT}" uv run python scripts/backfill_curriculum_content.py "$@"
