#!/usr/bin/env bash
# audit_artefact.sh — automate the ADR-013 + size checks from
# resources/pre-ship-checklist.md.
#
# Runs four cheap greps + a `du` against an artefact directory. Exits 0
# when all checks pass; non-zero (with a per-failure summary) otherwise.
# This is NOT a substitute for the manual multi-width usability check —
# that's still in the checklist and still on you.
#
# Usage:
#   scripts/audit_artefact.sh <artefact_dir>
#
# Example:
#   scripts/audit_artefact.sh infrastructure/mcp-sandbox/artefacts/boldkast/v1

set -uo pipefail

DIR="${1:-}"
if [ -z "$DIR" ] || [ ! -d "$DIR" ]; then
    echo "Usage: $0 <artefact_dir>" >&2
    echo "" >&2
    echo "Pass the path to an MCP App artefact directory, e.g." >&2
    echo "  infrastructure/mcp-sandbox/artefacts/<name>/v<n>" >&2
    exit 1
fi

ART_PATH="$(cd "$DIR" && pwd)"
ART_NAME="$(basename "$(dirname "$ART_PATH")")"
echo "Auditing: $ART_PATH"
echo ""

fail=0

check() {
    local label="$1"
    local result="$2"
    if [ "$result" = "pass" ]; then
        echo "  OK   $label"
    else
        echo "  FAIL $label"
        fail=1
    fi
}

# --- Gate 1: no external fetches ---
fetch_hits=$(grep -REn "https?://(?!aipla-v01-sandbox)|fetch\(|XMLHttpRequest|import\([\"']http" "$ART_PATH" 2>/dev/null | grep -v "^$ART_PATH/[^/]*\.map:" || true)
if [ -z "$fetch_hits" ]; then
    check "No external HTTP fetches" "pass"
else
    check "No external HTTP fetches" "fail"
    echo "$fetch_hits" | head -5 | sed 's/^/      /'
    if [ "$(echo "$fetch_hits" | wc -l)" -gt 5 ]; then
        echo "      (… and more — re-run grep manually to see all)"
    fi
fi

# --- Gate 2: no inline <script src="http..."> tags ---
script_hits=$(grep -REn '<script[^>]*src=["'"'"']https?://' "$ART_PATH" 2>/dev/null || true)
if [ -z "$script_hits" ]; then
    check "No <script src> to external origins" "pass"
else
    check "No <script src> to external origins" "fail"
    echo "$script_hits" | head -5 | sed 's/^/      /'
fi

# --- Gate 3: no CDN URLs in CSS @import / url(...) / <link href> ---
css_hits=$(grep -REn "@import\s+[\"']https?://|url\(\s*[\"']\?https?://|<link[^>]*href=[\"']https?://" "$ART_PATH" 2>/dev/null || true)
if [ -z "$css_hits" ]; then
    check "No CDN URLs in CSS/links" "pass"
else
    check "No CDN URLs in CSS/links" "fail"
    echo "$css_hits" | head -5 | sed 's/^/      /'
fi

# --- Gate 4: bundle ≤ 200 KB ---
size_k=$(du -sk "$ART_PATH" | awk '{print $1}')
if [ "$size_k" -le 200 ]; then
    check "Bundle size ≤ 200 KB (actual: ${size_k} KB)" "pass"
else
    check "Bundle size ≤ 200 KB (actual: ${size_k} KB)" "fail"
fi

# --- Gate 5: index.html exists ---
if [ -f "$ART_PATH/index.html" ]; then
    check "index.html present" "pass"
else
    check "index.html present" "fail"
fi

# --- Gate 6: dark-theme sanity check ---
dark_hits=$(grep -REn "prefers-color-scheme:\s*dark|background:\s*#?[01]{6}\b|background:\s*black|background-color:\s*#?[01]{6}\b" "$ART_PATH" 2>/dev/null || true)
if [ -z "$dark_hits" ]; then
    check "No dark-theme rules / hard-black backgrounds" "pass"
else
    check "No dark-theme rules / hard-black backgrounds" "fail"
    echo "$dark_hits" | head -5 | sed 's/^/      /'
fi

echo ""
if [ "$fail" -eq 0 ]; then
    echo "All automated gates passed for $ART_NAME."
    echo ""
    echo "Remaining manual checks (see resources/pre-ship-checklist.md):"
    echo "  - Multi-width fit (360 / 700 / 1024 / 1440 px)"
    echo "  - Touch test on a real device"
    echo "  - End-to-end smoke against deployed dev"
    exit 0
else
    echo "One or more gates failed. Fix the issues above and re-run."
    exit 1
fi
