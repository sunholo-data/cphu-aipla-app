#!/usr/bin/env bash
#
# check-upstream-routing.sh — did this change land in the right repo?
#
#   platform change -> belongs UPSTREAM, so every future fork inherits it
#   AIPLA change    -> belongs here
#
# This is a WARNING, never a blocker. Prototyping a platform change here is
# legitimate and often necessary — you cannot exercise a real deployment, real
# teacher data or the KU project from a bare template checkout, and that is
# usually where a platform bug is actually found. The mistake is not typing it
# here, it is LEAVING it here: every guard this repo wrote because the bug
# shipped once is a guard the next fork does not get.
#
# WHY THIS DIFFERS FROM THE UPSTREAM SCRIPT OF THE SAME NAME
#
# platform-source derives "is this template content" by running its sanitizer
# and asking whether the file survives into the published tree. That works
# there because its downstream is a sibling deployment of the same lineage.
# It does NOT work here: AIPLA is a hard fork with four months of KU-specific
# divergence, and the inherited sanitizer describes this repo as the PUBLISHER
# of the public template, which it is not (see scripts/refresh-public-template.sh).
#
# So the derivation here is a fork-shaped one, and it needs three facts, not one:
#
#   1. Does the path exist upstream?      (shared surface vs. new here)
#   2. Did WE change it since the fork?   (ours to port vs. upstream's own work)
#   3. Does the change carry AIPLA?       (KU branding, Danish copy, physics
#                                          skills, aipla-* project IDs)
#
# Fact 2 needs a base commit, and git has none to offer: this repo's root
# (FORK_BASE) is a squashed "Initial commit" of the public template and shares
# no ancestor with upstream. `git merge-base` returns nothing for these two
# histories. FORK_BASE stands in for the merge base, which is exactly what it
# is in substance even though git cannot see it.
#
# Usage:
#   scripts/check-upstream-routing.sh                # unpushed commits on this branch
#   scripts/check-upstream-routing.sh <git-range>    # e.g. upstream-pin..HEAD
#   scripts/check-upstream-routing.sh --all          # every shared path: the full reconcile
#
# Env:
#   PATHS_ONLY=1    emit only bucket A paths, one per line, nothing else
#                   (the machine seam scripts/port-up.sh consumes)
#   INCLUDE_NEW=1   add bucket C (new files absent upstream) to PATHS_ONLY output
#   AIPLA_MARKERS   override the customer-content regex

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

REMOTE="${UPSTREAM_REMOTE:-upstream}"
UBRANCH="${UPSTREAM_BRANCH:-main}"
UREF="$REMOTE/$UBRANCH"

# Fork metadata lives in .template-fork-target so the pin and the base are
# recorded in one reviewable place rather than baked into a script.
FORK_BASE="$(sed -n 's/^FORK_BASE=//p' .template-fork-target 2>/dev/null | head -1)"
FORK_BASE="${FORK_BASE:-160c9fe}"

if ! git rev-parse --verify --quiet "$UREF" >/dev/null 2>&1; then
  echo "No '$UREF'. Add the remote and fetch:" >&2
  echo "  git remote add $REMOTE https://github.com/sunholo-data/platform-source.git" >&2
  echo "  git fetch $REMOTE $UBRANCH" >&2
  exit 2
fi

# Anything that names the customer. A path whose CHANGE mentions any of these is
# AIPLA content by construction — porting it would push KU branding, Danish copy
# or physics skills into a template that other engagements fork from.
# Deliberately over-broad: a false "customer-owned" costs one manual override, a
# false "template" costs a KU string in somebody else's repo.
MARKERS="${AIPLA_MARKERS:-aipla|AIPLA|ku\.dk|Copenhagen|København|KU red|901A1E|Boldkast|LED.Planck|KineBot|jitt-dk|[Ff]ysik|[Dd]anish|da-DK|[Pp]hysics|europe-north1|Prøvebanken|cphu}"

# Trees that are never template content whatever they contain: workflow
# ephemera, this engagement's own design record, its research, its public copy.
# A hand-maintained list is defensible HERE and not for the marker screen above,
# because it names categories of ephemera rather than trying to describe the
# template. When it rots the cost is a noisier report, never a wrong port.
NEVER_PORT='^(\.claude/state/|\.template-fork-target|docs/design/aipla/|docs/guides/|docs/ops/incidents/|docs/customers/|research/|outputs/|frontend/content/project/|infrastructure/env/)'

RANGE="${1:-}"
ALL=0
if [ "$RANGE" = "--all" ]; then
  ALL=1
  RANGE=""
elif [ -z "$RANGE" ]; then
  BR="$(git branch --show-current)"
  if git rev-parse --verify --quiet "origin/$BR" >/dev/null 2>&1; then
    RANGE="origin/$BR..HEAD"
  else
    RANGE="HEAD~1..HEAD"
  fi
fi

if [ "$ALL" = 1 ]; then
  # Every path the two trees share — the reconcile view.
  CHANGED="$(comm -12 \
    <(git ls-tree -r --name-only "$UREF" | sort) \
    <(git ls-tree -r --name-only HEAD | sort))"
  # ...plus everything that exists only here, so bucket C is populated.
  CHANGED="$CHANGED
$(comm -13 \
    <(git ls-tree -r --name-only "$UREF" | sort) \
    <(git ls-tree -r --name-only HEAD | sort))"
else
  CHANGED="$(git diff --name-only "$RANGE" 2>/dev/null || true)"
fi

CHANGED="$(printf '%s\n' "$CHANGED" | sed '/^$/d' | sort -u)"

if [ -z "$CHANGED" ]; then
  # PATHS_ONLY is a machine seam: emit NOTHING, or the human message becomes a
  # "path" and the caller tries to port a file named "No changes in …".
  [ "${PATHS_ONLY:-0}" = 1 ] || echo "No changes in $RANGE."
  exit 0
fi

A=""   # template candidate: shared path, we changed it, no AIPLA markers
B=""   # customer-owned: the change names AIPLA
C=""   # new here: absent upstream entirely
D=""   # upstream's own: shared, but untouched here since the fork

while IFS= read -r f; do
  [ -n "$f" ] || continue

  if printf '%s' "$f" | grep -qE "$NEVER_PORT"; then
    B="${B}${f}"$'\n'
    continue
  fi

  if ! git cat-file -e "$UREF:$f" 2>/dev/null; then
    # Absent upstream. Only a file that still exists here can be a candidate.
    if [ -e "$f" ] && ! grep -qEI "$MARKERS" "$f" 2>/dev/null; then
      C="${C}${f}"$'\n'
    else
      B="${B}${f}"$'\n'
    fi
    continue
  fi

  # Shared path. Did we touch it since the fork?
  if git cat-file -e "$FORK_BASE:$f" 2>/dev/null \
     && git diff --quiet "$FORK_BASE:$f" "HEAD:$f" 2>/dev/null; then
    D="${D}${f}"$'\n'
    continue
  fi

  if git diff -U0 "$UREF:$f" "HEAD:$f" 2>/dev/null | grep -qE "^[+-].*($MARKERS)"; then
    B="${B}${f}"$'\n'
  else
    A="${A}${f}"$'\n'
  fi
done <<< "$CHANGED"

strip() { printf '%s' "${1:-}" | sed '/^$/d'; }
A="$(strip "$A")"; B="$(strip "$B")"; C="$(strip "$C")"; D="$(strip "$D")"

if [ "${PATHS_ONLY:-0}" = 1 ]; then
  OUT="$A"
  if [ "${INCLUDE_NEW:-0}" = 1 ] && [ -n "$C" ]; then
    OUT="$(strip "$A"$'\n'"$C")"
  fi
  printf '%s' "$OUT"
  [ -n "$OUT" ] && echo
  exit 0
fi

count() { [ -z "${1:-}" ] && echo 0 || echo "$1" | wc -l | tr -d ' '; }
show() { echo "$1" | head -"${2:-15}" | sed 's/^/    /'
         n="$(count "$1")"; [ "$n" -gt "${2:-15}" ] && echo "    … and $((n - ${2:-15})) more"; }

echo
echo "Upstream routing — $( [ "$ALL" = 1 ] && echo "full reconcile against $UREF" || echo "$RANGE" )"
echo "  upstream: $UREF @ $(git rev-parse --short "$UREF")"
echo "  fork base: $FORK_BASE"
echo

if [ -n "$A" ]; then
  echo "A. TEMPLATE CANDIDATES — $(count "$A") path(s) we changed, shared with upstream, no AIPLA markers:"
  show "$A"
  echo
fi
if [ -n "$C" ]; then
  echo "C. NEW HERE — $(count "$C") path(s) absent upstream and free of AIPLA markers."
  echo "   Often this fork's best contribution (the guard scripts were all born here),"
  echo "   but 'generic enough to be template content' is a judgement call, not a grep:"
  show "$C"
  echo
fi
if [ -n "$B" ]; then
  echo "B. AIPLA-owned — $(count "$B") path(s); the change names the customer. Stays here."
  [ "${VERBOSE:-0}" = 1 ] && show "$B"
  echo
fi
if [ -n "$D" ]; then
  echo "D. Upstream's own — $(count "$D") shared path(s) we have not touched since the fork."
  echo "   Upstream moved on; nothing to port. These are what a merge-down would bring."
  echo
fi

if [ -z "$A" ] && [ -z "$C" ]; then
  echo "Routing OK — nothing here belongs upstream."
  exit 0
fi

echo "  Porting up is cheap now and expensive later. Review bucket A, then:"
echo "      make port-up RANGE='${RANGE:---all}'      # dry run"
echo "      make port-up RANGE='${RANGE:---all}' GO=1 # push + open the PR"
echo
echo "  (Advisory only — this never blocks.)"
