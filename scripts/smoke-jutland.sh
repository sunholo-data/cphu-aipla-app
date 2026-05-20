#!/usr/bin/env bash
# scripts/smoke-jutland.sh — shell wrapper for the AIPLA v0.1 Jutland smoke.
#
# Convenience: lets ops run the smoke from a checked-out tree without
# remembering the click invocation. Pass --url to override the env-based
# URL resolution.
#
# Usage:
#   scripts/smoke-jutland.sh                              # local backend
#   scripts/smoke-jutland.sh https://aipla-v01-XXX.run.app
#   scripts/smoke-jutland.sh https://...  GRP-CODE-HERE   # with group code
set -euo pipefail

URL_FLAG=()
if [ -n "${1:-}" ]; then
  URL_FLAG=(--url "$1")
fi
GROUP_FLAG=()
if [ -n "${2:-}" ]; then
  GROUP_FLAG=(--group-code "$2")
fi

# Run from cli/ so editable-installed `aiplatform` is on PATH inside uv.
cd "$(dirname "$0")/../cli"
uv run aiplatform smoke jutland "${URL_FLAG[@]}" "${GROUP_FLAG[@]}"
