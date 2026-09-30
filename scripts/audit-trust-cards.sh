#!/usr/bin/env bash
# Audit workspace elements for the dropped-trust-card bug: a component that
# pushes state to the tutor (useSimSnapshotPush) but never dispatches a visible
# card (useHumanToolEvents). A red row is a candidate drop — UNLESS the element
# legitimately needs no card (sends a real chat turn, or is read-only). Those
# allowed exceptions are listed below; anything else red is a likely bug.
#
# Usage: make audit-trust-cards   (= scripts/audit-trust-cards.sh)
# Wired into CI as a blocking gate (ci.yml → local-mode-safety job, P1.4).
#
# SIBLING GATE — a workspace element is registered on THREE surfaces, and this
# script only checks two of them (push + card, both frontend). The third is the
# backend allowlist `_WORKSPACE_ELEMENT_SERVERS`, which decides whether the push
# is accepted at all; `writing` was missing from it from the day it shipped, so
# it passed this audit green (it pushes AND cards) while every push 403'd and
# the tutor saw nothing. That half lives in
# `backend/tests/unit/test_element_server_parity.py`, deliberately as a pytest
# so it can import the real frozenset instead of regex-parsing Python. If you
# are adding an element, you need all three.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
DIR="$ROOT/frontend/src/components/workspace"

# Elements that share with the tutor WITHOUT an iframe-context card, by design:
#   SolutionElementMount — submit sends a real multimodal chat turn (the turn is
#                          the confirmation; see decision-rule shape C).
ALLOW_NO_CARD="SolutionElementMount"

# 1.1.136 M0 — the SECOND check: every push says what it was.
#
# A workbench event reaches BigQuery for the review timeline, and a researcher
# reads it beside the transcript. An unlabelled push lands there as a bare
# `server · field · value` row — which is how the teacher group report showed
# work for months. So each call of the function `useSimSnapshotPush` returns
# must carry EITHER a card label (3rd argument, not null/undefined) OR a
# `logLabel` in its 4th (meta) argument. Pure perl, no node: this runs in the
# CI shell job. Prints one "file:line  call" per unlabelled call.
unlabelled_pushes() {
  perl -0777 -ne '
    my $src = $_;
    my %vars;
    $vars{$1} = 1 while $src =~ /const\s+(\w+)\s*=\s*useSimSnapshotPush\b/g;
    for my $v (keys %vars) {
      while ($src =~ /\b\Q$v\E\s*(\((?:[^()]++|(?1))*\))/g) {
        my ($args, $end) = ($1, pos($src));
        my $line = 1 + (() = substr($src, 0, $end - length($args)) =~ /\n/g);
        my $inner = substr($args, 1, -1);
        # Split on TOP-LEVEL commas only.
        my (@parts, $depth, $cur);
        $depth = 0; $cur = "";
        for my $ch (split //, $inner) {
          $depth++ if $ch =~ /[\(\[\{]/;
          $depth-- if $ch =~ /[\)\]\}]/;
          if ($ch eq "," && $depth == 0) { push @parts, $cur; $cur = ""; next; }
          $cur .= $ch;
        }
        push @parts, $cur if $cur =~ /\S/;
        s/^\s+|\s+$//g for @parts;
        my $card = @parts >= 3 && $parts[2] !~ /^(null|undefined)$/;
        my $log = @parts >= 4 && $parts[3] =~ /\blogLabel\b/;
        next if $card || $log;
        (my $short = "$v$args") =~ s/\s+/ /g;
        print "$ARGV:$line  " . substr($short, 0, 90) . "\n";
      }
    }
  ' "$1"
}

red=0
unlabelled=0
printf '%-28s %-7s %-7s %-7s %s\n' "COMPONENT" "PUSH" "CARD" "LABEL" "VERDICT"
printf '%-28s %-7s %-7s %-7s %s\n' "----------------------------" "-------" "-------" "-------" "-------"

missing_labels=""
for f in "$DIR"/*.tsx; do
  base="$(basename "$f" .tsx)"
  pushes=no; cards=no; labels=yes
  grep -aq "useSimSnapshotPush" "$f" && pushes=yes
  grep -aq "useHumanToolEvents" "$f" && cards=yes

  [ "$pushes" = no ] && continue  # only pushers are in scope

  bad="$(unlabelled_pushes "$f")"
  if [ -n "$bad" ]; then
    labels=no
    missing_labels="$missing_labels$bad"$'\n'
  fi

  if [ "$cards" = no ] && ! printf '%s\n' "$ALLOW_NO_CARD" | grep -qx "$base"; then
    verdict="!! PUSH WITHOUT CARD — wire useHumanToolEvents (see SKILL.md)"
    red=$((red + 1))
  elif [ "$labels" = no ]; then
    verdict="!! PUSH WITHOUT LABEL — pass the card label or { logLabel } (1.1.136)"
    unlabelled=$((unlabelled + 1))
  elif [ "$cards" = yes ]; then
    verdict="ok"
  else
    verdict="ok (no-card by design)"
  fi
  printf '%-28s %-7s %-7s %-7s %s\n' "$base" "$pushes" "$cards" "$labels" "$verdict"
done

echo
if [ "$red" -gt 0 ]; then
  echo "$red component(s) push but don't card. If any is a genuine no-card shape"
  echo "(sends a real turn / read-only), add it to ALLOW_NO_CARD in this script."
fi
if [ "$unlabelled" -gt 0 ]; then
  echo "$unlabelled component(s) push without saying what the push was. Each call"
  echo "below needs the card label (3rd argument) or { logLabel } (4th) — use the"
  echo "SAME text the element's trust card shows, so the review timeline and the"
  echo "student read one record (docs/design/aipla/v1.1.0-feedback/review-work-beside-the-transcript.md M0):"
  printf '%s' "$missing_labels" | sed "s|$ROOT/||; s/^/  /"
fi
if [ "$red" -gt 0 ] || [ "$unlabelled" -gt 0 ]; then
  exit 1
fi
echo "All pushing components dispatch a trust card (or are allow-listed) and label every push. ✓"
