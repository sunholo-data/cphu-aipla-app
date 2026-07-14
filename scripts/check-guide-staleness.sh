#!/usr/bin/env bash
# Flag user guides that may be out of date: for each guide, compare the last
# commit that touched the guide (its .qmd + screenshots) against the last commit
# that touched each UI surface it documents (docs/guides/guide-surfaces.json).
# If a documented surface changed AFTER the guide, the guide is likely stale.
#
#   make guide-staleness            # report (exit 0 even if stale)
#   ./scripts/check-guide-staleness.sh --strict   # exit 1 if any guide is stale (CI)
#
# This is a heuristic, not a proof — a surface change may not affect the guide.
# It's a prompt to look, and to re-run `make guide-screens && make guides-publish`
# (+ `make seed-guide-corpus` for a fresh env) when a guide really did drift.
set -euo pipefail

cd "$(dirname "$0")/.."
MANIFEST="docs/guides/guide-surfaces.json"
STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1

# Last commit unix-time touching any of the given paths (0 if never / untracked).
last_commit() {
  local t
  t="$(git log -1 --format=%ct -- "$@" 2>/dev/null || true)"
  echo "${t:-0}"
}

stale=0
for slug in $(jq -r 'keys[] | select(startswith("_") | not)' "$MANIFEST"); do
  tag="${slug%%-*}" # t1 / s1 / r1 — the screenshot filename prefix
  guide_time="$(last_commit "docs/guides/${slug}.qmd" docs/guides/assets/${tag}-*.png)"
  guide_date="$(git log -1 --format=%cd --date=short -- "docs/guides/${slug}.qmd" 2>/dev/null || echo "?")"

  flagged=""
  while IFS= read -r surface; do
    [ -e "$surface" ] || continue
    s_time="$(last_commit "$surface")"
    if [ "$s_time" -gt "$guide_time" ]; then
      s_date="$(git log -1 --format=%cd --date=short -- "$surface" 2>/dev/null || echo "?")"
      flagged="${flagged}\n    - ${surface} (changed ${s_date})"
    fi
  done < <(jq -r --arg k "$slug" '.[$k][]' "$MANIFEST")

  if [ -n "$flagged" ]; then
    stale=1
    printf '⚠ %s may be stale (guide last updated %s):%b\n' "$slug" "$guide_date" "$flagged"
  fi
done

# Danish versions derive from their English source — flag a .da.qmd whose English
# source changed after it (translate the update across).
for slug in $(jq -r 'keys[] | select(startswith("_") | not)' "$MANIFEST"); do
  da="docs/guides/${slug}.da.qmd"
  [ -e "$da" ] || continue
  en_time="$(last_commit "docs/guides/${slug}.qmd")"
  da_time="$(last_commit "$da")"
  if [ "$en_time" -gt "$da_time" ]; then
    stale=1
    en_date="$(git log -1 --format=%cd --date=short -- "docs/guides/${slug}.qmd" 2>/dev/null || echo "?")"
    printf '⚠ %s may be stale — its English source changed (%s) after the Danish version.\n' "$da" "$en_date"
  fi
done

# The aipla-help skill embeds condensed guide content — flag it if any English
# guide changed after it (refresh the embedded how-tos + re-seed).
HELP_SKILL="backend/skills/templates/aipla-help/SKILL.md"
if [ -e "$HELP_SKILL" ]; then
  help_time="$(last_commit "$HELP_SKILL")"
  newest_time=0; newest=""
  for q in docs/guides/*.qmd; do
    case "$q" in *.da.qmd) continue ;; esac # help chrome is English; track EN sources
    [ -e "$q" ] || continue
    qt="$(last_commit "$q")"
    if [ "$qt" -gt "$newest_time" ]; then newest_time="$qt"; newest="$q"; fi
  done
  if [ "$newest_time" -gt "$help_time" ]; then
    stale=1
    g_date="$(git log -1 --format=%cd --date=short -- "$newest" 2>/dev/null || echo "?")"
    printf '⚠ %s may be stale — %s changed (%s) after the help skill; refresh its embedded how-tos and re-seed.\n' "$HELP_SKILL" "$newest" "$g_date"
  fi
fi

if [ "$stale" -eq 0 ]; then
  echo "✓ All guides look current (no documented surface changed after its guide)."
  exit 0
fi

echo
echo "→ Review what's flagged; if a workflow actually changed, refresh:"
echo "    make guide-screens && make guides-publish     # re-capture + re-render + republish (EN + DA)"
echo "    # edit the flagged .da.qmd to match its English source"
echo "    # edit backend/skills/templates/aipla-help/SKILL.md, then: make seed ENV=dev"
echo "    make seed-guide-corpus                        # (fresh env) re-seed the corpus/tutors"
[ "$STRICT" -eq 1 ] && exit 1 || exit 0
