#!/usr/bin/env bash
# scaffold_sim.sh — wrapper around `aiplatform sim scaffold <name>`.
#
# Why this exists: the skill is the canonical home of the sim-onboarding
# workflow. When a developer reads the skill they should be able to run a
# command from inside the skill dir, without having to remember the
# global CLI invocation. This script delegates to the CLI if installed,
# and prints a clear install hint if not.
#
# Usage:
#   scripts/scaffold_sim.sh <name> [--title "..."] [--close-label "..."] ...
#
# All arguments are passed through to `aiplatform sim scaffold`.
# See `aiplatform sim scaffold --help` for the full flag set.

set -euo pipefail

if [ "$#" -lt 1 ]; then
    cat <<'USAGE'
Usage: scripts/scaffold_sim.sh <name> [--title "..."] [other flags]

Scaffolds the frontend wiring for a new sim:
  frontend/src/hooks/use<Pascal>Snapshot.ts
  frontend/src/components/workspace/<Pascal>Frame.tsx

NAME must be kebab-case (e.g. 'pendul', 'led-planck').

Example:
  scripts/scaffold_sim.sh pendul \
    --title "Pendul — simulator" \
    --close-label "Luk" \
    --close-aria "Luk simulator" \
    --fullscreen-aria "Skift fuldskærm"

For the full flag list, run:
  aiplatform sim scaffold --help
USAGE
    exit 1
fi

if ! command -v aiplatform >/dev/null 2>&1; then
    cat >&2 <<'NOTE'
Error: the `aiplatform` CLI is not on PATH.

Install it once with:
  make cli-install

Then re-run this script. The script just delegates to:
  aiplatform sim scaffold "$@"
NOTE
    exit 127
fi

exec aiplatform sim scaffold "$@"
