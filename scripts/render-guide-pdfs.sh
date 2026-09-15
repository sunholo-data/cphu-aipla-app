#!/usr/bin/env bash
# Print every guide page to PDF with Playwright — the replacement for
# `quarto render --to pdf` (1.1.116).
#
#   make guides-pdf                                  # deployed dev
#   make guides-pdf BASE_URL=http://localhost:3456   # your local dev server
#
# The slug list comes from frontend/content/guides/ so a new guide is picked up
# without editing anything here. The PDFs land in frontend/public/guides/ and
# are committed: they are what /guides links and what `make seed-guide-corpus`
# ingests into the shared corpus.
set -euo pipefail

cd "$(dirname "$0")/.."

BASE="${BASE_URL:-https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app}"

SLUGS="$(cd frontend/content/guides && ls -1 *.md | sed 's/\.md$//' | tr '\n' ' ')"
[ -n "$SLUGS" ] || { echo "No guides found in frontend/content/guides/"; exit 1; }

echo "Printing guides from $BASE"

cd docs/guides/screenshots
if [ ! -d node_modules ]; then
  echo "Installing Playwright…"
  npm install
  npx playwright install chromium
fi

BASE_URL="$BASE" GUIDE_SLUGS="$SLUGS" node print-pdfs.mjs
