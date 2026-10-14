#!/usr/bin/env bash
# smoke-sim-verify.sh <env> — the authenticated end-to-end check of the private
# sim-verify service: POST a live artefact with YOUR identity token and expect a
# full verdict (self-test, viewports, motion, events, screenshots), and check an
# unauthenticated call is refused. Your account needs run.invoker on the service
# (project owners have it).
set -euo pipefail
ENV="${1:?usage: $0 dev|test|prod}"
PROJECT="aipla-${ENV}-2026"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
URL=$(gcloud run services describe aipla-v01-sim-verify --region=europe-north1 --project="$PROJECT" --format='value(status.url)')
[ -n "$URL" ] || { echo "sim-verify is not deployed on $ENV" >&2; exit 1; }
U=$(curl -s -o /dev/null -w '%{http_code}' "$URL/ready")
[ "$U" = "403" ] || [ "$U" = "401" ] || { echo "FAIL: unauthenticated /ready answered $U" >&2; exit 1; }
echo "OK    unauthenticated call refused ($U)"
TOKEN=$(gcloud auth print-identity-token)
# Any page can be checked: FILE=<index.html> ID=<artefact id> (e.g. a Sim workshop
# draft that loads the vendored libraries); the default is a built-in sim.
SIM_FILE="${FILE:-$REPO/infrastructure/mcp-sandbox/artefacts/wave-speed/v1/index.html}"
SIM_ID="${ID:-wave-speed}"
BODY=$(python3 -c 'import json,sys; print(json.dumps({"index_html": open(sys.argv[1]).read(), "artefact_id": sys.argv[2]}))' \
  "$SIM_FILE" "$SIM_ID")
OUT=$(curl -s --max-time 170 -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' --data-binary "$BODY" "$URL/verify")
python3 - "$OUT" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
if not d.get("ok"):
    sys.exit(f"FAIL: {d.get('error')}")
r = d["result"]
bad = [c["msg"] for c in r.get("checks", []) if not c["ok"]]
print(f"OK    verdict: self-test {r.get('selfTest')}, {len(r.get('events', []))} events, motion {r.get('motion')}, screenshots {sorted(d.get('screenshots', {}))}")
if bad or r.get("selfTest") != "pass":
    sys.exit("FAIL: " + "; ".join(bad))
print("sim-verify smoke passed.")
PY
