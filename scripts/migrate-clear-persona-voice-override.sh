#!/usr/bin/env bash
# One-time migration: clear stale per-class voice overrides on classes that
# already name a persona, so the persona's voice takes effect (was the bug where
# switching persona changed the avatar but not the spoken voice). Idempotent.
#
# Usage:
#   scripts/migrate-clear-persona-voice-override.sh dev [--dry-run]
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
echo "[migrate] env=${ENV} project=${PROJECT}"
cd "${REPO_ROOT}/backend"
GOOGLE_CLOUD_PROJECT="${PROJECT}" uv run python scripts/migrate_clear_persona_voice_override.py "$@"
