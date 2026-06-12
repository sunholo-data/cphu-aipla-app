#!/usr/bin/env bash
# Seed the SHARED curriculum corpus with the A-level Danish stx physics material
# (1.1.25). Copyright clearance for this material was confirmed 2026-06-12 (M/JB),
# so it enters `source="shared"` with `copyright_status=cleared`.
#
# Source of truth is the scoping site (gitignored, NOT in this repo) — the script
# reads the prepared, ingestable markdown from there. We deliberately do NOT copy
# the curriculum content into this repo (CLAUDE.md: scoping-site sources stay out).
#
# Two documents (the A-level pair):
#   1. læreplan   — Fysik A stx, August 2024 (faglige mål + kernestof) -> rubrics/coverage
#   2. vejledning — Vejledning til Fysik A stx, July 2024 (exam format + guidance)
#
# These are the TEAM-TRANSLATED text-based versions (English) — the artifacts the
# 9-June note marks "A-level ready first". The Danish originals are PDFs (not
# directly ingestable; the endpoint rejects PDF). To also ground Danish
# terminology (design doc use #10), convert the Danish PDFs to text and re-run
# with CURRICULUM_SRC_DIR pointed at them.
#
# Prerequisites:
#   1. The RAG corpus is provisioned for the env + CURRICULUM_RAG_CORPUS_NAME is
#      set on the backend  ->  scripts/provision-curriculum-rag.sh <env>
#      (else docs are stored metadata-only with empty docArtifactId — harmless,
#       but no retrieval until re-ingested with the corpus live).
#   2. The `aiplatform` CLI is installed (make cli-install) and authenticated as
#      a TEACHER (the endpoint is teacher-only). Set AIPLATFORM_ID_TOKEN to a
#      teacher token, or be logged in via the teacher flow.
#
# NOT idempotent: each ingest mints a fresh doc id, so re-running double-adds.
# Run once per env. Check `aiplatform curriculum list --level A --scope shared`
# first if unsure.
#
# Usage:
#   scripts/seed-curriculum-a-level.sh dev
#   CURRICULUM_SRC_DIR=/path/to/danish-text scripts/seed-curriculum-a-level.sh dev
set -euo pipefail

ENV="${1:-dev}"
SRC_DIR="${CURRICULUM_SRC_DIR:-$HOME/Documents/clients/cph-uni/sources/curriculum}"
ORIGIN_BASE="uvm.dk"

LAEREPLAN="${SRC_DIR}/translated_physics_a_stx_august_2024_text_based.md"
VEJLEDNING="${SRC_DIR}/translated_guide_to_physics_a_stx_july_2024.md"

log() { echo "[$(date +%H:%M:%S)] $*"; }
die() {
  echo "ERROR: $*" >&2
  exit 1
}

command -v aiplatform >/dev/null 2>&1 || die "aiplatform CLI not found — run 'make cli-install'"
[ -f "$LAEREPLAN" ] || die "læreplan not found: ${LAEREPLAN} (set CURRICULUM_SRC_DIR)"
[ -f "$VEJLEDNING" ] || die "vejledning not found: ${VEJLEDNING} (set CURRICULUM_SRC_DIR)"

log "Seeding A-level curriculum into the SHARED corpus (env=${ENV})"
log "Source dir: ${SRC_DIR}"

log "1/2 ingesting læreplan (Fysik A stx, August 2024)…"
aiplatform --env "$ENV" curriculum ingest "$LAEREPLAN" \
  --level A \
  --title "Fysik A (læreplan, august 2024)" \
  --origin "${ORIGIN_BASE} — Fysik A stx læreplan" \
  --shared --copyright cleared

log "2/2 ingesting vejledning (Vejledning til Fysik A stx, July 2024)…"
aiplatform --env "$ENV" curriculum ingest "$VEJLEDNING" \
  --level A \
  --title "Vejledning til Fysik A (juli 2024)" \
  --origin "${ORIGIN_BASE} — Vejledning til Fysik A stx" \
  --shared --copyright cleared

log "Done. Verify: aiplatform --env ${ENV} curriculum list --level A --scope shared"
log "Smoke retrieval: aiplatform --env ${ENV} curriculum query \"faglige mål for fysik A\" --level A"
