#!/usr/bin/env bash
#
# reconcile-dependabot-alerts.sh — Layer 3 of the security monitoring pipeline.
# See docs/design/aipla/v1.1.0-feedback/security-monitoring-pipeline.md.
#
# Auto-close Dependabot alerts that are already fixed in the committed lockfiles.
#
# Why this exists: GitHub's native auto-dismiss of fixed Dependabot alerts is
# unreliable for this repo. On 2026-06-15 all 27 open alerts had stayed `open`
# (updated_at == created_at) for 3-10 days AFTER their fixes landed on `dev`.
# This script closes that gap deterministically and conservatively:
#
#   1. Run a FULL `npm audit` (all severities, INCLUDING dev) of each npm
#      lockfile. npm owns the semver/range/multi-instance math.
#   2. Collect every GHSA the audit still flags ("live" set).
#   3. Any OPEN Dependabot alert (npm ecosystem) whose GHSA is NOT in the live
#      set is fully fixed in the lockfile -> dismiss it as `fix_started`.
#
# Conservative by design: a GHSA is only treated as fixed when it is COMPLETELY
# absent from a full audit. If any vulnerable copy survives anywhere in the tree
# (e.g. a nested transitive pin), the GHSA stays live and the alert is kept open.
#
# Scope: npm ecosystems only (frontend + infrastructure/mcp-sandbox) — where
# effectively all alerts live. Non-npm alerts (e.g. pip) are left open and
# reported for manual review via the /aipla-security-checkup runbook.
#
# Usage:
#   scripts/reconcile-dependabot-alerts.sh           # dry run (default, no writes)
#   scripts/reconcile-dependabot-alerts.sh --apply   # actually dismiss fixed alerts
#
# Token: dismissing needs Dependabot-alerts WRITE. Local `gh` auth has it. In CI
# the default GITHUB_TOKEN may NOT — export GH_TOKEN from a DEPENDABOT_TOKEN
# secret (fine-grained PAT with "Dependabot alerts: write"). The script degrades
# gracefully (reports DENIED, exits 0) when the token lacks permission.

set -euo pipefail

REPO="${GITHUB_REPOSITORY:-sunholo-data/cphu-aipla-app}"
NPM_DIRS=(frontend infrastructure/mcp-sandbox)

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== Collecting still-live GHSAs from npm lockfiles =="
LIVE="$(mktemp)"
trap 'rm -f "$LIVE"' EXIT
for dir in "${NPM_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  (
    cd "$dir"
    # npm audit reads package-lock.json directly; only install if node_modules
    # is missing (CI checkout) and even then audit can usually run lock-only.
    [ -d node_modules ] || npm ci --silent --no-audit --no-fund >/dev/null 2>&1 || true
    npm audit --json 2>/dev/null \
      | jq -r '.vulnerabilities // {} | .[] | (.via[]? | select(type=="object") | .url)' \
      | sed -E 's#.*/(GHSA-[A-Za-z0-9-]+)$#\1#'
  ) >> "$LIVE" || true
done
sort -u "$LIVE" -o "$LIVE"
if [ -s "$LIVE" ]; then
  echo "Still flagged (kept open):"; sed 's/^/  /' "$LIVE"
else
  echo "  (none — no GHSAs flagged by a full npm audit)"
fi

echo ""
echo "== Reconciling open Dependabot alerts (mode: $([ "$APPLY" = 1 ] && echo APPLY || echo dry-run)) =="
dismissed=0 kept=0 nonnpm=0 denied=0
while IFS=$'\t' read -r num ghsa pkg eco; do
  [ -z "${num:-}" ] && continue
  if [ "$eco" != "npm" ]; then
    echo "  SKIP   #$num $pkg [$eco] $ghsa — non-npm, leave for manual review"
    nonnpm=$((nonnpm + 1)); continue
  fi
  if grep -qxF "$ghsa" "$LIVE"; then
    echo "  KEEP   #$num $pkg $ghsa — still flagged by audit"
    kept=$((kept + 1)); continue
  fi
  echo "  FIXED  #$num $pkg $ghsa — not flagged by audit"
  if [ "$APPLY" = 1 ]; then
    if gh api --method PATCH "repos/$REPO/dependabot/alerts/$num" \
        -f state=dismissed \
        -f dismissed_reason=fix_started \
        -f dismissed_comment="Auto-reconciled by reconcile-dependabot-alerts.sh: $ghsa ($pkg) is no longer flagged by a full npm audit of the committed lockfile on the default branch." \
        --silent >/dev/null 2>&1; then
      echo "         -> dismissed"
      dismissed=$((dismissed + 1))
    else
      echo "         -> DENIED (token lacks Dependabot-alerts write)"
      denied=$((denied + 1))
    fi
  fi
done < <(gh api "repos/$REPO/dependabot/alerts" --paginate \
          -q '.[] | select(.state=="open") | [(.number|tostring), .security_advisory.ghsa_id, .dependency.package.name, .dependency.package.ecosystem] | @tsv')

echo ""
echo "== Summary =="
echo "  $([ "$APPLY" = 1 ] && echo dismissed || echo would-dismiss): $dismissed"
echo "  kept (still vulnerable): $kept"
echo "  non-npm (manual review): $nonnpm"
if [ "$denied" -gt 0 ]; then
  echo "  DENIED: $denied — set a DEPENDABOT_TOKEN secret (fine-grained PAT, 'Dependabot alerts: write')"
fi
exit 0
