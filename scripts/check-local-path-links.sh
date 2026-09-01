#!/usr/bin/env bash
#
# P4.2 guard — no documentation link may resolve on one person's laptop only.
#
# 138 citations in docs/ pointed at file:///Users/mark/... — the scoping site,
# M's Claude agent-memory directory, and two other local source trees. Every one
# of them was a dead link for anyone else, which for a project whose handover
# runs through its documentation is a handover blocker rather than a nit.
#
# See CLAUDE.md "How to cite the scoping site from a doc in this repo" for what
# to write instead.
set -euo pipefail

cd "$(dirname "$0")/.."

# file:// URLs into a user's home. Deliberately narrow: an http(s) link to the
# published site is the FIX, so it must not trip this.
PATTERN='file:///Users/'

# The snapshot README explains the migration and quotes the old form.
hits=$(grep -rn --include='*.md' "$PATTERN" docs/ 2>/dev/null \
  | grep -v '^docs/design/aipla/_scoping-snapshot/README.md:' \
  || true)

if [[ -n "$hits" ]]; then
  echo "FAIL: documentation links that resolve on one machine only:"
  echo
  echo "$hits"
  echo
  echo "These are dead for everyone but their author. Instead:"
  echo "  * a rendered scoping page -> https://www.sunholo.com/aipla/<page>.html"
  echo "  * a prototype brief       -> docs/design/aipla/_scoping-snapshot/prototypes/"
  echo "  * anything private        -> no link; name the file as plain text"
  echo
  echo "See CLAUDE.md, 'How to cite the scoping site from a doc in this repo'."
  exit 1
fi

echo "OK: no laptop-bound documentation links in docs/."
