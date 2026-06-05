#!/usr/bin/env bash
#
# security-check.sh — single source of truth for AIPLA's dep security gate.
#
# Runs three audits in sequence and exits non-zero on any failure:
#   1. frontend/  — npm audit --omit=dev --audit-level=high
#   2. infrastructure/mcp-sandbox/ — same
#   3. backend/   — pip-audit on uv-exported production deps (OSV database)
#
# Both the CI gate (.github/workflows/ci.yml security-audit job) and the
# local Makefile target (`make security-check`) invoke this script — that
# way they cannot drift out of sync. If you need to change the gate's
# behaviour, change it here.
#
# Policy: see docs/design/aipla/v1.1.0-feedback/security-monitoring-pipeline.md
# Triage runbook for failures: .claude/skills/aipla-security-checkup/SKILL.md
#
# Exit codes:
#   0 — all three audits pass at the high/critical threshold
#   1 — at least one audit found a high/critical CVE in production deps
#   2 — script setup error (missing tool, malformed lockfile, etc.)
#
# Ignored vulnerabilities (documented allowlist; revisit each pin):
#   PYSEC-2026-161 (starlette BadHost) — fix is starlette 1.0.1, but our
#     fastapi pin (>=0.115.8,<1.0.0) holds starlette on the 0.x line.
#     Reachability: low — backend doesn't expose request.url.path to
#     untrusted callers without Host validation already happening upstream
#     (Cloud Run + load balancer set Host). Revisit when FastAPI ships
#     1.0 (currently latest 0.99.x as of 2026-06-05).
#
set -euo pipefail

# Resolve repo root regardless of where the script is invoked from.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)"
cd "$REPO_ROOT"

# Colorise only when stdout is a tty (skip in CI logs).
if [ -t 1 ]; then
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_BOLD=$'\033[1m'
  C_RESET=$'\033[0m'
else
  C_RED=""
  C_GREEN=""
  C_BOLD=""
  C_RESET=""
fi

# Accumulate failures so we can print a single summary instead of
# bailing on the first failure.
FAILURES=()

audit_npm() {
  local dir="$1"
  local label="$2"
  echo
  echo "${C_BOLD}[$label] npm audit --omit=dev --audit-level=high${C_RESET}"
  if (cd "$dir" && npm audit --omit=dev --audit-level=high); then
    echo "${C_GREEN}PASS${C_RESET} $label"
  else
    echo "${C_RED}FAIL${C_RESET} $label"
    FAILURES+=("$label")
  fi
}

audit_python() {
  local dir="$1"
  local label="$2"
  echo
  echo "${C_BOLD}[$label] pip-audit (uv export --frozen --no-dev, OSV)${C_RESET}"
  # --no-emit-project drops the local "-e ." line which pip-audit can't hash.
  # --ignore-vuln PYSEC-2026-161: starlette BadHost, documented above.
  if (cd "$dir" && uvx pip-audit \
       --requirement <(uv export --frozen --no-dev --no-emit-project) \
       --strict \
       --ignore-vuln PYSEC-2026-161 \
       --vulnerability-service osv); then
    echo "${C_GREEN}PASS${C_RESET} $label"
  else
    echo "${C_RED}FAIL${C_RESET} $label"
    FAILURES+=("$label")
  fi
}

audit_npm "frontend"                       "frontend (npm prod, high+)"
audit_npm "infrastructure/mcp-sandbox"     "sandbox  (npm prod, high+)"
audit_python "backend"                     "backend  (pip-audit/OSV)"

echo
echo "${C_BOLD}=== Security audit summary ===${C_RESET}"
if [ ${#FAILURES[@]} -eq 0 ]; then
  echo "${C_GREEN}All three production-dep audits passed.${C_RESET}"
  echo "Note: dev-only deps + medium-severity findings are caught by the weekly cron"
  echo "(.github/workflows/security-weekly.yml), not this gate."
  exit 0
else
  echo "${C_RED}FAIL — ${#FAILURES[@]} of 3 audits found new HIGH/CRITICAL CVEs:${C_RESET}"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  echo
  echo "Triage runbook: .claude/skills/aipla-security-checkup/SKILL.md"
  echo "Policy doc:     docs/design/aipla/v1.1.0-feedback/security-monitoring-pipeline.md"
  exit 1
fi
