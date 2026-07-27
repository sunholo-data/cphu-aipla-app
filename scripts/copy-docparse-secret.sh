#!/usr/bin/env bash
# Copy the DOCPARSE_API_KEY value from one env's secret to another. The key is an
# external AILANG-Parse product key shared across AIPLA envs; Terraform creates
# the per-env secret SHELL (with a REPLACE_ME placeholder), and this fills the
# real value from an env that already has it (usually dev). Guards against
# copying a placeholder/empty value forward.
#
# Usage:  scripts/copy-docparse-secret.sh <from-env> <to-env>
#         make copy-docparse-secret FROM=dev TO=test
set -euo pipefail

FROM="${1:?usage: copy-docparse-secret.sh <from-env> <to-env>}"
TO="${2:?usage: copy-docparse-secret.sh <from-env> <to-env>}"
for e in "$FROM" "$TO"; do
  case "$e" in dev | test | prod) ;; *) echo "bad env '$e' (dev|test|prod)" >&2; exit 2 ;; esac
done

VAL="$(gcloud secrets versions access latest --secret=DOCPARSE_API_KEY --project="aipla-${FROM}-2026" 2>/dev/null || true)"
if [ -z "$VAL" ] || [[ "$VAL" == REPLACE_ME* ]]; then
  echo "ERROR: source (${FROM}) DOCPARSE_API_KEY is empty or a placeholder — populate it first." >&2
  exit 1
fi

printf '%s' "$VAL" | gcloud secrets versions add DOCPARSE_API_KEY --data-file=- --project="aipla-${TO}-2026" >/dev/null
echo "[copy-docparse-secret] ✓ DOCPARSE_API_KEY copied ${FROM} -> ${TO} (len ${#VAL})"
