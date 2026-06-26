#!/usr/bin/env bash
# Smoke-test the deployed public MCP endpoint (the FastMCP server reached via
# the frontend's /api/mcp route — see frontend/src/app/api/mcp/route.ts and
# docs/design/aipla/v1.1.0-feedback/external-host-mcp-apps.md, row 1.1.49).
#
# Drives a REAL Streamable-HTTP MCP client (the same transport Claude Desktop /
# ChatGPT use) against <frontend-url>/api/mcp and asserts:
#   - initialize succeeds anonymously (no auth)
#   - tools/list returns the public skill tools
#   - (after M2) the sims are offered as ui:// MCP App resources
#
# Usage:
#   ./scripts/smoke-deployed-mcp.sh                 # dev (default), resolve URL via gcloud
#   ./scripts/smoke-deployed-mcp.sh test
#   ./scripts/smoke-deployed-mcp.sh dev https://host # explicit base URL (skip gcloud)
#   REQUIRE_SIMS=1 ./scripts/smoke-deployed-mcp.sh dev   # also fail unless sims are offered
#
# Requires: gcloud auth (to resolve the service URL) unless a base URL is given,
# and `uv` (runs the probe with mcp pulled in via --with, no project venv needed).

set -euo pipefail

ENV="${1:-dev}"
BASE_URL_OVERRIDE="${2:-}"
REGION="europe-north1"
FRONTEND_SVC="aipla-v01-frontend"

case "$ENV" in
  dev)  PROJECT="aipla-dev-2026" ;;
  test) PROJECT="aipla-test-2026" ;;
  prod) PROJECT="aipla-prod-2026" ;;
  *) echo "Unknown env: $ENV (use dev|test|prod)"; exit 2 ;;
esac

if [[ -n "$BASE_URL_OVERRIDE" ]]; then
  BASE_URL="$BASE_URL_OVERRIDE"
else
  echo "== Env: $ENV  Project: $PROJECT  Region: $REGION =="
  BASE_URL=$(gcloud run services describe "$FRONTEND_SVC" \
    --project="$PROJECT" --region="$REGION" \
    --format='value(status.url)' 2>/dev/null || true)
  if [[ -z "$BASE_URL" ]]; then
    echo "FAIL could not resolve URL for ${FRONTEND_SVC} (not deployed in ${ENV}?)"
    exit 1
  fi
fi

MCP_URL="${BASE_URL%/}/api/mcp"
echo "MCP endpoint: $MCP_URL"

REQUIRE_SIMS="${REQUIRE_SIMS:-0}" uv run --with 'mcp>=1.7.1' --no-project python - "$MCP_URL" <<'PY'
import os
import sys

import anyio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = sys.argv[1]
REQUIRE_SIMS = os.environ.get("REQUIRE_SIMS", "0") == "1"


async def main() -> int:
    try:
        async with streamablehttp_client(URL) as (read, write, _sid):
            async with ClientSession(read, write) as session:
                init = await session.initialize()
                print(f"OK   initialize -> {init.serverInfo.name} | protocol {init.protocolVersion}")

                tools = await session.list_tools()
                names = [t.name for t in tools.tools]
                print(f"OK   tools/list ({len(names)}): {names}")

                sim_tools = [t.name for t in tools.tools if (t.meta or {}).get("ui")]
                ui_resources = []
                try:
                    res = await session.list_resources()
                    ui_resources = [str(r.uri) for r in res.resources if str(r.uri).startswith("ui://")]
                except Exception as e:  # resources may be omitted by the server
                    print(f"     resources/list: {type(e).__name__}: {str(e)[:80]}")

                if sim_tools or ui_resources:
                    print(f"OK   sims offered as MCP Apps: tools={sim_tools} resources={ui_resources}")
                else:
                    print("     no sim (ui://) tools yet — transport works; sims land in M2")
                    if REQUIRE_SIMS:
                        print("FAIL REQUIRE_SIMS=1 but no ui:// sim tools offered")
                        return 1
        print("\nPASS — public MCP endpoint reachable + speaks Streamable HTTP.")
        return 0
    except Exception as e:
        print(f"FAIL connect/initialize: {type(e).__name__}: {str(e)[:200]}")
        return 1


sys.exit(anyio.run(main))
PY
