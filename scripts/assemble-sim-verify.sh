#!/usr/bin/env bash
# assemble-sim-verify.sh <ctx_dir> — copy the repo files the sim-verify image
# needs into <ctx_dir>, at their repo-relative paths (verify_sim.mjs resolves
# the repo root from its own location). Used by the Cloud Build pipeline and for
# a local `docker build`. The file list is the whole input: nothing else from
# the repo reaches the image.
set -euo pipefail
CTX="${1:?usage: $0 <ctx_dir>}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$CTX" && mkdir -p "$CTX"
for f in \
  .claude/skills/mcp-app-artefact/scripts/verify_sim.mjs \
  scripts/build-artefact-bridge.mjs \
  infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js \
  infrastructure/mcp-sandbox/vendor.json; do
  mkdir -p "$CTX/$(dirname "$f")" && cp "$REPO/$f" "$CTX/$f"
done
mkdir -p "$CTX/infrastructure/mcp-sandbox" && cp -R "$REPO/infrastructure/mcp-sandbox/vendor-src" "$CTX/infrastructure/mcp-sandbox/"
echo "assembled sim-verify context in $CTX"
