# Rendering AIPLA sims in Claude Desktop & ChatGPT — a working demo

**Question:** the sims we build as MCP Apps — should they also render in other
clients like Claude Desktop and ChatGPT? **Answer: yes, and we are most of the
way there already.** This directory is a runnable proof.

> **Sharing this / running a workshop?** [WORKSHOP.md](./WORKSHOP.md) is the
> non-technical, self-contained walkthrough for researchers and a live-demo
> runbook (Claude Desktop, ChatGPT, and Inspector, step by step). This README is
> the engineering detail.

## The verdict (read this first)

An MCP App has two halves:

| Half | Who owns it | AIPLA status |
|---|---|---|
| **View** — the artefact HTML + the `ui/*` postMessage bridge | the sim itself | **Already done.** All three sims (Boldkast, KineBot, LED-Planck) already send `ui/initialize` with `protocolVersion: "2026-01-26"`, read `hostContext`, answer `ping`, and push interactions via `ui/update-model-context`. See [`../artefacts/boldkast/v1/index.html`](../artefacts/boldkast/v1/index.html) lines ~637–802. This is host-agnostic by design. |
| **Server** — an MCP server that registers each HTML as a `ui://` resource and links a tool to it via `_meta.ui.resourceUri` | a backend | **The gap (the new piece).** Today the sims are served as raw static HTML and summoned by our *own* frontend router (`MCPAppToolCallRouter` / `useSimSnapshotPush`). No MCP server exposes them, so no external host can discover or render them. |

So the work to render in Claude Desktop / ChatGPT is **not** "rewrite the sims".
It is "stand up an MCP server in front of the artefacts we already have."
[`server.py`](./server.py) is that server. It scans the sibling `artefacts/`
directory and registers **every** sim that speaks the bridge, loading the
**exact same** HTML the AIPLA frontend serves. No fork, no rewrite — and a new
sim under `artefacts/<name>/v<n>/index.html` appears here with zero code changes.

Why it already works: per SEP-1865 the View talks to `window.parent` over a
JSON-RPC `postMessage` bridge, and the *host* provides the sandbox + the
`hostContext`. We followed that spec when we built the artefacts, so a different
host's sandbox satisfies the same contract our frontend's `sandbox.js` does.

## What the demo proves

For each discovered sim, `server.py` exposes:

- a **resource** `ui://aipla/<name>/<version>`, mimeType `text/html;profile=mcp-app`,
  whose body is the artefact HTML;
- a **tool** `show_<name>` whose `_meta` links to that resource using **both**
  the standard `ui.resourceUri` (Claude Desktop, VS Code, Goose, Postman, MCPJam)
  **and** `openai/outputTemplate` (ChatGPT Apps SDK). That one line is the only
  place the two host families still diverge.

Verify it without any GUI client:

```bash
cd ../../../backend          # any env with `mcp` installed
uv run python ../infrastructure/mcp-sandbox/external-host-demo/smoke_test.py
```

Expected tail: `ALL CHECKS PASSED — every sim is a spec-compliant MCP App an
external host can render.` (currently 3 sims: boldkast, kinebot, led-planck).

## Connect it to Claude Desktop (the easiest demo — local stdio, no public URL)

1. Open `~/Library/Application Support/Claude/claude_desktop_config.json`.
2. Add this server (use the **absolute** path to `uv` — the GUI app does not
   inherit your shell `PATH`):

   ```json
   {
     "mcpServers": {
       "aipla-sims": {
         "command": "/Users/mark/.local/bin/uv",
         "args": [
           "run",
           "--script",
           "/Users/mark/dev/sunholo/cphu-aipla-app/infrastructure/mcp-sandbox/external-host-demo/server.py"
         ]
       }
     }
   }
   ```

3. Quit and reopen Claude Desktop. The server appears under the connectors
   (plug) icon as `aipla-sims`, offering `show_boldkast`, `show_kinebot`,
   `show_led_planck`.
4. In a chat: **"show me the boldkast simulation"** (or kinebot / led-planck) →
   Claude calls the tool → the sim renders inline in the conversation. Interact
   with it; your changes flow back to Claude as model context (the same
   `ui/update-model-context` payloads the AIPLA tutor reads), so it can tutor on
   what you did.

## Connect it to ChatGPT (more involved — needs developer mode + a public HTTPS URL)

ChatGPT only talks to **remote** MCP servers, so run the HTTP transport and
expose it over HTTPS:

```bash
./server.py --http --port 8000          # serves Streamable HTTP at /mcp
cloudflared tunnel --url http://localhost:8000   # or: ngrok http 8000
```

Then in ChatGPT: **Settings → Connectors → Advanced → Developer mode**, add a
connector pointing at `https://<your-tunnel>/mcp`. Enable it for a conversation
and ask for the sim. ChatGPT reads the `openai/outputTemplate` key (already set)
and renders the iframe. (Publishing a connector beyond your own account needs
OpenAI's review — out of scope for a demo.)

## Connect it to MCP Inspector (fastest sanity check of the wire)

```bash
npx @modelcontextprotocol/inspector uv run --script ./server.py
```

Inspect `tools/list` → see `_meta.ui.resourceUri`; open the resource → see the
HTML render in the Inspector's MCP-Apps preview.

## Run it from our deployed Cloud Run URL — LIVE (no local server, no tunnel)

The local stdio server above is the zero-setup demo. **The sims are now also
served from our cloud** (shipped 2026-06-26, sprint EXT-MCP / design 1.1.49):

```
https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app/api/mcp
```

- The backend FastMCP server (mounted at `/mcp`,
  [`backend/fast_api_app.py:395`](../../../backend/fast_api_app.py#L395)) now
  registers the sims as `ui://` resources + `show_<name>` tools
  ([`backend/protocols/sim_apps.py`](../../../backend/protocols/sim_apps.py)),
  alongside the public-skill tools.
- It's reached via a **dedicated** [`frontend/src/app/api/mcp/route.ts`](../../../frontend/src/app/api/mcp/route.ts)
  — *not* the catch-all `/api/proxy/mcp`. Why: the catch-all forwards `/mcp`
  (no slash), FastMCP 307-redirects to `/mcp/`, and the proxy's consumed-body
  fetch can't replay across the redirect → 502. The dedicated route forwards
  straight to `mcp/` (trailing slash), so there is no redirect.
- **Public, no auth** (same posture as the public-skills endpoint). Paste it into
  a ChatGPT remote connector or a Claude Desktop `mcp-remote` entry — no tunnel.
- Verified end-to-end: `REQUIRE_SIMS=1 ./scripts/smoke-deployed-mcp.sh dev` →
  initialize + the three sim tools + readable `ui://` resources. The artefact HTML
  is fetched on demand from the sandbox host (`MCP_SANDBOX_URL`), so the backend
  image doesn't carry the HTML and the cloud always serves the canonical sim.

Still true: the **visual render is host-dependent** (Claude Desktop currently
fetches the resource but doesn't mount the iframe — upstream
[claude-ai-mcp#165](https://github.com/anthropics/claude-ai-mcp/issues/165);
ChatGPT / MCP Inspector render reliably), and the open endpoint is a **product
decision** — anyone with the URL can load the sims, fine for a dev research demo
but decide auth/allow-list before test/prod (ADR territory).

## How communication in & out of a sim works

Every sim is an iframe that speaks **JSON-RPC 2.0 over `postMessage`** to its
host (SEP-1865 §Communication Protocol). The host wraps it in a sandboxed iframe
(`allow-scripts`, no `allow-same-origin`) — web hosts add an outer "sandbox
proxy" iframe, desktop/native hosts render it directly; either way the sim only
ever talks to `window.parent`. No SDK is required; our artefacts inline a ~20-line
JSON-RPC helper.

**Handshake (once, on load):**

1. sim → host: `ui/initialize` (`protocolVersion`, `capabilities`, `clientInfo`)
2. host → sim: result with `hostContext` (theme, locale, display mode, container
   size, CSS theming variables)
3. sim → host: `ui/notifications/initialized` — now the channel is open.

**Data OUT of the sim → the model (the channel that matters for tutoring):**

- `ui/update-model-context` (notification). The sim sends `structuredContent`
  describing what the student did, e.g. Boldkast's
  `{ kind: "boldkast.state-change", changed: ["v0"], state: {v0,theta,g},
  triggeredBy: "play", label: "Afspillede med v₀=15 m/s, θ=40°" }`. The host
  stores this and feeds it to the model on the next turn. **This is how "the AI
  sees what the student did."** Each update overwrites the previous one.
- `notifications/message` — pure logging/telemetry (not model context).
- `ui/message` — push an actual chat message *as the user* and trigger a turn
  (heavier; use for "explain this result", not for every slider drag).

**Data IN to the sim ← the host:**

- `ui/notifications/tool-input` — the tool-call arguments (could seed initial
  state; our sims don't consume it yet — see caveat below).
- `ui/notifications/tool-result` — the tool's result payload.
- `ui/notifications/host-context-changed` — theme/size/display-mode changes.
- `ping` — health check; the sim replies `{ result: {} }`.

**Richer sim → host requests (optional, all in the spec):** `tools/call` (the
sim calls back a tool on the *same* MCP server to fetch fresh data — enables
self-updating views), `ui/open-link`, `ui/request-display-mode`
(inline/fullscreen/pip), `resources/read`.

**One AIPLA-specific nuance.** In *our* frontend, `ui/update-model-context` is
caught by `MCPAppToolCallRouter`, POSTed to
`/api/sessions/{id}/iframe-context` (→ session state `mcp_app_context.<sim>.state`),
**and** dispatched as a visible "shared with the AI" trust card. An external host
(Claude Desktop/ChatGPT) handles the *same* outbound message natively as model
context — it just won't render our trust card, and it won't send our non-standard
`ui/notifications/chat-flush`. The data contract is identical; only the consumer
differs. That is precisely why the artefacts are portable.

## Caveats — this is bleeding edge (Jan 2026)

- **MCP Apps shipped 2026-01-26.** Confirmed host rendering so far: Claude
  Desktop, VS Code Copilot, Goose, Postman, MCPJam, ChatGPT (Apps SDK). Support
  is real but young.
- There are **open rendering bugs** in some Claude Desktop builds where the
  capability negotiates correctly but the iframe never mounts
  (e.g. `anthropics/claude-ai-mcp` issues #165, #236; `ext-apps` #671). If the
  sim doesn't appear, that is a known host-side issue, not our artefact — the
  smoke test proves our half is correct. Try MCP Inspector to isolate.
- `ui/notifications/chat-flush` is an **AIPLA-specific** message our frontend
  sends; external hosts won't, so commit-on-submit gating falls back to
  emit-on-`Afspil`. Harmless — just slightly chattier model context externally.
- The sim does not yet seed its initial state from tool arguments. To let an
  agent open it pre-configured (`v0=25, theta=40`), have the artefact handle the
  `ui/notifications/tool-input` notification — a small, additive artefact change.

## From demo to production

This standalone server is deliberately separate from the live backend so it
risks nothing. The production path is to fold UI resources into the existing
FastMCP server at [`backend/protocols/mcp_server.py`](../../../backend/protocols/mcp_server.py)
(already mounted at `/mcp`, already exposes skills as tools) by registering one
`ui://` resource per artefact and adding `_meta.ui.resourceUri` to the relevant
tools. Before doing that, decide:

- **Auth / exposure.** The live `/mcp` is public, no-auth, public-skills-only by
  design. Exposing student sims to arbitrary external hosts is a *product*
  decision (ADR territory), not a wiring detail — the artefacts are pedagogical
  IP and the trust-card / model-context contract assumes the AIPLA tutor on the
  other end.
- **One generator, not N hand-written servers.** All artefacts live under
  `artefacts/<name>/v<version>/index.html` with a uniform bridge. A loop over
  that directory can register every sim as a `ui://` resource automatically —
  worth a `aiplatform sim` subcommand rather than per-sim code.

See the `mcp-app-artefact` and `agent-protocols` skills, and the SEP-1865 spec
vendored at
`.claude/skills/agent-protocols/references/mcp-apps-spec-2026-01-26.md`.
