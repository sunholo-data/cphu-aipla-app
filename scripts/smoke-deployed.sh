#!/usr/bin/env bash
# Smoke-test deployed AIPLA Cloud Run services from your laptop.
#
# Mirrors the post-deploy smoke step in cloudbuild.yaml (the inline curls
# under id:smoke-deployed) so you can validate any env without waiting for a
# fresh Cloud Build run. Live URLs are recorded in docs/ops/deployed-urls.md.
#
# AIPLA topology (differs from the inherited Aitana template):
#   - aipla-v01-frontend  — public, MULTI-CONTAINER: Next.js UI (8080) + a
#     FastAPI/ADK backend SIDECAR (1956). There is NO standalone backend
#     Cloud Run service; the backend is reached via the UI's /api/proxy/*.
#   - aipla-v01-sandbox    — public, separate origin (ADR-013): the MCP App
#     artefact host (/sandbox.html + /artefacts/<name>/v<ver>/index.html).
#   Region europe-north1; project aipla-{dev,test,prod}-2026.
#
# Usage:
#   ./scripts/smoke-deployed.sh                 # dev (default), all targets
#   ./scripts/smoke-deployed.sh test
#   ./scripts/smoke-deployed.sh prod
#   ./scripts/smoke-deployed.sh dev app         # the frontend service (UI + backend sidecar)
#   ./scripts/smoke-deployed.sh dev frontend    # alias for app
#   ./scripts/smoke-deployed.sh dev backend     # alias for app (backend is a sidecar, probed via /api/proxy)
#   ./scripts/smoke-deployed.sh dev sandbox     # the MCP App artefact host
#   ./scripts/smoke-deployed.sh dev sidecars    # alias for sandbox
#   ./scripts/smoke-deployed.sh dev channels    # channel webhook reachability (none enabled in AIPLA today)
#
# Requires: gcloud auth (`gcloud auth login`) to resolve service URLs. All
# probed endpoints are public (the auth gates are asserted anonymously), so
# no token is needed. End-to-end Firebase-authenticated whoami is a separate
# procedure — see docs/ops/auth-smoke-testing.md.

set -euo pipefail

ENV="${1:-dev}"
TARGET="${2:-all}"
REGION="europe-north1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BODY="/tmp/aipla-smoke-body"

case "$ENV" in
  dev)  PROJECT="aipla-dev-2026" ;;
  test) PROJECT="aipla-test-2026" ;;
  prod) PROJECT="aipla-prod-2026" ;;
  *) echo "Unknown env: $ENV (use dev|test|prod)"; exit 2 ;;
esac

FRONTEND_SVC="aipla-v01-frontend"
SANDBOX_SVC="aipla-v01-sandbox"

echo "== Env: $ENV  Project: $PROJECT  Region: $REGION =="

resolve_url() {
  gcloud run services describe "$1" \
    --project="$PROJECT" --region="$REGION" \
    --format='value(status.url)' 2>/dev/null || true
}

# probe <method> <url> <accept-regex> <description> [extra curl args...]
#   accept-regex is an ERE alternation of acceptable HTTP codes, e.g. "401|403".
probe() {
  local method="$1" url="$2" accept="$3" desc="$4"; shift 4
  local code body
  code=$(curl -sS -o "$BODY" -w '%{http_code}' --max-time 20 -X "$method" "$@" "$url" 2>/dev/null) || code=000
  body=$(head -c 160 "$BODY" 2>/dev/null || true)
  if printf '%s' "$code" | grep -qE "^(${accept})$"; then
    echo "OK   ${desc} -> ${code}"
    return 0
  fi
  echo "FAIL ${desc} -> ${code} (expected ${accept}) body=${body}"
  return 1
}

# The frontend service: Next.js UI + FastAPI backend sidecar (via /api/proxy).
# This is the whole app — AIPLA has no standalone backend service, so the
# "frontend" and "backend" targets both land here.
smoke_app() {
  echo ""
  echo "-- ${FRONTEND_SVC} (public; Next.js UI + FastAPI backend sidecar via /api/proxy) --"
  local url; url=$(resolve_url "$FRONTEND_SVC")
  if [[ -z "$url" ]]; then
    echo "FAIL could not resolve URL for ${FRONTEND_SVC} (not deployed in ${ENV}?)"
    return 1
  fi
  echo "URL: $url"
  local fail=0
  # Public endpoints — expect 200 (mirrors cloudbuild.yaml id:smoke-deployed)
  probe GET "${url}/"                                    200 "/"                                    || fail=1
  probe GET "${url}/api/health"                          200 "/api/health"                          || fail=1
  probe GET "${url}/api/proxy/health"                    200 "/api/proxy/health (backend sidecar)"  || fail=1
  probe GET "${url}/api/proxy/api/skills/marketplace"    200 "/api/proxy/api/skills/marketplace"    || fail=1
  # A2A discovery card — public via the proxy; assert skills[] present.
  if probe GET "${url}/api/proxy/.well-known/agent.json" 200 "/api/proxy/.well-known/agent.json"; then
    if grep -q '"skills"' "$BODY"; then
      echo "OK   agent.json carries skills[]"
    else
      echo "FAIL agent.json missing skills[]"; fail=1
    fi
  else
    fail=1
  fi
  # Auth-gated endpoints — expect 401 without a token. NOT a Next 404 (that
  # would mean the catch-all proxy is missing — the FE-BRINGUP-1 guard).
  probe GET "${url}/api/proxy/api/skills"      401     "/api/proxy/api/skills (anon)"      || fail=1
  probe GET "${url}/api/proxy/api/auth/whoami" 401     "/api/proxy/api/auth/whoami (anon)" || fail=1
  probe GET "${url}/api/proxy/api/buckets"     "401|403" "/api/proxy/api/buckets (anon)"   || fail=1
  probe GET "${url}/api/proxy/api/media/pdf-info?url=https://storage.googleapis.com/test/test.pdf" \
        "401|403" "/api/proxy/api/media/pdf-info (anon)" || fail=1
  return $fail
}

# The MCP App artefact host (separate origin per ADR-013).
smoke_sandbox() {
  echo ""
  echo "-- ${SANDBOX_SVC} (public; MCP App artefact host, separate origin) --"
  local url; url=$(resolve_url "$SANDBOX_SVC")
  if [[ -z "$url" ]]; then
    echo "FAIL could not resolve URL for ${SANDBOX_SVC} (not deployed in ${ENV}?)"
    return 1
  fi
  echo "URL: $url"
  local fail=0
  probe GET "${url}/sandbox.html"                       200 "/sandbox.html (iframe host)"        || fail=1
  # Boldkast — the go-to demo artefact (see .claude/skills/mcp-app-artefact).
  probe GET "${url}/artefacts/boldkast/v1/index.html"   200 "/artefacts/boldkast/v1/index.html"  || fail=1
  return $fail
}

# Channel webhook reachability (via /api/proxy). AIPLA is web-chat; no
# channels are enabled today, so this normally just notes "none registered".
# If channels get wired, an anonymous POST should 401/403 (verify gate present).
smoke_channels() {
  echo ""
  echo "-- channel webhook reachability (via /api/proxy) --"
  local url; url=$(resolve_url "$FRONTEND_SVC")
  if [[ -z "$url" ]]; then
    echo "FAIL could not resolve URL for ${FRONTEND_SVC} (not deployed in ${ENV}?)"
    return 1
  fi
  if ! curl -sS --max-time 20 "${url}/api/proxy/openapi.json" -o /tmp/aipla-smoke-openapi.json; then
    echo "FAIL could not fetch /api/proxy/openapi.json"
    return 1
  fi
  local channels
  channels=$(python3 -c '
import json
spec = json.load(open("/tmp/aipla-smoke-openapi.json"))
out = []
for path, ops in (spec.get("paths") or {}).items():
    for op in ops.values():
        if "channels" in (op.get("tags") or []) and path.endswith("/webhook"):
            out.append(path)
print("\n".join(sorted(set(out))))
' 2>/dev/null || true)
  if [[ -z "$channels" ]]; then
    echo "NOTE no registered channels in OpenAPI (AIPLA is web-chat; none enabled in '${ENV}')"
    return 0
  fi
  local fail=0
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    probe POST "${url}/api/proxy${path}" "401|403" "POST ${path} (anon)" \
      -H 'Content-Type: application/json' -d '{}' || fail=1
  done <<< "$channels"
  return $fail
}

overall=0
case "$TARGET" in
  all)                       smoke_app || overall=1; smoke_sandbox || overall=1; smoke_channels || overall=1 ;;
  app|frontend|backend)      smoke_app || overall=1 ;;
  sandbox|sidecars)          smoke_sandbox || overall=1 ;;
  channels)                  smoke_channels || overall=1 ;;
  *) echo "Unknown target: $TARGET (use all|app|frontend|backend|sandbox|sidecars|channels)"; exit 2 ;;
esac

echo ""
if [[ $overall -eq 0 ]]; then
  echo "== All smoke checks passed =="
else
  echo "== Smoke checks FAILED =="
  exit 1
fi
