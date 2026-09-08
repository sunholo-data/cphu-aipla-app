#!/usr/bin/env bash
#
# check-stream-render-allowlist.sh — every tool result the CLIENT parses by name
# must be allow-listed in the SSE redaction filter.
#
# Why this exists (1.1.101, 2026-09-08). The filter's default was inverted from
# "redact if in TOOL_REGISTRY" to "redact unless declared renderable". That is
# the right default — an unrecognised tool is the one nobody reviewed — but it
# turned a pre-existing accident into a silent regression:
#
#   mark_checklist_item is parsed by ChecklistMarkCard, and is NOT in
#   TOOL_REGISTRY. Under the old rule it passed as an "unknown name" — the same
#   loophole that let teacher-authored tools through. Under the new rule it was
#   redacted, and the card would simply have stopped rendering. No error, no log
#   line: the student just stops seeing their checklist marks.
#
# Caught by hand on the way to prod. This is the mechanical version, because the
# next card will be added by someone who has never read stream_redaction.py.
#
# The check is deliberately one-directional: every name the frontend renders
# must be allowed. The reverse (an allow-listed name nothing renders) is fine —
# it is dead weight, not a leak.
#
# Usage: scripts/check-stream-render-allowlist.sh   (make check-stream-allowlist)
set -uo pipefail
cd "$(dirname "$0")/.."

FILTER="backend/adk/stream_redaction.py"
[ -f "$FILTER" ] || { echo "SKIP: $FILTER not found"; exit 0; }

# Names the client special-cases by tool name, e.g.  tc.name === "record_checkpoint"
# NB: `mapfile` is bash 4+; macOS ships bash 3.2, so read into a plain string.
RENDERED="$(
  grep -rhoE '(tc|toolCall)\.name === "[a-z_]+"' frontend/src \
    --include='*.tsx' --include='*.ts' 2>/dev/null \
  | grep -oE '"[a-z_]+"' | tr -d '"' | sort -u
)"

if [ -z "$RENDERED" ]; then
  echo "OK: no client-rendered tool names found (nothing to check)."
  exit 0
fi

fail=0
count=0
for name in $RENDERED; do
  count=$((count + 1))
  # Teacher-only surfaces are exempt: teacher streams are never redacted.
  if grep -rl "\"$name\"" frontend/src --include='*.tsx' 2>/dev/null \
     | grep -qvE 'app/teacher/|components/teacher/'; then
    if ! grep -qE "^\s*\"$name\"," "$FILTER"; then
      echo "FAIL: the client renders '$name' but it is not allow-listed in $FILTER."
      echo "      A student would see the redaction sentinel instead of the card."
      echo "      Add it to _CLIENT_RENDER_TOOLS with a reason, or confirm the"
      echo "      surface is teacher-only."
      fail=1
    fi
  fi
done

[ "$fail" -eq 0 ] && echo "OK: all ${count} client-rendered tool result(s) are allow-listed."
exit "$fail"
