#!/usr/bin/env bash
# Audit workspace elements for the dropped-trust-card bug: a component that
# pushes state to the tutor (useSimSnapshotPush) but never dispatches a visible
# card (useHumanToolEvents). A red row is a candidate drop — UNLESS the element
# legitimately needs no card (sends a real chat turn, or is read-only). Those
# allowed exceptions are listed below; anything else red is a likely bug.
#
# Usage: .claude/skills/workbench-element-builder/scripts/audit-trust-cards.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
DIR="$ROOT/frontend/src/components/workspace"

# Elements that share with the tutor WITHOUT an iframe-context card, by design:
#   SolutionElementMount — submit sends a real multimodal chat turn (the turn is
#                          the confirmation; see decision-rule shape C).
ALLOW_NO_CARD="SolutionElementMount"

red=0
printf '%-28s %-7s %-7s %s\n' "COMPONENT" "PUSH" "CARD" "VERDICT"
printf '%-28s %-7s %-7s %s\n' "----------------------------" "-------" "-------" "-------"

for f in "$DIR"/*.tsx; do
  base="$(basename "$f" .tsx)"
  pushes=no; cards=no
  grep -q "useSimSnapshotPush" "$f" && pushes=yes
  grep -q "useHumanToolEvents" "$f" && cards=yes

  [ "$pushes" = no ] && continue  # only pushers are in scope

  if [ "$cards" = yes ]; then
    verdict="ok"
  elif printf '%s\n' "$ALLOW_NO_CARD" | grep -qx "$base"; then
    verdict="ok (no-card by design)"
  else
    verdict="!! PUSH WITHOUT CARD — wire useHumanToolEvents (see SKILL.md)"
    red=$((red + 1))
  fi
  printf '%-28s %-7s %-7s %s\n' "$base" "$pushes" "$cards" "$verdict"
done

echo
if [ "$red" -gt 0 ]; then
  echo "$red component(s) push but don't card. If any is a genuine no-card shape"
  echo "(sends a real turn / read-only), add it to ALLOW_NO_CARD in this script."
  exit 1
fi
echo "All pushing components dispatch a trust card (or are allow-listed). ✓"
