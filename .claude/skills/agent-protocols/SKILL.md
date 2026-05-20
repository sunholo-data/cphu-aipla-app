---
name: agent-protocols
description: >
  Vendored protocol specifications for the agent platform's full stack:
  Agent Skills (SKILL.md format), AG-UI (streaming transport), A2UI
  (declarative UI), MCP (tools/resources/prompts), and MCP Apps
  (interactive iframe UIs). Use when writing a design doc that involves
  any of these protocols, when implementing a tool that emits A2UI or
  MCP App content, when wiring AG-UI events, or when answering
  "is this A2UI, MCP App, or AG-UI?" — they get confused often.
  References are vendored at fetch time so they survive spec-site
  outages and are quotable from disk. Do NOT use for project-specific
  ADK wiring (that's adk-cheatsheet) or for deployed-service ops
  (that's the *-deploy skills).
license: Apache-2.0
metadata:
  author: AI Protocol Platform template
  version: "0.1.0"
  fetched: "2026-05-20"
---

# Agent Protocols — what the platform stack speaks

The platform's stack is **four protocols** stitched together. Each has its own
spec, repository, version cadence, and confusion points. Common mistake: calling
something "A2UI" when it's actually MCP Apps, or designing an "agent that emits
HTML" without realising AG-UI's tool-call envelope is what carries it.

This skill bundles all four specs as local files so you can quote them by line
number, and gives a one-page map of which protocol applies where.

```
Layer 4 — UI:        A2UI (declarative JSON components)     MCP Apps (iframe HTML/JS)
                     ───────────────────┬──────────────────────────────┬─────────
                                        │                              │
Layer 3 — Transport: ◄──────────── AG-UI (SSE event stream) ───────────┘
                                        │
Layer 2 — Tools:     ◄────────────── MCP (tools/resources/prompts via JSON-RPC) ──
                                        │
Layer 1 — Skills:    ◄───── Agent Skills spec (SKILL.md + scripts/refs/assets) ───
                                        │
                                  (the agent — ADK / LangGraph / etc.)
```

## Picking the right protocol — decision table

| You want to… | Use | Why |
|---|---|---|
| Define an agent's identity, instructions, and bundled tools | **Agent Skills** | `SKILL.md` frontmatter + body; portable across runtimes |
| Stream tokens from agent → browser chat | **AG-UI** | `TEXT_MESSAGE_*`, `TOOL_CALL_*` events over SSE |
| Have the agent emit a card / form / dashboard the host renders natively | **A2UI** | Declarative JSON → host React components. Safe (no script execution) |
| Have the agent emit an interactive simulation, 3D, canvas, or game | **MCP Apps** | Sandboxed iframe runs arbitrary HTML+JS, locked CSP, postMessage bridge |
| Let an agent call an external tool (DB, API, RAG retriever) | **MCP** | `tools/list`, `tools/call` over JSON-RPC; transport stdio or HTTP |
| Discover other agents and delegate to them | **A2A** (out of scope for this skill — see `architecture.qmd` ADR notes) | A2A agent cards |

**Quick disambiguation** (the question that comes up *every* design doc):

- **"Is this A2UI or MCP App?"** — Look at the artefact. **Static layout the host can render from JSON?** A2UI. **Anything imperative (animation, canvas, drag, sim)?** MCP App. They are not competing; they coexist (A2UI for forms + status, MCP App for interactive surfaces).
- **"Is AG-UI the same as A2UI?"** — No. AG-UI is the *transport*; A2UI is one of the *payloads* it carries. AG-UI handles streaming text and tool calls; A2UI is the JSON-component spec that travels inside an AG-UI `TOOL_CALL_RESULT` event when the agent emits UI.
- **"Where does MCP fit in?"** — Below all of the above. MCP defines server-side tools the agent can *invoke*. A tool's result can include A2UI JSON or an MCP App `ui://` resource — those then ride AG-UI to the browser.

## The references in this skill

Each file in `references/` is a **vendored snapshot** of the upstream spec at
fetch time. They're not summaries — they're the spec text, suitable for direct
quoting in design docs. Provenance + fetch date are at the top of each file (or
in the filename for versioned specs).

| File | Source | When to read |
|---|---|---|
| [references/agent-skills-spec.md](references/agent-skills-spec.md) | <https://agentskills.io/specification> | Defining a new skill template, validating SKILL.md frontmatter, debugging skill discovery |
| [references/ag-ui-architecture.md](references/ag-ui-architecture.md) | <https://docs.ag-ui.com/concepts/architecture.md> | Understanding the run/thread/state model before wiring a new agent transport |
| [references/ag-ui-events.md](references/ag-ui-events.md) | <https://docs.ag-ui.com/concepts/events.md> | Looking up the exact shape of `TEXT_MESSAGE_CONTENT`, `TOOL_CALL_START`, `STATE_DELTA`, etc. The canonical event enum |
| [references/ag-ui-python-events.md](references/ag-ui-python-events.md) | <https://docs.ag-ui.com/sdk/python/core/events.md> | Same enum but typed for the Python SDK (`ag_ui.core.events`) |
| [references/ag-ui-tools.md](references/ag-ui-tools.md) | <https://docs.ag-ui.com/concepts/tools.md> | Tool-call lifecycle in AG-UI: `start → args → end → result` events, human-in-loop pauses |
| [references/ag-ui-vs-mcp-a2a.md](references/ag-ui-vs-mcp-a2a.md) | <https://docs.ag-ui.com/agentic-protocols.md> | The official protocol-relationship explainer; read first if the stack still feels muddled |
| [references/a2ui-protocol-v0.10.md](references/a2ui-protocol-v0.10.md) | <https://github.com/google/A2UI/blob/main/specification/v0_10/docs/a2ui_protocol.md> | Full A2UI v0.10 spec: `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface` messages, data-model + adjacency-list semantics |
| [references/mcp-architecture.md](references/mcp-architecture.md) | <https://modelcontextprotocol.io/docs/learn/architecture> | MCP big picture: client/server/host model, primitives (tools/resources/prompts/sampling/elicitation), lifecycle |
| [references/mcp-apps-spec-2026-01-26.md](references/mcp-apps-spec-2026-01-26.md) | <https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx> | **SEP-1865 stable spec**: `ui://` resource scheme, tool→UI linkage via `_meta`, iframe sandboxing rules, postMessage bridge |
| [references/mcp-apps-readme.md](references/mcp-apps-readme.md) | <https://github.com/modelcontextprotocol/ext-apps/blob/main/README.md> | The reference SDK README: `@modelcontextprotocol/ext-apps/app-bridge`, the View class, example app catalogue (18+ real apps) |

## Common pitfalls

These are the mistakes that recur most often across forks and design reviews:

### 1. Confusing A2UI and MCP Apps

A2UI renders **in your DOM**, MCP Apps render **in a sandboxed iframe**.

| Concern | A2UI | MCP Apps |
|---|---|---|
| Trust boundary | Same origin, but declarative JSON — no script execution | Cross-origin iframe with `sandbox="allow-scripts"`, no `allow-same-origin` |
| Bandwidth | Tens of KB (JSON tree) | Hundreds of KB (HTML+JS+CSS), spec caps at sensible limits |
| Use case | Forms, status cards, dashboards | Interactive sims, 3D, games, canvas animations |
| Composition | Host knows component types; agent picks from catalog | Host knows nothing about contents; iframe is a black box |
| Communication | Agent → JSON → host renders | iframe ↔ host via `postMessage`; both speak MCP JSON-RPC inside the bridge |

If you're writing a design doc and you can't tell which one applies, the test
is: *"Does the artefact need to run code in the browser to do its job?"* If yes
→ MCP Apps. If a static (or slider-driven) JSON description suffices → A2UI.

### 2. Confusing AG-UI's event types with the payload they carry

AG-UI is just the envelope. The payload of a `TOOL_CALL_RESULT` event can be:

- Plain text → renders as part of the assistant message
- A2UI JSON → host's A2UI renderer mounts it on the named `surfaceId`
- MCP App `ui://` resource → host's MCP App router fetches it and mounts the iframe
- Anything else → the host decides

Don't write "send A2UI via AG-UI" as if it's a special path. It's one of many
payloads. The AG-UI spec doesn't define A2UI; it defines how to deliver *any*
tool result.

### 3. Treating prompt-rules as security boundaries

Telling the model "NEVER call `send_a2ui_json_to_client`" in a system prompt is
a hack — see [AIPLA upstream-feedback #22](../../../docs/upstream-feedback.md).
The correct fix is to **not attach the tool to the agent in the first place**
(via skill config or tool-registry filtering). The model can't call a tool that
isn't in its tool list; the model *can* fail to obey a prompt rule.

### 4. Mixing MCP spec versions

MCP has dated specifications (e.g. `2025-06-18`, `2026-01-26`). Servers and
clients negotiate via `protocolVersion` during `initialize`. If a server
declares `2026-01-26` and the client only supports `2025-06-18`, the
connection should terminate. Don't assume your SDK is current — check.

MCP Apps has its own version (SEP-1865 stable `2026-01-26`) inside the MCP
extensions track. The MCP Apps version is *not* the MCP version.

### 5. Treating the spec sites as a source of stable URLs

The vendored copies in `references/` are pinned to the **fetch date in the
frontmatter `metadata.fetched`**. Specs move. When updating:

1. Check the upstream URL still exists.
2. Fetch the new content.
3. Diff against the existing file.
4. Bump `metadata.fetched` in this SKILL.md.
5. Note significant breaking changes in a `CHANGELOG.md` next to the file.

## How to keep this skill current

Refresh cadence: **once per quarter** OR **when an upstream spec version bumps**
OR **when a fork hits a bug that turns out to be us reading a stale spec**.

Refresh script (manual for now):

```bash
cd .claude/skills/agent-protocols/references

# A2UI — version-bump aware
curl -sL https://raw.githubusercontent.com/google/A2UI/main/specification/v0_10/docs/a2ui_protocol.md \
  -o a2ui-protocol-v0.10.md
# If v0.11 lands, fetch it as a NEW file and update this SKILL.md's table.

# AG-UI
for slug in agentic-protocols concepts/architecture concepts/events concepts/tools sdk/python/core/events; do
  fname=$(echo "ag-ui-${slug}" | tr '/' '-').md
  curl -sL "https://docs.ag-ui.com/${slug}.md" -o "${fname}"
done

# MCP architecture
curl -sL https://modelcontextprotocol.io/docs/learn/architecture.md -o mcp-architecture.md

# MCP Apps — version-dated spec
curl -sL https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx \
  -o mcp-apps-spec-2026-01-26.md
curl -sL https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/README.md \
  -o mcp-apps-readme.md

# Agent Skills
curl -sL https://agentskills.io/specification.md -o agent-skills-spec.md
```

Then commit with `chore(skills): refresh agent-protocols references YYYY-MM-DD`.

## See also

- [adk-cheatsheet](../adk-cheatsheet/SKILL.md) — how ADK *implements* the agent runtime that produces AG-UI events
- [adk-dev-guide](../adk-dev-guide/SKILL.md) — wiring tools, callbacks, sessions
- [design-doc-creator](../design-doc-creator/SKILL.md) — when scoring a doc on Axiom #6 (Protocol Over Custom) you should consult this skill first to verify no standard already covers the use case
- AIPLA-specific protocol notes — none yet, but if AIPLA's MCP Apps usage diverges from the upstream spec, that lives in [docs/upstream-feedback.md](../../../docs/upstream-feedback.md), not in this skill
