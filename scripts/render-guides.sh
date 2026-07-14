#!/usr/bin/env bash
# Render the AIPLA user guides (docs/guides/*.qmd) to PDF (+ HTML/DOCX).
# Output lands in docs/guides/_output/. Pass extra args through to quarto,
# e.g. scripts/render-guides.sh t2-create-your-first-activity.qmd
set -euo pipefail

cd "$(dirname "$0")/../docs/guides"

# Quarto's project dotenv integration reads the repo's env validation and
# aborts if LOCAL_MODE / NEXT_PUBLIC_LOCAL_MODE are unset. They are irrelevant
# to rendering — provide them so the render proceeds.
export LOCAL_MODE="${LOCAL_MODE:-1}"
export NEXT_PUBLIC_LOCAL_MODE="${NEXT_PUBLIC_LOCAL_MODE:-1}"

# Render every format declared in _quarto.yml (PDF + self-contained HTML).
if [ "$#" -gt 0 ]; then
  quarto render "$@"
else
  quarto render
fi

echo "Guides rendered to docs/guides/_output/ (PDF + HTML)"
