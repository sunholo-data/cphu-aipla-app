#!/bin/bash
# AIPLA — scaffold a new MCP App artefact from the template.
#
# Usage:
#   ./scripts/new-artefact.sh <name> [title]
#
# Examples:
#   ./scripts/new-artefact.sh wave-superposition
#   ./scripts/new-artefact.sh energy-pendulum "Energi-bevarelse — pendul"
#
# Creates infrastructure/mcp-sandbox/artefacts/<name>/v1/index.html from
# the template, substituting {{ARTEFACT_NAME}} and {{ARTEFACT_TITLE}}.
# Verifies the file passes the safety/size gates.
#
# After scaffolding:
#   1. Edit index.html — replace the TODO blocks with the actual physics
#      + UI for your problem.
#   2. Test locally: open
#      http://localhost:3457/artefacts/<name>/v1/index.html
#   3. Validate the self-test:
#      open http://localhost:3457/artefacts/<name>/v1/index.html?test=1
#      and check the tab title says "TEST PASS".
#   4. Wire a launcher into the workspace (see Boldkast for the pattern).
#   5. Commit + push — the aipla-mcp-sandbox-deploy trigger picks it up.

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <name> [title]"
    echo "  <name>  : kebab-case identifier (used in path + postMessage source)"
    echo "  [title] : Danish title shown to the student (default: Title Cased name)"
    exit 1
fi

NAME="$1"
TITLE="${2:-$(echo "$NAME" | sed -E 's/-/ /g; s/\b(.)/\u\1/g')}"

# Validate the name (must be kebab-case, no spaces, lowercase + digits + hyphens).
if ! echo "$NAME" | grep -qE '^[a-z][a-z0-9-]*[a-z0-9]$'; then
    echo "Error: <name> must be kebab-case (lowercase letters, digits, hyphens). Got: $NAME" >&2
    exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$REPO_ROOT/infrastructure/mcp-sandbox/artefacts/_template/v1/index.html"
TARGET_DIR="$REPO_ROOT/infrastructure/mcp-sandbox/artefacts/$NAME/v1"
TARGET="$TARGET_DIR/index.html"

if [ ! -f "$TEMPLATE" ]; then
    echo "Error: template not found at $TEMPLATE" >&2
    exit 3
fi

if [ -e "$TARGET" ]; then
    echo "Error: $TARGET already exists. Pick a new <name> or remove it first." >&2
    exit 4
fi

mkdir -p "$TARGET_DIR"

# Substitute placeholders. Using sed with | as delimiter so titles can
# contain / safely; double-escape any | in the inputs.
ESC_NAME=$(printf '%s' "$NAME" | sed 's/[\&|]/\\&/g')
ESC_TITLE=$(printf '%s' "$TITLE" | sed 's/[\&|]/\\&/g')
sed -e "s|{{ARTEFACT_NAME}}|$ESC_NAME|g" \
    -e "s|{{ARTEFACT_TITLE}}|$ESC_TITLE|g" \
    "$TEMPLATE" > "$TARGET"

# Safety gates — fail loudly if the scaffolded file already breaks rules.
SIZE=$(wc -c < "$TARGET" | tr -d ' ')
if [ "$SIZE" -gt 204800 ]; then
    echo "Error: scaffolded artefact is $SIZE bytes — over the 200 KB ADR-013 cap." >&2
    rm -f "$TARGET"; rmdir "$TARGET_DIR" 2>/dev/null || true
    exit 5
fi

if grep -qE 'src="http|href="http|fetch\(|XMLHttpRequest|WebSocket|eval\(' "$TARGET"; then
    echo "Error: scaffolded artefact contains a forbidden external-fetch pattern." >&2
    rm -f "$TARGET"; rmdir "$TARGET_DIR" 2>/dev/null || true
    exit 6
fi

# Summary
echo "✓ Created $TARGET"
echo "  size: $SIZE bytes ($(awk "BEGIN { printf \"%.1f\", $SIZE / 1024 }") KB)"
echo "  name: $NAME"
echo "  title: $TITLE"
echo ""
echo "Next steps:"
echo "  1. Edit:   $TARGET"
echo "     Replace the TODO blocks with your actual physics + UI."
echo "  2. Test:   open http://localhost:3457/artefacts/$NAME/v1/index.html"
echo "  3. Self-test: append ?test=1 — tab title should read TEST PASS"
echo "  4. Read:   .claude/skills/mcp-app-artefact/SKILL.md for the full recipe."
echo "  5. Commit + push — aipla-mcp-sandbox-deploy fires + deploys."
