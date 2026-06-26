# Sprint: EXT-MCP — serve the sims as MCP Apps from the cloud URL

**Design doc:** [external-host-mcp-apps.md](external-host-mcp-apps.md) (row 1.1.49)
**Created:** 2026-06-26
**Goal:** Make `https://aipla-v01-frontend-…/api/mcp` a working public MCP endpoint that
renders Boldkast / KineBot / LED-Planck as **live interactive MCP App widgets** in
Claude Desktop and ChatGPT — no laptop, no tunnel.
**Duration:** 1 focused session (~0.5–1d). PoC already exists + verified; FastMCP
supports the UI metadata natively; high recent velocity.
**Scope:** M1 frontend (one route + a smoke script) · M2 backend (additive registration
in `mcp_server.py`) · M3 verification + docs. **Phase 3 (tool-input pre-config) is OUT.**
**Exposure decision:** dev-only, open — authorised by M's "make it so for the cloud URL"
and consistent with the existing public/no-auth `/mcp` skills posture. test/prod exposure
is a later ADR (not in this sprint).

## Why this is small

| De-risker | Evidence |
|---|---|
| View half done | all 3 artefacts speak the SEP-1865 bridge (grep `ui/initialize`) |
| Server logic proven | `infrastructure/mcp-sandbox/external-host-demo/server.py` + passing `smoke_test.py` |
| FastMCP is native | `mcp.add_tool(meta=…)` and resources with `mime_type=`/`meta=` both exist (verified) |
| Blocker understood | `/api/proxy/mcp` 502 = proxy `/mcp`(no slash) → FastMCP 307 → body can't replay; Next 308-strips the slash |
| Low blast radius | the frontend app uses `/api/proxy/mcp/{server_id}` (mcp_proxy), **not** the FastMCP `/mcp`; skills `/mcp` is a discovery surface |

## Milestones

### M1 — Public MCP transport (frontend) — ~2h
A reachable, anonymous, Streamable-HTTP endpoint to the FastMCP server.

- **Tasks**
  1. Extract a shared `forwardToBackend(req, backendPath)` from the catch-all proxy
     ([route.ts](../../../../frontend/src/app/api/proxy/[...path]/route.ts)) — keeps the SSE
     passthrough + `duplex:"half"` + header-filter logic in one place (avoids drift).
  2. Add `frontend/src/app/api/mcp/route.ts` (GET/POST/DELETE/OPTIONS) → `forwardToBackend(req, "mcp/")`
     (trailing slash → no backend 307; not slash-normalised by Next since it has no trailing slash).
  3. Add `scripts/smoke-deployed-mcp.sh` — a `streamablehttp_client` probe (Python, via `uv`)
     that `initialize` + `list_tools` against `<frontend-url>/api/mcp`. Mirror `scripts/smoke-deployed.sh` env/URL resolution.
- **Acceptance**
  - Local: backend up → `POST http://127.0.0.1:1956/mcp/` 200; the Next route locally proxies it.
  - Deployed (after M3 deploy): smoke script initialises + lists tools anonymously against `…/api/mcp`.
  - Existing skill tools still listed; no change to `/api/proxy/**`.
- **Risk:** Streamable HTTP needs the session header + SSE GET to survive the proxy. Mitigation: the
  catch-all already does SSE passthrough and does not block `Mcp-Session-Id`; the smoke test is the gate.
  Fallback: expose FastMCP on its own Cloud Run route/origin (design doc option 1c).

### M2 — Sims as `ui://` MCP Apps on the deployed server (backend) — ~2–3h
Register every bridge-speaking artefact as a UI resource + tool, additively.

- **Tasks**
  1. `register_sim_apps(mcp)` in [mcp_server.py](../../../../backend/protocols/mcp_server.py):
     port the PoC's `discover_artefacts()`; for each artefact register a `FunctionResource`
     (`uri="ui://aipla/<name>/<ver>"`, `mime_type="text/html;profile=mcp-app"`) and
     `mcp.add_tool(show_fn, name="show_<name>", meta={"ui":{"resourceUri":uri,"visibility":["model","app"]}, "openai/outputTemplate":uri})`.
  2. Call `register_sim_apps(mcp)` once from `get_mcp_asgi_app()` (after `rebuild_tools()`).
  3. **Artefact availability (the integration risk):** the backend sidecar image does not currently
     contain `infrastructure/mcp-sandbox/artefacts/`. Decide + implement ONE: (a) bake the artefacts
     into the backend image (`COPY` in `backend/Dockerfile`; check build context); (b) read them from
     the deployed sandbox URL (`MCP_SANDBOX_URL/artefacts/<name>/v<ver>/index.html`) at registration;
     (c) vendor a copy under `backend/`. **Default: (a)** if build context allows, else (b).
- **Acceptance**
  - `tests/api_tests/test_mcp_server.py` extended: `tools/list` includes `show_boldkast|kinebot|led_planck`
    with `_meta.ui.resourceUri`; `resources/read` of a `ui://` URI returns HTML with `text/html;profile=mcp-app`
    and contains `ui/initialize`. Existing skill-tool tests still pass.
  - `make test-fast` + `make lint` green.
- **Risk:** artefact availability (above) + FastMCP `FunctionResource` constructor specifics. Both
  resolved by the unit test running against the in-process ASGI app — no deploy needed to verify.

### M3 — Deploy, live-render verify, docs (close-out) — ~1–2h
- **Tasks**
  1. Push to dev; wait for CI + Cloud Build; run `scripts/smoke-deployed-mcp.sh dev`.
  2. Live render: add `…/api/mcp` as a ChatGPT developer-mode connector (and/or MCP Inspector);
     confirm a sim renders as an interactive widget.
  3. Docs: design doc status → Implemented; update `WORKSHOP.md` + `README.md` with the cloud-URL path
     (`…/api/mcp`, no tunnel); add the endpoint to [deployed-urls.md](../../../../docs/ops/deployed-urls.md);
     mark 1.1.49 in SEQUENCE build status.
- **Acceptance:** a sim renders in ≥1 external host from the cloud URL; smoke green in `dev`; docs updated.
- **Risk:** host-side render variance (Jan-2026) — ChatGPT/Inspector are the reliable checks; Claude Desktop best-effort.

## Success metrics
- `scripts/smoke-deployed-mcp.sh dev` green (initialize + sims listed + `ui://` readable).
- `backend: make lint && make test-fast` green; `frontend: npm run quality:check` green.
- No regression: existing `/mcp` skill tools + `/api/proxy/**` unchanged.
- One sim visibly rendered in an external host from `…/api/mcp`.

## Out of scope
- Phase 3 (model drives the sim via `ui/notifications/tool-input` / app-tools).
- test/prod exposure (ADR follow-up).
- Retiring the internal slug path (that's [unified-sim-rendering.md](unified-sim-rendering.md)).
