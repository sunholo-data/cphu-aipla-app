#!/usr/bin/env bash
# Screenshots of the built-in sims, for the sim picker / activity thumbnails and
# for the activity co-pilot to look at (backend/artefacts/screenshots/).
#
#   scripts/sim-screenshots.sh            # every catalogued built-in sim
#   scripts/sim-screenshots.sh boldkast   # one
#
# Each sim is opened in real Chromium by the same verify_sim.mjs the Sim workshop
# uses; two shots are kept: <id>-700.png (at rest, 700 px wide: the thumbnail)
# and <id>-driven.png (after the script has clicked through it). Re-run after
# changing a sim's look; test_artefact_screenshots.py fails while a live sim has none.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/backend/artefacts/screenshots"
VERIFY="$ROOT/.claude/skills/mcp-app-artefact/scripts/verify_sim.mjs"
mkdir -p "$OUT"

if [ $# -gt 0 ]; then
  ids=("$@")
else
  ids=()
  for y in "$ROOT"/backend/artefacts/*.yaml; do ids+=("$(basename "$y" .yaml)"); done
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failed=0
for id in "${ids[@]}"; do
  if [ ! -f "$ROOT/infrastructure/mcp-sandbox/artefacts/$id/v1/index.html" ]; then
    echo "✗ $id: no infrastructure/mcp-sandbox/artefacts/$id/v1/index.html" >&2
    failed=1
    continue
  fi
  mkdir -p "$tmp/$id"
  node "$VERIFY" "$id" --drive --out "$tmp/$id" --json "$tmp/$id/r.json" >"$tmp/$id/log" 2>&1 || true
  ok=1
  for shot in 700 driven; do
    if [ -f "$tmp/$id/$id-$shot.png" ]; then
      cp "$tmp/$id/$id-$shot.png" "$OUT/$id-$shot.png"
    else
      ok=0
    fi
  done
  if [ "$ok" = 1 ]; then
    echo "✓ $id ($(du -k "$OUT/$id-700.png" | cut -f1) KB + $(du -k "$OUT/$id-driven.png" | cut -f1) KB)"
  else
    echo "✗ $id: the browser run produced no screenshots; its log:" >&2
    tail -20 "$tmp/$id/log" >&2
    failed=1
  fi
done
exit $failed
