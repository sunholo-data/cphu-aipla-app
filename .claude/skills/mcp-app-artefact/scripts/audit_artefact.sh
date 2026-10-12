#!/usr/bin/env bash
# audit_artefact.sh — the static sim gates, for an artefact directory.
#
# A wrapper. The gates live in ONE place, backend/sim_gates/ (python -m sim_gates),
# which the benchmark, the in-app authoring agent and the sim-verify service call
# too. Until 2026-10-12 this script held its own bash copy, and its gate 1 (no
# external fetches) never checked anything: an invalid lookahead made grep exit 2,
# 2>/dev/null hid it, and the empty result counted as a pass.
#
# Usage:
#   scripts/audit_artefact.sh <artefact_dir>          # tier A: safe and well-formed (as before)
#   scripts/audit_artefact.sh <artefact_dir> --all    # + B prompt conformance, C YAML agreement
#   scripts/audit_artefact.sh <artefact_dir> --all --hidden g 9.82   # + D the derived quantity stays hidden
#
# This is NOT a substitute for running the sim (verify_sim.mjs) or the manual
# usability check in resources/pre-ship-checklist.md.

set -uo pipefail

DIR="${1:-}"
if [ -z "$DIR" ] || [ ! -d "$DIR" ]; then
    echo "Usage: $0 <artefact_dir> [--all] [--hidden TERM ...]" >&2
    echo "  e.g. $0 infrastructure/mcp-sandbox/artefacts/<name>/v1" >&2
    exit 1
fi
shift

TIERS="A"
EXTRA=()
while [ $# -gt 0 ]; do
    case "$1" in
        --all) TIERS="A,B,C" ;;
        --hidden) shift; TIERS="${TIERS/%C/C,D}"; [ "$TIERS" = "A" ] && TIERS="A,D"; EXTRA+=(--hidden); while [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; do EXTRA+=("$1"); shift; done; continue ;;
        *) echo "unknown option: $1" >&2; exit 1 ;;
    esac
    shift
done

ART_PATH="$(cd "$DIR" && pwd)"
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

(cd "$REPO_ROOT/backend" && uv run --quiet python -m sim_gates "$ART_PATH" --tiers "$TIERS" "${EXTRA[@]+"${EXTRA[@]}"}")
status=$?

echo ""
if [ "$status" -eq 0 ]; then
    echo "This only reads the file. It has NOT checked that the sim runs, fits, or"
    echo "emits anything. Next:"
    echo "  make sim-build-check                               # bridge drift + broadcast floor"
    echo "  node <skill>/scripts/verify_sim.mjs <id> --drive   # self-test, viewports, events"
    echo "  ...then drive it as a student for 60 seconds (resources/pre-ship-checklist.md)"
fi
exit "$status"
