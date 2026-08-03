#!/usr/bin/env bash
# check-auth-config.sh — assert an env's Firebase/Identity-Platform auth config
# can ACTUALLY sign a teacher in.
#
# WHY THIS EXISTS (2026-08-03): a teacher could not sign in with Google on test
# or prod. Two settings were present on dev and absent on both others:
#
#   * the Cloud Run URL in `authorizedDomains` — without it any OAuth
#     popup/redirect from the real app origin fails `auth/unauthorized-domain`
#   * the `google.com` sign-in provider itself — test/prod had NO idp configs
#
# Both had been added to dev BY HAND during the imperative bootstrap and were
# never encoded in Terraform, so the two Terraform-cut envs silently lacked them.
# Nothing detected the difference: every deploy was green, every smoke passed,
# because smoke only probes anonymous endpoints. The gap surfaced when a real
# person tried to log in.
#
# `authorizedDomains` is now Terraform-managed. The Google provider CANNOT be
# (enabling it in the console auto-mints a per-project OAuth client, and the TF
# resource needs that client_secret — which would then sit in plaintext in the
# state bucket). So this script is the guard: it compares what is DEPLOYED
# against what sign-in requires, which is the check that would have caught the
# original bug regardless of which layer owns the setting.
#
# Usage:
#   ./scripts/check-auth-config.sh            # all three envs
#   ./scripts/check-auth-config.sh prod
#
# Requires gcloud auth. Read-only.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVS=("${1:-dev}" )
[ $# -eq 0 ] && ENVS=(dev test prod)

fail=0

api() { # $1=project $2=path
  /usr/bin/curl -s -H "Authorization: Bearer ${TOKEN}" -H "x-goog-user-project: $1" \
    "https://identitytoolkit.googleapis.com/admin/v2/projects/$1/$2"
}

TOKEN="$(CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo gcloud auth print-access-token 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  echo "ERROR: no gcloud access token (try: CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo gcloud auth login)" >&2
  exit 2
fi

for ENV in "${ENVS[@]}"; do
  case "$ENV" in
    dev)  PROJECT="aipla-dev-2026" ;;
    test) PROJECT="aipla-test-2026" ;;
    prod) PROJECT="aipla-prod-2026" ;;
    *) echo "Unknown env: $ENV (use dev|test|prod)" >&2; exit 2 ;;
  esac

  echo "== auth config: ${ENV} (${PROJECT}) =="

  # The origin the app is actually served from — the thing that must be
  # authorized. Resolved live so it can never drift from a hardcoded list.
  URL="$(CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo gcloud run services describe aipla-v01-frontend \
        --project="$PROJECT" --region=europe-north1 --format='value(status.url)' 2>/dev/null || true)"
  HOST="${URL#https://}"

  CONFIG="$(api "$PROJECT" config)"
  IDPS="$(api "$PROJECT" defaultSupportedIdpConfigs)"

  RESULT="$(CONFIG="$CONFIG" IDPS="$IDPS" HOST="$HOST" python3 - <<'PY'
import json, os, sys

cfg = json.loads(os.environ["CONFIG"] or "{}")
idps = json.loads(os.environ["IDPS"] or "{}")
host = os.environ["HOST"]
bad = []

if "error" in cfg:
    print("FAIL config: " + cfg["error"].get("message", "")[:120]); sys.exit(1)

domains = cfg.get("authorizedDomains") or []
if not host:
    print("WARN  could not resolve the frontend URL — skipping the domain check")
elif host in domains:
    print(f"OK    authorizedDomains contains {host}")
else:
    bad.append(f"authorizedDomains is MISSING {host} -> Google sign-in fails auth/unauthorized-domain. Have: {domains}")

# INFORMATIONAL, deliberately not a failure. Firebase anonymous sign-in is
# enabled on test/prod and off on dev — but the app never calls
# signInAnonymously(): students authenticate with a CUSTOM GROUP JWT (ADR-001),
# not a Firebase identity. dev has served students for months with it off,
# which is the empirical proof it is not required. Reported so the env
# difference is visible rather than mysterious.
anon = (cfg.get("signIn") or {}).get("anonymous") or {}
print(f"INFO  firebase anonymous sign-in: {'on' if anon.get('enabled') else 'off'} "
      "(unused — students use the group JWT, ADR-001)")

enabled_idps = {
    c["name"].rsplit("/", 1)[-1]: c.get("enabled")
    for c in (idps.get("defaultSupportedIdpConfigs") or [])
}
if enabled_idps.get("google.com"):
    print("OK    google.com sign-in provider enabled")
else:
    bad.append(
        "google.com provider NOT enabled — teachers cannot sign in. This is a "
        "CONSOLE step (Firebase > Authentication > Sign-in method > Google); "
        "Terraform cannot mint the OAuth client. Found: " + (str(enabled_idps) or "none")
    )

for b in bad:
    print("FAIL  " + b)
sys.exit(1 if bad else 0)
PY
)"
  echo "$RESULT" | sed 's/^/  /'
  echo "$RESULT" | grep -q '^FAIL' && fail=1
  echo
done

if [ "$fail" -ne 0 ]; then
  echo "auth config INCOMPLETE — see FAIL lines above." >&2
  exit 1
fi
echo "All checked envs can sign a teacher in."
