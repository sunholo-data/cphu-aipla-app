# AIPLA simulations as portable MCP Apps — workshop & researcher guide

*A guide you can read on its own, and a runbook for demonstrating it live.*

## In one sentence

We built each physics simulation once, and the **same interactive simulation**
now renders as a live, working widget — not a screenshot, not a text description —
inside our own AIPLA tutor, inside **Claude Desktop**, and inside **ChatGPT**.

## Why this matters for the research

- **No vendor lock-in.** The simulations are standard *MCP Apps* (an open
  protocol, stable since 26 January 2026). Any AI client that speaks the standard
  can render them — today that includes Claude Desktop, ChatGPT, VS Code Copilot,
  Goose, Postman and MCPJam. We are not tied to one company's product.
- **The AI can see what the student does.** When a student drags a slider, plays
  a trajectory, or reveals a value, that interaction flows back to the model as
  context — through the *same* mechanism in every client. The tutor can then
  respond to what actually happened, not just to what the student typed.
- **One artefact, many surfaces.** A research instrument built once travels to
  wherever the study needs it, with no re-implementation. Less to build, less to
  maintain, fewer ways for the surfaces to drift apart.

## Does the UI actually render, or is it just text?

It renders the **live, interactive simulation**. You manipulate it in place — the
sliders move, the trajectory animates — exactly as in the AIPLA app.

If you ever see *only* a line of text instead, that text is a deliberate
**fallback** for clients that cannot draw UI. When the client supports MCP Apps
(Claude Desktop, ChatGPT, …) it fetches the simulation's HTML and mounts the real
interactive widget. Rendering the UI is the entire point of the exercise.

## The idea in two halves

A portable interactive app has two parts. We already owned the hard one.

| Part | Who owns it | Where we are |
|---|---|---|
| **The View** — the simulation's HTML and the small message-bridge it speaks to its host | the simulation itself | **Done already.** Every AIPLA sim already speaks the standard bridge (it announces itself, reads the host's theme, and reports the student's actions back). This is host-agnostic by design. |
| **The Server** — a small service that hands each simulation to a client as a named UI resource and offers a tool to show it | a backend | **The new piece.** [`server.py`](./server.py) is exactly this. It finds every sim in our `artefacts/` folder and offers each one to any standard client. ~150 lines, no rewrite of the sims. |

## Three ways to see it live (pick what suits the room)

### A. Claude Desktop — local, no internet plumbing (already set up on Mark's machine)

1. The server is registered in Claude Desktop's config as **`aipla-sims`**
   (see the Appendix for the exact entry).
2. **Quit and reopen Claude Desktop** so it picks up the new server.
3. In a chat, open the tools/connectors control (the plug or "Search and tools"
   button under the message box) and make sure **`aipla-sims`** is enabled. It
   offers three tools: `show_boldkast`, `show_kinebot`, `show_led_planck`.
4. Type: **"show me the boldkast simulation"** (or kinebot, or led-planck).
   Claude calls the tool and the simulation renders inline. Interact with it; your
   changes are reported back to Claude so it can tutor on what you did.

> **If it shows only text:** some Claude Desktop builds negotiate MCP Apps but do
> not yet mount the iframe (a known, host-side issue in early-2026 builds — not a
> problem with our simulation). For a guaranteed render in a live workshop, use
> route B (ChatGPT) or route C (Inspector), and remember our own AIPLA app always
> renders it. Requires a recent Claude Desktop on a paid plan.

### B. ChatGPT — developer mode plus a public URL

ChatGPT only connects to *remote* servers, so we run the HTTP version and expose
it over HTTPS.

1. Start the server in HTTP mode:
   ```bash
   cd infrastructure/mcp-sandbox/external-host-demo
   ./server.py --http --port 8000          # serves at http://localhost:8000/mcp
   ```
2. Expose it over HTTPS (HTTPS is mandatory for ChatGPT):
   ```bash
   cloudflared tunnel --url http://localhost:8000     # or: ngrok http 8000
   ```
   Note the public `https://….trycloudflare.com` (or ngrok) address.
3. In ChatGPT: **Settings → Apps & Connectors → Advanced settings → enable
   Developer mode** (your org must allow it; supported on all paid plans as of
   Nov 2025).
4. **Settings → Connectors → Create.** Set a name (e.g. "AIPLA sims"), a
   description, and **Connector URL = `https://<your-tunnel>/mcp`**. Click Create;
   ChatGPT connects and lists the three `show_…` tools. No login/OAuth is needed
   for this no-auth demo server.
5. In a new conversation, click **+** near the composer → **More** → choose the
   connector. Ask **"show the led-planck simulation"** — the interactive widget
   renders in the chat.
6. If you change the tools later, reopen the connector in **Settings → Connectors**
   and click **Refresh**.

### C. MCP Inspector / MCPJam — the reference renderer (most reliable for a live demo)

```bash
npx @modelcontextprotocol/inspector uv run --script ./server.py
```

The Inspector shows the wire directly: `tools/list` (with the UI link on each
tool), the `ui://` resources, and a preview that mounts the simulation. MCPJam
(<https://www.mcpjam.com>) is an alternative inspector that also renders MCP App
UIs. Use either when you want a render that does not depend on a consumer app's
build.

## What is happening under the hood (the talk-track)

1. You ask for a simulation. The model decides to call, say, `show_boldkast`.
2. The client sees the tool is linked to a UI resource and fetches that resource
   (the simulation's HTML) from our server.
3. The client mounts the HTML in a **sandboxed iframe** — isolated, no access to
   your files or the host page; it can only exchange messages.
4. The simulation and the client shake hands; the simulation reads the host's
   theme and settles in.
5. You interact. Each meaningful action (set v₀ = 25 m/s, play, reveal the range)
   is reported back to the client as **model context**.
6. On your next message the model sees what you did and tutors accordingly.

That round trip — *show the UI, then feed the student's actions back to the
model* — is the whole reason this is more than an embedded animation.

## How a simulation talks to the AI (in and out)

| Direction | What flows | Purpose |
|---|---|---|
| **Out** (sim → model) | a small structured update describing the student's action, with a human-readable label (e.g. "Afspillede med v₀ = 15 m/s, θ = 40°") | this is how the AI *sees what the student did* |
| **In** (client → sim) | the host's theme/size, the tool arguments, lifecycle and health messages | lets the sim match the host and stay in sync |
| **Optional** | the sim can ask the client to run a tool, open a link, or go full-screen | richer, self-updating views |

Everything travels as small, auditable messages; the client is always in control
and the sim is sandboxed.

## Making *all* our simulations available (and adding new ones)

The server does not hard-code any one sim. It scans the `artefacts/` folder and
offers every simulation that speaks the bridge. Today that is **Boldkast**
(projectile motion), **KineBot** (kinematics) and **LED-Planck** (measuring
Planck's constant). Drop a new simulation in as `artefacts/<name>/v<n>/index.html`
and it appears automatically — no code change. That is what "available as
standard" means in practice.

## Running it from our deployed service (for a hosted demo, no laptop)

Our backend already publishes a standard MCP endpoint at
`https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app/api/proxy/mcp`. To serve the
simulations from there (so a ChatGPT/Claude connector can point at our cloud URL
with no tunnel), we fold this demo's resource/tool registration into that backend
server. Two things to settle first: confirm the web proxy passes the streaming
connection cleanly, and — more importantly — decide **who is allowed to load the
simulations**, since that endpoint is currently open to anyone. The simulations
are teaching material whose design assumes the AIPLA tutor on the other end, so
exposing them publicly is a project decision, not just a wiring step.

## Status and honest caveats

- MCP Apps shipped on 26 January 2026. Host support is real but young; rendering
  behaviour varies between client builds. Treat cross-client rendering as a
  **probe**, not a finished, guaranteed-everywhere feature.
- Our half — the simulations and this server — is verified end-to-end
  (`smoke_test.py` checks every sim is offered correctly and returns valid,
  bridge-speaking HTML). When a particular client shows text instead of UI, the
  gap is in that client, and the reliable render routes above still work.
- This is intentionally separate from the live AIPLA backend, so running the demo
  risks nothing in production.

## Appendix — exact configuration and commands

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`,
inside `"mcpServers"`):

```json
"aipla-sims": {
  "command": "/Users/mark/.local/bin/uv",
  "args": [
    "run",
    "--script",
    "/Users/mark/dev/sunholo/cphu-aipla-app/infrastructure/mcp-sandbox/external-host-demo/server.py"
  ]
}
```

**Verify the server with no GUI at all:**

```bash
cd backend && uv run python ../infrastructure/mcp-sandbox/external-host-demo/smoke_test.py
# -> ALL CHECKS PASSED — every sim is a spec-compliant MCP App an external host can render.
```

**Background reading:** the MCP Apps specification (SEP-1865) is vendored in this
repo at `.claude/skills/agent-protocols/references/mcp-apps-spec-2026-01-26.md`.
External: the [MCP Apps announcement](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/),
[OpenAI Apps SDK — MCP Apps in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt),
and [connecting a remote server to ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt).
