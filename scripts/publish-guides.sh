#!/usr/bin/env bash
# Render the guides and publish the self-contained HTML + PDF into the frontend
# so they are served statically and linkable from the app (teacher sidebar,
# student join/lessons, landing page → the /guides index).
#
#   make guides-publish
#
# The published files under frontend/public/guides/ are committed so the app
# ships them; re-run whenever a guide changes.
set -euo pipefail

cd "$(dirname "$0")/.."

scripts/render-guides.sh

DEST="frontend/public/guides"
mkdir -p "$DEST"
cp docs/guides/_output/*.html "$DEST"/
cp docs/guides/_output/*.pdf "$DEST"/

echo "Published $(ls "$DEST"/*.html | wc -l | tr -d ' ') guides to $DEST/"
