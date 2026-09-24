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

# --- Gate 7: no nested iframe (the artefact IS the sandboxed frame; frame-src 'none') ---
iframe_hits=$(grep -REn "<iframe" "$ART_PATH" 2>/dev/null || true)
if [ -z "$iframe_hits" ]; then
    check "No nested <iframe>" "pass"
else
    check "No nested <iframe>" "fail"
    echo "$iframe_hits" | head -5 | sed 's/^/      /'
fi

# --- Gate 8: no dynamic code / sockets (CSP blocks them; fails as a blank frame) ---
# The bridge legitimately uses postMessage, not these.
exec_hits=$(grep -REn "\beval\(|new Function\(|new WebSocket\(" "$ART_PATH" 2>/dev/null || true)
if [ -z "$exec_hits" ]; then
    check "No eval / new Function / WebSocket" "pass"
else
    check "No eval / new Function / WebSocket" "fail"
    echo "$exec_hits" | head -5 | sed 's/^/      /'
fi

# --- Gate 9: no layout min-width above 600px ---
# A `@media (min-width: 720px)` breakpoint is correct and expected; a min-width
# PROPERTY wider than the ~700px workspace pane forces a horizontal scrollbar.
minw_hits=$(grep -REn "min-width[[:space:]]*:[[:space:]]*[0-9]+px" "$ART_PATH" 2>/dev/null \
    | grep -v "@media" \
    | awk '{ if (match($0, /min-width[ \t]*:[ \t]*[0-9]+px/)) {
                 v = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", v);
                 if (v + 0 > 600) print } }' || true)
if [ -z "$minw_hits" ]; then
    check "No min-width property above 600px" "pass"
else
    check "No min-width property above 600px" "fail"
    echo "$minw_hits" | head -5 | sed 's/^/      /'
fi

# --- Gate 10: nothing below 11px ---
# 0.68rem is 10.9px at a 16px base and is the size that actually gets typed.
small_px=$(grep -REn "font-size[[:space:]]*:[[:space:]]*[0-9.]+px" "$ART_PATH" 2>/dev/null \
    | awk '{ if (match($0, /font-size[ \t]*:[ \t]*[0-9.]+px/)) {
                 v = substr($0, RSTART, RLENGTH); gsub(/[^0-9.]/, "", v);
                 if (v + 0 < 11) print } }' || true)
small_rem=$(grep -REn "font-size[[:space:]]*:[[:space:]]*[0-9.]+rem" "$ART_PATH" 2>/dev/null \
    | awk '{ if (match($0, /font-size[ \t]*:[ \t]*[0-9.]+rem/)) {
                 v = substr($0, RSTART, RLENGTH); gsub(/[^0-9.]/, "", v);
                 if (v + 0 < 0.6875) print } }' || true)
small_hits=$(printf '%s\n%s' "$small_px" "$small_rem" | sed '/^$/d')
if [ -z "$small_hits" ]; then
    check "No text below 11px" "pass"
else
    check "No text below 11px" "fail"
    echo "$small_hits" | head -5 | sed 's/^/      /'
fi

# --- Gate 11: the shared guest bridge is present and unmodified in shape ---
if grep -q "@aipla-bridge:start" "$ART_PATH/index.html" 2>/dev/null \
   && grep -q "@aipla-bridge:end" "$ART_PATH/index.html" 2>/dev/null; then
    check "Guest bridge block present" "pass"
else
    check "Guest bridge block present" "fail"
    echo "      Without it the sim cannot talk to the host. Scaffold from _template," \
         | sed 's/^/      /'
    echo "      or re-stamp with 'make sim-build'." | sed 's/^/      /'
fi

# --- Gate 12: every <script src> is a vendored library, pinned and SRI-checked ---
# The ONLY non-inline script an artefact may load is a file listed in
# infrastructure/mcp-sandbox/vendor.json, by its absolute /vendor/... path (the
# artefact is document.written into the sandbox frame, so relative paths resolve
# against sandbox.html, not the artefact), with integrity="sha384-<manifest hash>"
# and crossorigin="anonymous" (without which the browser skips the SRI check).
# See resources/vendored-libraries.md.
VENDOR_JSON="$(cd "$(dirname "$0")/../../../.." 2>/dev/null && pwd)/infrastructure/mcp-sandbox/vendor.json"
src_problems=$(node "$(dirname "$0")/check_vendor_scripts.cjs" "$ART_PATH" "$VENDOR_JSON" 2>&1)
if [ -z "$src_problems" ]; then
    check "Script src only to pinned, SRI-checked /vendor/ libraries" "pass"
else
    check "Script src only to pinned, SRI-checked /vendor/ libraries" "fail"
    echo "$src_problems" | head -5 | sed 's/^/      /'
fi

echo ""
if [ "$fail" -eq 0 ]; then
    echo "All automated gates passed for $ART_NAME."
    echo ""
    echo "This script only reads the file. It has NOT checked that the sim runs,"
    echo "fits, or emits anything. Next:"
    echo "  make sim-build-check                     # bridge drift + broadcast floor"
    echo "  node <skill>/scripts/verify_sim.mjs <id> --drive   # self-test, viewports, events"
    echo "  ...then drive it as a student for 60 seconds (resources/pre-ship-checklist.md)"
    exit 0
else
    echo "One or more gates failed. Fix the issues above and re-run."
    exit 1
fi
