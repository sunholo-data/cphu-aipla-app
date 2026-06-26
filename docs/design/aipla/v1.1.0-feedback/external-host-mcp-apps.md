# External-host MCP App rendering — serve the sims from the cloud URL

**Status:** **IMPLEMENTED** (Phase 1 + 2 shipped to dev 2026-06-26, sprint EXT-MCP).
The deployed cloud endpoint `https://aipla-v01-frontend-…/api/mcp` is live: anonymous
Streamable HTTP, `tools/list` offers `show_boldkast|kinebot|led_planck` with
`_meta.ui.resourceUri`, and `resources/read` returns the artefact HTML
(`text/html;profile=mcp-app`, 34 KB, bridge present) via the lazy sandbox fetch.
Phase 3 (model drives the sim) deferred. **Caveat:** the wire is verified end-to-end;
the *visual* render depends on the host — Claude Desktop currently fetches the resource
but does not mount the iframe (upstream bug
[claude-ai-mcp#165](https://github.com/anthropics/claude-ai-mcp/issues/165); also
[ext-apps#671](https://github.com/modelcontextprotocol/ext-apps/issues/671) for the
`mcp-remote` path). ChatGPT / MCP Inspector / MCPJam are the reliable render checks.
**Last Updated:** 2026-06-26
**Priority:** P2 — a **breadth probe** (memory `aipla-breadth-over-depth`): proves AIPLA
sims are portable, vendor-neutral research instruments. Not pilot-blocking; high
demo/dissemination value (researchers, workshops).
**Estimated:** ~1.5–2.5d — Phase 1 (public MCP transport fix) ~0.5–1d · Phase 2
(`ui://` resources in `mcp_server.py`) ~0.5d · Phase 3 (optional: tool-input
pre-config, app-tools) ~0.5–1d. Excludes the exposure/auth product decision (gate).
**Scope:** **Backend only** for Phase 1–2 — `backend/protocols/mcp_server.py` + one
public MCP route (a dedicated Next route or a proxy fix). **No artefact change**
(the View already speaks the bridge). **No frontend app change.** The existing
in-app sim rendering (`MCPAppToolCallRouter` / `useSimSnapshotPush`) is untouched.
**Dependencies:** `backend/protocols/mcp_server.py` (the FastMCP skills server, mounted
at `/mcp`); the standalone PoC at `infrastructure/mcp-sandbox/external-host-demo/`;
the artefacts under `infrastructure/mcp-sandbox/artefacts/`; ADR-013 (artefact
security gates); the Next proxy `frontend/src/app/api/proxy/[...path]/route.ts`.
Relates to — but is independent of — [unified-sim-rendering.md](unified-sim-rendering.md)
(that retires the *internal* slug path; this adds *external* hosts). No event-bridge
change — already unified.
**Source:** 2026-06-26 — M: *"the MCP apps we are making as sims should also render in
other clients such as Claude Desktop and ChatGPT … make it so for the cloud URL.
What is needed — make a design doc to document it first and prove it."*

## TL;DR

An MCP App has two halves: the **View** (the sim HTML + the `ui/*` postMessage
bridge) and the **Server** (an MCP server that offers the HTML to a client as a
`ui://` resource linked to a tool). **We already own the View** — every AIPLA sim
speaks the SEP-1865 bridge. The missing half is a server, and the deployed cloud
endpoint that *should* host it is **currently broken at the transport layer**. This
doc proves both facts and specifies the small backend work to serve the sims —
rendering as live interactive UI, not text — from `aipla-v01-frontend…/…/mcp` to
Claude Desktop and ChatGPT.

## What is already true (the View half) — PROVEN

1. **The artefacts speak the standard bridge.** Boldkast, KineBot and LED-Planck
   each send `ui/initialize` (`protocolVersion: "2026-01-26"`), read `hostContext`,
   answer `ping`, and emit `ui/update-model-context`. (Grep `ui/initialize` across
   `artefacts/*/v*/index.html`; `_template` is the only one without it.) This is the
   host-agnostic half, and it was built to spec deliberately — the host provides the
   sandbox; the sim only ever talks to `window.parent`.

2. **A standalone server already renders all three sims in external hosts —
   verified.** `infrastructure/mcp-sandbox/external-host-demo/server.py` auto-discovers
   every bridge-speaking artefact and exposes each as a `ui://aipla/<name>/<version>`
   resource (`text/html;profile=mcp-app`) plus a `show_<name>` tool whose `_meta`
   carries both `ui.resourceUri` (Claude Desktop et al.) and `openai/outputTemplate`
   (ChatGPT). `smoke_test.py` drives a real MCP client over stdio and passes:

   ```
   discovered 3 sim tool(s): ['show_boldkast', 'show_kinebot', 'show_led_planck']
     OK  show_boldkast    -> ui://aipla/boldkast/v1    (34269 bytes, bridge present)
     OK  show_kinebot     -> ui://aipla/kinebot/v1     (25019 bytes, bridge present)
     OK  show_led_planck  -> ui://aipla/led-planck/v1  (40121 bytes, bridge present)
   ```

   This is the **proof of concept**: the sims-as-portable-MCP-Apps idea works. The
   demo runs locally (stdio for Claude Desktop; `--http` + a tunnel for ChatGPT). The
   open question this doc answers is whether the **deployed cloud URL** can replace
   the laptop/tunnel.

## The gap — PROVEN against the live deployed service (2026-06-26)

The backend FastMCP server is mounted at `/mcp` ([`backend/fast_api_app.py:395`](../../../../backend/fast_api_app.py#L395),
`app.mount("/mcp", get_mcp_asgi_app())`), and the public path to the sidecar is
`https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app/api/proxy/mcp`. **It does not
currently carry MCP.** Probing the live service:

| Request (public URL) | Result | Meaning |
|---|---|---|
| `GET /api/proxy/health` | **200** | sidecar reachable + healthy |
| `GET /api/proxy/api/skills` (no token) | **401** (clean JSON) | proxy → sidecar hop works generally; not an auth wall on the proxy |
| `GET /api/proxy/mcp` | **502** `{"error":"backend_unreachable","message":"TypeError: fetch failed"}` | the `/mcp` mount specifically fails the proxy fetch |
| `POST /api/proxy/mcp` (MCP `initialize`) | **502** `backend_unreachable` | same — cannot initialise an MCP session |
| `GET /api/proxy/mcp/` (trailing slash) | **308 redirect** → `/api/proxy/mcp` | Next.js strips the slash, so a client can't reach the `/mcp/` form either |

**Root-cause diagnosis.** Two compounding issues, both in the public *transport*, not
in MCP or the artefacts:

1. **Trailing-slash redirect that can't replay the body.** The proxy forwards
   `/api/proxy/mcp` → backend `http://127.0.0.1:1956/mcp` (no slash). FastMCP is
   configured with `streamable_http_path="/"` and mounted at `/mcp`
   ([`mcp_server.py`](../../../../backend/protocols/mcp_server.py)), so the backend's
   Starlette mount **307-redirects `/mcp` → `/mcp/`**. The backend test posts to
   `/mcp/` *with* the slash and gets 200 (`tests/api_tests/test_mcp_server.py`). The
   Next proxy's `fetch` ([`route.ts:117`](../../../../frontend/src/app/api/proxy/[...path]/route.ts#L117))
   sends the POST body as a consumed stream with `duplex: "half"`; on the 307 it
   **cannot replay the body**, so undici throws `TypeError: fetch failed`, which the
   proxy maps to 502 `backend_unreachable`.
2. **Next.js slash-normalisation.** Hitting the `/mcp/` form externally yields a
   308 back to `/mcp`, so a client cannot work around (1) by adding the slash itself.

The sidecar, the proxy mechanism, and the FastMCP server are each individually fine
(`health` 200, `skills` 401, backend test 200). The failure is purely the public
route to `/mcp`.

## What is needed

### Phase 1 — a working public MCP route to the FastMCP server (the real blocker)

Make `POST/GET <public>/…/mcp` reach the backend FastMCP app intact, including
Streamable HTTP (SSE responses + the `Mcp-Session-Id` header round-trip). Options,
cheapest first:

- **1a. Target the slash from a dedicated route.** Add `frontend/src/app/api/mcp/route.ts`
  (or rewrite) that forwards straight to `http://127.0.0.1:1956/mcp/` (**with** the
  trailing slash) so there is no 307 to replay, and is not subject to the catch-all's
  behaviour. Confirm it does not get Next slash-normalised.
- **1b. Remove the backend redirect.** Configure FastMCP so `/mcp` (no slash) serves
  directly (set `streamable_http_path`/mount so no 307 is issued). Lower-level; verify
  the existing `streamable_http_path="/"` gotcha note in `mcp_server.py` still holds.
- **1c. Expose the FastMCP app on its own Cloud Run route/origin**, bypassing the app
  proxy entirely (cleanest separation; most infra).

Whichever route: the proxy already does SSE passthrough and `duplex:half`, and does
not block `Mcp-Session-Id` (not in `BLOCKED_REQUEST_HEADERS`), so streaming + session
should pass once the redirect is gone — **but verify**, since MCP clients are strict.

**Acceptance for Phase 1** (the same `streamablehttp_client` probe in
`/tmp/probe_deployed_mcp.py`, promoted to a checked-in smoke test):

```
OK initialize -> aipla-... | protocol 2025-11-25
tools (N): ['skill_...', ...]        # whatever it serves today
```

i.e. a remote MCP client can `initialize` + `list_tools` against the public URL with
no auth. Add as `scripts/smoke-deployed-mcp.sh` (parity with `scripts/smoke-deployed.sh`).

### Phase 2 — register the sims as `ui://` resources on the deployed server

Fold the PoC's `discover_artefacts()` + resource/tool registration into
`backend/protocols/mcp_server.py`: for each bridge-speaking artefact, register a
`ui://aipla/<name>/<version>` resource (`text/html;profile=mcp-app`, read off disk —
the artefacts already ship in the image) and a `show_<name>` tool with
`_meta.ui.resourceUri` + `openai/outputTemplate`. Keep the existing skill tools
unchanged (additive).

**Acceptance for Phase 2:** the deployed `tools/list` includes `show_boldkast` etc.
with `_meta.ui.resourceUri` set, and `resources/read` returns the artefact HTML with
the `text/html;profile=mcp-app` mimeType. Then a **live render check**: connect the
public URL as a ChatGPT developer-mode connector (and/or Claude Desktop remote
connector / `mcp-remote`) and confirm the sim renders as an interactive widget, not
text. (Honest caveat: some early-2026 Claude Desktop builds negotiate MCP Apps but
don't mount the iframe — ChatGPT and MCP Inspector/MCPJam are the reliable render
checks. See the PoC `WORKSHOP.md`.)

### Phase 3 — optional, deferred: let the model *drive* the sim

Today data flows **out** (student actions → model) but the model cannot configure the
sim. To support "open Boldkast at v₀=30, θ=45", add a `ui/notifications/tool-input`
handler to each artefact (reads the tool arguments on launch). To let the model invoke
sim actions ("play the trajectory"), the artefact would declare app-tools in
`ui/initialize` (`appCapabilities.tools`). Both are additive artefact changes and,
because they ride the standard bridge, would then work identically in the AIPLA app,
Claude Desktop and ChatGPT. Out of scope for "make it render"; tracked for later.

## The one product decision (a gate, not a wiring step)

The deployed `/mcp` is **public, no auth** by design (matches the A2A discovery card;
`skills` already exposes public skills anonymously). Serving sims there means **anyone
with the URL can load them into their own ChatGPT/Claude**. The artefacts are
pedagogical material whose model-context/trust-card contract assumes the AIPLA tutor
on the other end. For a **dev** demo to researchers this is acceptable (consistent with
the existing public-skills posture). Before test/prod, decide: keep open, allow-list,
or require auth (OAuth/token). **Recommendation:** ship Phase 1–2 on **dev only**,
open, for the workshop/research demo; treat public exposure on test/prod as an ADR
follow-up. JB/M sign-off on dev exposure of the three sims before advertising the URL.

## Client connection (once Phase 1–2 land) — no laptop, no tunnel

- **ChatGPT** (remote-only anyway): Settings → Apps & Connectors → Advanced → Developer
  mode; Connectors → Create; URL = the public `…/mcp`. Natural fit — the tunnel in the
  PoC is only a workaround for the local server.
- **Claude Desktop**: add as a remote connector, or use the `mcp-remote` bridge in
  config exactly like the existing `ailang-docs` entry
  (`npx mcp-remote https://…/mcp`).

Full step-by-step for both lives in
[`infrastructure/mcp-sandbox/external-host-demo/WORKSHOP.md`](../../../../infrastructure/mcp-sandbox/external-host-demo/WORKSHOP.md).

## Communication & observability in an external host (vs the AIPLA app)

*Added 2026-06-26 after first ChatGPT render — answers "can we log what the student
does in the sim from ChatGPT?" (no) and "how does it communicate?" (same bridge,
different sink).*

### The channels are identical; the data sink is not

A sim is the same artefact everywhere — it speaks **one** bridge (JSON-RPC over
`postMessage`) to whatever host renders it. What differs is **who consumes the
messages**.

| Channel | In the AIPLA app | In ChatGPT / Claude Desktop |
|---|---|---|
| Host → our server: `tools/call show_<sim>`, `resources/read ui://…` | our backend (visible in MCP request logs) | our backend via `/api/mcp` (visible in MCP request logs) |
| Sim → host: **`ui/update-model-context`** (the student's actions) | our frontend catches it → `POST /api/sessions/{id}/iframe-context` → session state (`mcp_app_context.<sim>`) + BigQuery chat-log pipeline + renders the **"shared with the AI" trust card** | the **host's own model context**. **Never reaches AIPLA.** |
| Host → sim: `ui/initialize` (theme/size), `tool-input`, `tool-result`, `ping` | our frontend | the external host |
| `ui/notifications/chat-flush` (flush pending slider changes before a chat turn) | our frontend sends it before a chat submit | **external hosts don't send it** — it's our custom message |

So the **sim side is identical** in every host; the **AIPLA-specific data capture
lives entirely in our frontend host**. An external host receives the same
`ui/update-model-context` stream but feeds it to *its* model — we see none of it.

### What AIPLA can and cannot see when a sim runs in ChatGPT

- **CAN see** (backend MCP request logs, verified 2026-06-26 ~13:31–13:32 UTC for the
  first ChatGPT session): the connector initialized, listed tools, called
  `show_boldkast`, and read `ui://aipla/boldkast/v1` — i.e. **that the sim was
  opened**. (`POST /mcp/ → 200`; plus the startup line `sim_apps: registered 3 sim
  MCP App(s)`.)
- **CANNOT see**: anything the student *did* inside the sim — slider changes, play,
  revealed values. Those ride `ui/update-model-context` to the external host's model
  and never touch our backend. No session, no BigQuery row, no engagement signal
  (1.1.17), no trust card.

> **Research implication (important).** The external-host path is a **demo /
> dissemination / bring-your-own-AI** surface, **not a research-data surface**. To
> capture student interactions for the study (the [chat-log pipeline](../v1.0.0-pilot/implemented/chat-log-pipeline.md),
> [engagement signals](student-engagement-signals.md)), students must use the
> **AIPLA app**, where our frontend host persists the bridge events. A sim used via
> ChatGPT/Claude is invisible to the research pipeline.

### Why ChatGPT reported "I haven't received any updates"

Both reasons are expected, not a bug:
1. **Commit-on-submit gating (by design).** Boldkast accumulates slider changes
   locally and only emits them on a deliberate commit — pressing **Afspil (play)** —
   or on `ui/notifications/chat-flush`. Dragging sliders alone emits nothing (1.E
   Phase 2, [workbench-state-debounce](../v1.0.0-pilot/workbench-state-debounce.md)).
2. **ChatGPT doesn't send `chat-flush`** (our custom message — only our frontend
   sends it before a chat submit). So in ChatGPT, **only pressing Afspil** commits
   the state to the model; sending a chat message does *not* flush pending changes.
   Hosts also MAY defer context to the next user message (spec). **To see it work in
   ChatGPT: change a parameter → press Afspil → then ask "what did I just do?".**

### Render lifecycle ("it rendered for a while then not")

Hosts own the iframe lifecycle and may tear the View down (`ui/resource-teardown`)
on a new turn, scroll-away, or memory pressure — then show the text fallback.
Re-invoking the tool re-renders. This is host behaviour, not artefact state loss.

### To capture external-host interactions (future option, not built)

The only sim→AIPLA channel from an external host is **`tools/call`**. An artefact
could call a `record_sim_interaction` tool on our MCP server (the host proxies it to
us) instead of/alongside `ui/update-model-context`. Costs: needs an attributable
session/identity (absent on an anonymous connector) and hosts may gate tool calls
behind user approval. Tracked here as the path *if* external-host research capture is
ever required; out of scope for this sprint. (Same two-surface / trust-card tension as
the in-app workbench — see the `workbench-element-builder` skill.)

## Acceptance criteria (roll-up)

1. **Transport:** a remote MCP client (`streamablehttp_client`) can `initialize` +
   `list_tools` against the public dev URL with no auth — codified as
   `scripts/smoke-deployed-mcp.sh`, green in CI's post-deploy smoke (parity with the
   existing smoke step).
2. **Sims offered:** deployed `tools/list` includes `show_<name>` with
   `_meta.ui.resourceUri`; `resources/read` returns the artefact HTML as
   `text/html;profile=mcp-app`.
3. **Live render:** the sim renders as an interactive widget in at least one external
   host (ChatGPT or Inspector/MCPJam as the reliable check; Claude Desktop best-effort).
4. **No regression:** existing skill tools on `/mcp` and the in-app sim rendering are
   unchanged (the demo PoC already proves the artefacts are untouched read-only).
5. **Exposure signed off** for dev before the URL is shared.

## Risks

- **Streamable HTTP through the proxy may need more than the redirect fix** (session
  header echo, SSE GET stream lifetime). Phase 1's smoke test is the gate; if the app
  proxy proves fragile, fall back to option 1c (dedicated route/origin).
- **Host rendering is young (Jan 2026)** and varies by build — keep cross-client
  rendering framed as a probe; rely on the reliable render routes for demos.
- **Exposure** — see the product decision above; do not advertise the URL before
  sign-off.

## Appendix — the shipped proof-of-concept

`infrastructure/mcp-sandbox/external-host-demo/` (committed 2026-06-26):
`server.py` (auto-discovers + serves all sims, stdio + Streamable HTTP), `smoke_test.py`
(verifies all three end-to-end), `README.md` (engineering detail), `WORKSHOP.md`
(researcher + workshop runbook). The SEP-1865 spec is vendored at
`.claude/skills/agent-protocols/references/mcp-apps-spec-2026-01-26.md`.
