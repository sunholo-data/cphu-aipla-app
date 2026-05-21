# MCP-App iframe path — move static artefacts onto the spec

**Status**: Implemented (branch `feature/mcp-app-spec-compliance`, M-signoff 2026-05-21; merged to `dev` same day)
**Priority**: P2 (post-Jutland; protocol hygiene, not demo-blocking)
**Estimated**: ~1.5 days (0.5 sandbox-proxy static-artefact mode · 0.3 Boldkast on-spec rewrite · 0.3 BoldkastSimFrame host refactor · 0.2 tests · 0.2 docs + upstream entry)
**Scope**: Frontend (host wrapper) + sandbox service (proxy mode) + artefact JS (wire envelope)
**Dependencies**: [mcp-app-iframe-harness.md](mcp-app-iframe-harness.md) (the off-spec harness — superseded by this design); [boldkast-mcp-app.md](boldkast-mcp-app.md) (the artefact this migrates)
**Created**: 2026-05-21
**Last Updated**: 2026-05-21

## Why this doc exists

AIPLA's first artefact (Boldkast) currently runs **off the MCP Apps spec** at the iframe ↔ host layer:

- Iframe emits raw postMessage `{source: "boldkast", type: "boldkast.show_value", ...}` instead of the spec's JSON-RPC 2.0 envelope with `method: "ui/update-model-context"`.
- Host runs in a `sandbox="allow-scripts"` iframe (no `allow-same-origin`) → opaque origin → window-identity auth as a workaround for the origin-check that would have worked under the spec's sandbox-proxy architecture.
- No `ui/initialize` handshake.

This wasn't a deliberate spec deviation — it was the path of least resistance when the template's `@mcp-ui/client` AppRenderer (the spec's host-side bridge) didn't fit our non-agent-summoned use case. After deeper research into the MCP Apps spec ([vendored snapshot](../../../../.claude/skills/agent-protocols/references/mcp-apps-spec-2026-01-26.md)), we found:

- **Line 426**: *"Note that you don't need an SDK to 'talk MCP' with the host"* — followed by a ~20-line vanilla-JS JSON-RPC implementation. The byte-budget objection that drove us off-spec was over-cautious.
- **Lines 470–487 (Sandbox proxy)**: the spec defines a sandbox-proxy architecture where the View runs inside an iframe at a separate origin that has `allow-same-origin` (so origin is NOT opaque), with the host validating `e.origin === SANDBOX_ORIGIN`. The opaque-origin gotcha that bit us on 2026-05-21 is what happens when you bypass this layer.

The lesson (saved as memory [feedback-search-protocols-first](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_search_protocols_first.md)): **search published specs exhaustively before rolling our own**. We didn't, and the cost was a whole sprint of refactoring + 5 upstream-feedback entries + a v1 migration to clean up.

This doc is the migration plan. **It is branch work — Jutland (Wed 2026-05-27) ships on the current off-spec path.** We don't restructure on demo week. After the demo we trial this in a branch, validate that the spec path works end-to-end, then merge.

## Goals

**Primary Goal:** The Boldkast static artefact communicates with the host via the MCP Apps spec's JSON-RPC over postMessage, with the sandbox-proxy architecture handling the iframe origin / handshake / CSP. The existing host → backend wire (POST `/api/sessions/{id}/iframe-context`) stays unchanged — that part is already on-spec.

**Success Metrics:**
- Boldkast iframe's outgoing wire shape matches MCP Apps `ui/update-model-context` JSON-RPC envelope per spec §Communication Protocol.
- Host validates events via `e.origin === SANDBOX_ORIGIN` (window-identity workaround removed; AIPLA went single-path on 2026-05-21 — the off-spec hook was deleted post-validation per M's "one way of doing things" rule).
- `ui/initialize` handshake completes successfully on artefact load (spec §Standard MCP Messages).
- All existing AIPLA UX behaviour preserved end-to-end: cards still surface in chat, slider debouncing still works, agent still sees the snapshot via iframe-context, observability pipeline intact.
- New unit + e2e tests covering the spec path.
- AIPLA's own [mcp-app-artefact](../../../../.claude/skills/mcp-app-artefact/SKILL.md) skill updated to recommend the spec path for new artefacts.
- Upstream-feedback #30 reframed once we've validated the path locally — the contribution back to the template is the static-artefact sandbox-proxy mode.

**Non-Goals:**
- Tool calls from the artefact to MCP servers (`tools/call`). Boldkast doesn't call tools; this is iframe → host context-push only.
- Host → artefact push (`ui/notifications/tool-input`, `ui/notifications/tool-result`). The agent doesn't drive Boldkast; the student does.
- AppRenderer adoption. AppRenderer is geared to agent-summoned UIs (mounts from a tool-result resource URI). For static artefacts a thinner spec-compliant component is more appropriate.
- Migrating the in-flight v0.1 demo. The current path ships Jutland; this is post-demo.
- Full MCP App tool schema (`tools/list`, `resources/list`). Boldkast doesn't expose tools/resources of its own.

## Axiom Alignment

Scored per [docs/product-axioms.md](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Pure protocol refactor; UX unchanged. The `ui/initialize` handshake adds maybe 5-10ms on artefact load — negligible |
| 2 | EARNED TRUST | +1 | On-spec means our claims about the platform's interop story hold. AIPLA can credibly say "we speak MCP Apps" to external integrators (researchers, possible v1 contributors) |
| 3 | SKILLS, NOT FEATURES | 0 | Plumbing, not skills |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model in this path |
| 5 | GRACEFUL DEGRADATION | 0 | Same robustness as today (origin gate vs window-identity gate; both reject bad events) |
| 6 | PROTOCOL OVER CUSTOM | +2 (effective) | This is *the* axiom this design serves. Moving from rolled-our-own to MCP Apps spec is the cleanest possible alignment with axiom #6. Scored +1 in the table to stay within the +1/0/-1 convention, but flagged here because the second-order benefits (upstream contribution, downstream-fork ergonomics, security review surface) compound |
| 6 | (canonical score) | +1 | (per scoring convention) |
| 7 | API FIRST | 0 | Wire change; no API surface change |
| 8 | OBSERVABLE BY DEFAULT | +1 | JSON-RPC envelopes are easier to log, dump, and reason about than raw postMessage. The `aiplatform sessions iframe-context` CLI dump already shows the structuredContent payload — that part doesn't change, but if we ever instrument the iframe ↔ host bridge, JSON-RPC is the better target |
| 9 | SECURE BY CONSTRUCTION | +1 | Origin-based auth via the sandbox-proxy is the spec's recommended pattern; security review of v1 artefacts maps directly to spec §Sandbox proxy. The current window-identity workaround is fine but requires explaining "why we deviated"; spec-compliance removes that conversation entirely |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Wire goes from custom → standard. Other implementations of MCP Apps can now interoperate with AIPLA artefacts without translation |
| | **Net Score** | **+5** | Threshold >= +4 OK |

**Conflict Justifications:** None. No -1 scores.

## Standards Compliance Check

This design IS the standards-compliance check. The single sentence that matters:

> AIPLA's static-artefact path will, after this design lands, conform to the MCP Apps spec §Communication Protocol (JSON-RPC 2.0 over postMessage), §Sandbox proxy (host wraps View via a same-origin proxy layer), and §Standard MCP Messages (`ui/initialize`, `ui/update-model-context`, `ping`).

## Design

### Wire shape — before / after

**Before** (current Boldkast — off-spec, raw postMessage):

```js
parent.postMessage(
  { source: "boldkast", type: "boldkast.show_value", marker: "y_max", revealed: true },
  "*"
);
```

**After** (spec-compliant JSON-RPC notification):

```js
parent.postMessage(
  {
    jsonrpc: "2.0",
    method: "ui/update-model-context",
    params: {
      structuredContent: {
        kind: "boldkast.show_value",
        marker: "y_max",
        revealed: true,
        v0, theta, g, revealedMarkers, lastPreset
      }
    }
  },
  "*"
);
```

Note: the spec's `ui/update-model-context` is a notification (no `id`, no response). The artefact-specific event vocabulary (`boldkast.show_value`, etc.) moves into the `structuredContent.kind` field — same agent-side semantics, just under a spec-compliant envelope.

### Handshake — `ui/initialize`

The artefact MUST send `ui/initialize` before any other message (spec line 485):

```js
let nextId = 1;
function rpcRequest(method, params) {
  const id = nextId++;
  parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  return new Promise((resolve, reject) => {
    const listener = (e) => {
      if (e.data?.id === id) {
        window.removeEventListener("message", listener);
        if (e.data.result) resolve(e.data.result);
        else reject(new Error(e.data.error?.message || "rpc error"));
      }
    };
    window.addEventListener("message", listener);
  });
}

// On artefact load
const initResult = await rpcRequest("ui/initialize", {
  protocolVersion: "2026-01-26",
  capabilities: {},
  clientInfo: { name: "boldkast", version: "1.0.0" }
});
// initResult carries hostContext.theme, hostContext.displayMode, etc. —
// can be used to colour the artefact's UI in light/dark mode.

parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
```

Total cost in bytes for the spec-compliant rewrite: ~30 lines of inline JS (`rpcRequest` + `rpcNotify` + `rpcOnNotification` helpers). The current Boldkast `emit()` helper is 8 lines. Net delta: ~22 lines = ~600 bytes. **Comfortably inside ADR-013's 200 KB ceiling.** The original byte-budget concern was wrong.

### Sandbox-proxy architecture

The spec mandates that the Host wraps the View in a Sandbox proxy at a different origin (spec §Sandbox proxy, lines 470–487):

```
Host page (chat at localhost:3456)
   └── iframe @ localhost:3457/sandbox-static.html
         (sandbox="allow-scripts allow-same-origin")
         ├── Has a real origin (NOT opaque — solves the gotcha)
         ├── Enforces CSP per the artefact's _meta.ui metadata
         ├── Runs the ui/initialize handshake on behalf of the View
         ├── Proxies JSON-RPC postMessages between Host and View
         └── Inner iframe @ localhost:3457/artefacts/boldkast/v1/index.html
               (the actual artefact — sandbox="allow-scripts allow-same-origin")
```

This is the architecture `@mcp-ui/client`'s AppRenderer uses internally for agent-summoned UIs. The migration:

1. **Add a "static-artefact mode" to `infrastructure/mcp-sandbox/`.** A new `sandbox-static.html` page that takes a `?artefact=<name>/v<n>` query param, loads the artefact HTML inside its same-origin context, and runs the spec's sandbox-proxy logic. ~80 lines of TS, mostly the JSON-RPC forwarder.
2. **Host wrapper `<StaticArtefactFrame>`.** Mount an iframe pointing at `sandbox-static.html?artefact=boldkast/v1`. Auth incoming events via `e.origin === SANDBOX_ORIGIN`. Parse JSON-RPC envelope; route `ui/update-model-context` notifications to the existing iframe-context POST handler.
3. **Artefact-side rewrite.** Boldkast's `emit()` helper becomes the JSON-RPC notification function. The handshake runs on script load.

### Frontend

**New files:**

- `frontend/src/components/workspace/StaticArtefactFrame.tsx` — generic spec-compliant host wrapper. Props: `{ sandboxOrigin, artefactPath, onUpdateModelContext, onInitialized? }`. Mounts the sandbox-proxy iframe, handles `ui/initialize` response (returns `hostContext` per spec), filters incoming notifications by method, forwards `ui/update-model-context` payloads to the caller. ~120 lines.
- `frontend/src/hooks/useMcpAppMessages.ts` — hook variant of `StaticArtefactFrame`'s event handling. Replaces `useSandboxedIframeMessages` (the off-spec hook was deleted on 2026-05-21 when AIPLA went single-path).

**Modified files:**

- `frontend/src/components/workspace/BoldkastSimFrame.tsx` — refactored to use `StaticArtefactFrame`. Roughly halves in size; auth gate + JSON-RPC envelope parsing + handshake all move into the shared component.
- `frontend/src/app/chat/[...path]/page.tsx` — points at the new `BoldkastSimFrame` (no API change).

### Sandbox service

**New files:**

- `infrastructure/mcp-sandbox/sandbox-static.html` — the sandbox-proxy page for static artefacts. Loads the artefact HTML in its same-origin context, runs the spec's handshake, forwards JSON-RPC bidirectionally. Same security envelope (CSP, sandbox attr) as the existing `sandbox.html`.
- `infrastructure/mcp-sandbox/src/sandbox-static.ts` — the JSON-RPC forwarder logic.

**Modified files:**

- `infrastructure/mcp-sandbox/serve.ts` — register `/sandbox-static.html`; CORS / CSP for the static-artefact path.

### Artefact

**Modified files:**

- `infrastructure/mcp-sandbox/artefacts/boldkast/v1/index.html` — `emit()` rewritten to send JSON-RPC notifications. Add `ui/initialize` handshake on load. Add `ping` responder for connection health (5-line addition). Total artefact size change: ~+600 bytes.

## CLI Surface

None new. The existing `aiplatform sessions iframe-context <session_id>` already dumps the host-side `mcp_app_context.*` state regardless of which iframe ↔ host wire produced it (the host → backend POST shape is unchanged).

Two CLI commands worth scoping AFTER this design lands (filed as followups, not in scope here):

| Command | Purpose | Status |
|---|---|---|
| `aiplatform mcp-app probe <artefact>` | Run `ui/initialize` against a local sandbox; print the handshake result. Catches spec-compliance regressions at the artefact level | followup |
| `aiplatform mcp-app inspect <artefact>` | Dump the artefact's emitted JSON-RPC events under a fake host context. Replaces the "open browser, click around, hope" debug loop | followup |

## Testing Strategy

**Frontend vitest (`npm run test:run`):**

- `frontend/src/components/workspace/__tests__/StaticArtefactFrame.test.tsx` (new):
  - mounts the sandbox-proxy iframe at the expected URL
  - performs the `ui/initialize` handshake and returns `hostContext` (theme, displayMode, locale)
  - rejects messages whose `e.origin !== sandboxOrigin`
  - forwards `ui/update-model-context` notifications to the `onUpdateModelContext` callback with `structuredContent` payload
  - ignores other JSON-RPC methods until we add them
  - cleans up on unmount
- `frontend/src/hooks/__tests__/useMcpAppMessages.test.tsx` — same as the existing `useSandboxedIframeMessages.test.tsx` but for the spec-compliant path.
- Existing `frontend/src/components/workspace/__tests__/BoldkastSimFrame.test.tsx`: rewritten to use the new spec-compliant emit shape. Should still cover the same behaviours (slider debounce, marker reveal, presets, no-card on un-reveal). Count stays ~15.

**Artefact JS (manual + smoke):**

- The artefact's self-test path (`?test=1` flips `document.title` per [mcp-app-artefact skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md)) gains an assertion: the handshake completed and at least one `ui/update-model-context` notification was emitted.

**Backend pytest (`make test-fast`):**

- No changes expected. The host → backend wire is unchanged (still POST `/api/sessions/{id}/iframe-context` with `{serverId, toolName, structuredContent}`). All existing iframe-context tests stay green.

**Browser-loop smoke (deferred):** the followups.md entry from [mcp-app-iframe-harness.md](mcp-app-iframe-harness.md) becomes more urgent after this lands — automating the iframe → sandbox-proxy → host → backend chain in CI would catch the next regression in this class. Out of scope here; load-bearing follow-up.

## Migration / Rollout

**Branch strategy:**

- Land all the work on a `feature/mcp-app-spec-compliance` branch off `dev`.
- Run AIPLA's existing demo flow on the branch (LOCAL_MODE + cloud dev). Confirm Boldkast behaviour identical from the student's perspective.
- Confirm the CLI dump (`aiplatform sessions iframe-context <id>`) shows the same `mcp_app_context.boldkast.state` payload as the off-spec path.
- Confirm tests green on both halves (frontend + backend).
- Confirm AR can drive the sim through a Jutland-style scenario without noticing the wire change.
- Merge to `dev` once all the above hold. **Not before Jutland** (Wed 2026-05-27).

**Rollback:** the off-spec path was kept in tree during the branch period (we didn't delete `useSandboxedIframeMessages` or the original `BoldkastSimFrame` shape until the spec path was proven). On M-signoff 2026-05-21 we went single-path and deleted the off-spec hook — there is now exactly one way to mount an MCP-App artefact (via `StaticArtefactFrame`). Rollback at this point would mean reverting the entire sprint, not flipping a flag; that's the conscious cost of single-path discipline.

**Skill update:** [`.claude/skills/mcp-app-artefact/SKILL.md`](../../../../.claude/skills/mcp-app-artefact/SKILL.md) gets a new section at the top: "For all new artefacts, use the spec-compliant path. The off-spec path is documented below for legacy artefacts (currently only Boldkast pre-migration) and for non-proxy contexts."

## Implementation Plan

| Step | What | Where | Est |
|---|---|---|---|
| 1 | Branch + scoping | `feature/mcp-app-spec-compliance` | 0.05 d |
| 2 | Sandbox-static page + serve route | `infrastructure/mcp-sandbox/sandbox-static.html`, `src/sandbox-static.ts`, `serve.ts` | 0.4 d |
| 3 | `StaticArtefactFrame` + tests | `frontend/src/components/workspace/StaticArtefactFrame.tsx`, tests | 0.3 d |
| 4 | `useMcpAppMessages` hook + tests | `frontend/src/hooks/useMcpAppMessages.ts`, tests | 0.15 d |
| 5 | Boldkast artefact rewrite (JSON-RPC envelope + handshake + ping) | `infrastructure/mcp-sandbox/artefacts/boldkast/v1/index.html` | 0.2 d |
| 6 | `BoldkastSimFrame` refactored on the new path | `frontend/src/components/workspace/BoldkastSimFrame.tsx` + tests | 0.2 d |
| 7 | Manual verification (full flow, AR + M sign-off) | (no edits) | 0.15 d |
| 8 | Skill + design doc updates + upstream-feedback follow-up | `.claude/skills/mcp-app-artefact/SKILL.md`, this doc, upstream-feedback #30 | 0.15 d |
| | **Total** | | **~1.5 d** |

## Success Criteria

- [ ] Boldkast artefact load completes `ui/initialize` handshake successfully (verified by self-test + a unit test on the JS).
- [ ] `BoldkastSimFrame` mounts the sandbox-proxy iframe and validates `e.origin === SANDBOX_ORIGIN` (no `e.source` workaround on this path).
- [ ] Every workspace action (slider end, Vis click, preset) produces a `ui/update-model-context` notification with a valid `structuredContent` payload, parseable by the host as JSON-RPC.
- [ ] Host → backend wire unchanged — the same `mcp_app_context.boldkast.state` keys appear in session state.
- [ ] All existing AIPLA UX behaviour preserved: human-tool-use cards still appear with the same Danish labels, status transitions still fire, agent still references sim values in its replies.
- [ ] `npm run quality:check` green; `make test-fast` green.
- [ ] AR can complete a Jutland-style scenario on the branch without noticing any difference from the demo path.
- [ ] Upstream-feedback #30 updated post-merge with "AIPLA validated the spec path locally — the template's sandbox-proxy could grow a static-artefact mode following this implementation."

## Related Documents

- [mcp-app-iframe-harness.md](mcp-app-iframe-harness.md) — the off-spec harness this design migrates away from (superseded; historical narrative only)
- [boldkast-mcp-app.md](boldkast-mcp-app.md) — the artefact being migrated
- [human-tool-use-cards.md](human-tool-use-cards.md) — UX layer above the wire; unchanged by this design
- [MCP Apps spec vendored snapshot](../../../../.claude/skills/agent-protocols/references/mcp-apps-spec-2026-01-26.md) — the canonical reference; lines 411–487 (Communication Protocol + Sandbox proxy) and §Standard MCP Messages are the load-bearing sections
- [ADR-013](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd#adr-013-artefact-safety-content-review-pipeline-for-generated-html) — sandbox + CSP decision; the spec path completes ADR-013's promise rather than working around it
- Memory: [feedback-search-protocols-first](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_search_protocols_first.md) — the lesson that motivated this doc
- Upstream feedback [#28](../../../upstream-feedback.md), [#30](../../../upstream-feedback.md) — reframed to align with this design's understanding

---

## Implementation Report

**Completed**: 2026-05-21
**Actual Effort**: [e.g., 5 days vs 3 estimated]
**Branch/PR**: [link or commit range]

### What Was Built
- [Summary of actual implementation]
- [Any deviations from plan]

### Files Changed
- [New files created]
- [Modified files]

### Lessons Learned
- [What went well]
- [What could be improved]
