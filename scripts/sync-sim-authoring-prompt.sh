#!/usr/bin/env bash
# sync-sim-authoring-prompt.sh — publish the sim authoring prompt, from one source.
#
# The prompt physics staff paste into Claude / ChatGPT to draft a simulation
# lives in ONE place: the fenced ````text block in
#   .claude/skills/mcp-app-artefact/resources/authoring-prompt.md
# That file is in .claude/, which no public surface serves — so until
# 2026-09-14 the R2 guide said "ask M or AD to send it to you". This script
# derives the two public copies from it:
#   frontend/public/sim-authoring-prompt.txt          raw text, for a chat to
#                                                     fetch by URL
#   frontend/content/project/build-a-simulation.md    the /project page, between
#                                                     the sim-prompt markers
#
# Generated, never hand-edited — same discipline as the tutor docs
# (`make tutor-docs` / `make check-tutor-docs`). Edit the skill resource, run
# `make sim-prompt`, commit all three. `--check` (CI) fails on drift.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=.claude/skills/mcp-app-artefact/resources/authoring-prompt.md
TXT=frontend/public/sim-authoring-prompt.txt
PAGE=frontend/content/project/build-a-simulation.md
START='<!-- sim-prompt:start -->'
END='<!-- sim-prompt:end -->'

MODE="${1:-write}"

# The prompt is the first ````text … ```` block in the source.
extract() {
  awk '
    /^````text[[:space:]]*$/ && !started { started=1; next }
    started && /^````[[:space:]]*$/ { exit }
    started { print }
  ' "$SRC"
}

PROMPT="$(extract)"
[ -n "$PROMPT" ] || { echo "ERROR: no \`\`\`\`text block found in $SRC" >&2; exit 2; }
if grep -q '^```' <<<"$PROMPT"; then
  echo "ERROR: the prompt contains a triple-backtick fence, which would break the page's own fence" >&2
  exit 2
fi

# The page carries the prompt in a plain fence with a copy button; the txt is
# the bare prompt with a trailing newline.
WANT_TXT="$PROMPT"$'\n'
WANT_BLOCK="$START"$'\n''```text'$'\n'"$PROMPT"$'\n''```'$'\n'"$END"

[ -f "$PAGE" ] || { echo "ERROR: $PAGE missing" >&2; exit 2; }
grep -q "^$START\$" "$PAGE" && grep -q "^$END\$" "$PAGE" \
  || { echo "ERROR: $PAGE lacks the $START / $END markers" >&2; exit 2; }

# Rebuild the page: everything before START, the block, everything after END.
# (The block goes via a file: BSD awk rejects a -v value containing newlines.)
BLOCK_FILE="$(mktemp "${TMPDIR:-/tmp}/sim-prompt.XXXXXX")"
trap 'rm -f "$BLOCK_FILE"' EXIT
printf '%s\n' "$WANT_BLOCK" > "$BLOCK_FILE"
WANT_PAGE="$(awk -v start="$START" -v end="$END" -v blockfile="$BLOCK_FILE" '
  $0 == start { while ((getline line < blockfile) > 0) print line; close(blockfile); skipping=1; next }
  $0 == end   { skipping=0; next }
  !skipping   { print }
' "$PAGE")"$'\n'

if [ "$MODE" = "--check" ]; then
  rc=0
  if [ ! -f "$TXT" ] || [ "$(cat "$TXT")" != "$PROMPT" ]; then
    echo "DRIFT: $TXT does not match the prompt in $SRC" >&2; rc=1
  fi
  if [ "$(cat "$PAGE")" != "${WANT_PAGE%$'\n'}" ]; then
    echo "DRIFT: $PAGE's sim-prompt block does not match $SRC" >&2; rc=1
  fi
  [ $rc -eq 0 ] && echo "sim authoring prompt: in sync ($TXT, $PAGE)"
  [ $rc -eq 0 ] || echo "  fix: make sim-prompt" >&2
  exit $rc
fi

printf '%s' "$WANT_TXT" > "$TXT"
printf '%s' "$WANT_PAGE" > "$PAGE"
echo "wrote $TXT ($(wc -c <"$TXT" | tr -d ' ') bytes) and updated $PAGE"
