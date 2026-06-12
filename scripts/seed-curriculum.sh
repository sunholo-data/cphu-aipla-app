#!/usr/bin/env bash
# Seed the SHARED curriculum corpus with the cleared Danish stx physics material
# (1.1.25). Copyright clearance confirmed 2026-06-12 (M); these enter
# source="shared" with copyright_status=cleared.
#
# Source of truth is the scoping site (gitignored, NOT in this repo) — the script
# reads the prepared markdown from there. We deliberately do NOT copy the
# curriculum content into this repo (CLAUDE.md: scoping-site sources stay out).
#
# Each level has the læreplan + vejledning pair (Danish, to ground the tutor in
# the exact stx terminology students see — design-doc use #10). The Danish source
# PDFs were parsed to markdown with the `docparse` CLI:
#   docparse <file>.pdf --output-dir <dst>     # deterministic pdftotext
# then placed in CURRICULUM_SRC_DIR with the names in the table below.
# (The ingest endpoint rejects PDF, so parse-to-md first.)
#
# Prerequisites:
#   1. The RAG corpus is provisioned + CURRICULUM_RAG_CORPUS_NAME is set on the
#      backend  ->  scripts/provision-curriculum-rag.sh <env>
#      (else docs store metadata-only with empty docArtifactId — no retrieval).
#   2. The `aiplatform` CLI is installed (make cli-install) and authenticated as
#      a TEACHER (the endpoint is teacher-only).
#
# NOT idempotent: each ingest mints a fresh doc id, so re-running double-adds.
# Run once per env. Check `aiplatform curriculum list --scope shared` first.
#
# Usage:
#   scripts/seed-curriculum.sh dev            # all levels (A B C)
#   scripts/seed-curriculum.sh dev "A"        # just A
#   CURRICULUM_LEVELS="B C" scripts/seed-curriculum.sh dev
set -euo pipefail

ENV="${1:-dev}"
LEVELS="${2:-${CURRICULUM_LEVELS:-A B C}}"
SRC_DIR="${CURRICULUM_SRC_DIR:-$HOME/Documents/clients/cph-uni/sources/curriculum}"
ORIGIN_BASE="uvm.dk"

log() { echo "[$(date +%H:%M:%S)] $*"; }
die() {
  echo "ERROR: $*" >&2
  exit 1
}

# Per-level file map: laereplan + vejledning markdown filenames in SRC_DIR.
# C's læreplan is the 2017 edition (latest); the vejledningers are 2024.
laereplan_file() {
  case "$1" in
  A) echo "fysik_a_stx_laereplan_2024_da.md" ;;
  B) echo "fysik_b_stx_laereplan_2024_da.md" ;;
  C) echo "fysik_c_stx_laereplan_2017_da.md" ;;
  esac
}
vejledning_file() {
  case "$1" in
  A) echo "fysik_a_stx_vejledning_2024_da.md" ;;
  B) echo "fysik_b_stx_vejledning_2024_da.md" ;;
  C) echo "fysik_c_stx_vejledning_2024_da.md" ;;
  esac
}

command -v aiplatform >/dev/null 2>&1 || die "aiplatform CLI not found — run 'make cli-install'"

log "Seeding SHARED curriculum (env=${ENV}, levels=${LEVELS})"
log "Source dir: ${SRC_DIR}"

for L in $LEVELS; do
  case "$L" in A | B | C) ;; *) die "invalid level '${L}' (use A/B/C)" ;; esac
  LP="${SRC_DIR}/$(laereplan_file "$L")"
  VJ="${SRC_DIR}/$(vejledning_file "$L")"
  [ -f "$LP" ] || die "level ${L} læreplan not found: ${LP} (parse with docparse first)"
  [ -f "$VJ" ] || die "level ${L} vejledning not found: ${VJ} (parse with docparse first)"

  log "[$L] 1/2 ingesting læreplan…"
  aiplatform --env "$ENV" curriculum ingest "$LP" \
    --level "$L" \
    --title "Fysik ${L} (læreplan)" \
    --origin "${ORIGIN_BASE} — Fysik ${L} stx læreplan" \
    --shared --copyright cleared

  log "[$L] 2/2 ingesting vejledning…"
  aiplatform --env "$ENV" curriculum ingest "$VJ" \
    --level "$L" \
    --title "Vejledning til Fysik ${L}" \
    --origin "${ORIGIN_BASE} — Vejledning til Fysik ${L} stx" \
    --shared --copyright cleared
done

log "Done. Verify: aiplatform --env ${ENV} curriculum list --scope shared"
log "Smoke retrieval: aiplatform --env ${ENV} curriculum query \"faglige mål for fysik A\" --level A"
