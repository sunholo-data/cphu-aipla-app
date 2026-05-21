# Sprint Plan: MCPAPP-SPEC — migrate Boldkast onto the MCP Apps spec path

## Summary
Move AIPLA's static-artefact iframe path from the rolled-our-own postMessage shape to MCP Apps spec JSON-RPC over postMessage, routed through the spec's sandbox-proxy architecture. Pure protocol-compliance refactor — UX behaviour stays identical from the student's perspective; the wire change is invisible above the auth layer. Six milestones, branch-only, no risk to Jutland.

**Duration:** ~1.5 day core (M1+M2+M3+M4) + ~0.4 day artefact rewrite + verify (M5+M6)
**Scope:** Frontend (host wrapper + hook) + sandbox service (new proxy mode) + artefact JS (wire envelope) + docs
**Branch:** `feature/mcp-app-spec-compliance` off `dev`. NOT merged before Jutland (Wed 2026-05-27). Demo path = `dev` (current off-spec) stays untouched.
**Risk Level:** Low for the spec migration itself (well-scoped, additive to mcp-sandbox); zero for Jutland because the branch is segregated
**Design Docs:**
- [mcp-app-iframe-spec-compliance.md](mcp-app-iframe-spec-compliance.md) — source of truth for this sprint
- [mcp-app-iframe-harness.md](mcp-app-iframe-harness.md) — the off-spec harness this migrates from (stays as defensive default)
- [MCP Apps spec vendored snapshot](../../../../.claude/skills/agent-protocols/references/mcp-apps-spec-2026-01-26.md) — load-bearing reference, especially lines 411–487 (Communication Protocol + Sandbox proxy) and §Standard MCP Messages

## Current Status

### Branch starting point (commit `b0acc9d` on `dev`)
- AIPLA off-spec path shipped: BoldkastSimFrame mounts a raw iframe at `localhost:3457/artefacts/boldkast/v1/`, listens to `{source: "boldkast", type: ..., ...}` postMessage, authenticates via `e.source === iframeRef.current.contentWindow` (window identity, since the iframe's origin is opaque under `sandbox="allow-scripts"`).
- `useSandboxedIframeMessages` hook centralises the auth/filter gate. Stays in tree after this sprint as the defensive default for non-proxy contexts (debugging, dev pages).
- Host → backend wire already on spec — POST `/api/sessions/{id}/iframe-context` with `{serverId, toolName, structuredContent}` matches MCP Apps `ui/update-model-context` params shape. This part doesn't change.
- mcp-sandbox service serves `/sandbox.html` (the AppRenderer-driven proxy for agent-summoned MCP Apps via `@mcp-ui/client`) AND `/artefacts/<name>/v<n>/` (raw static-HTML serving AIPLA added). The new sandbox-proxy mode (M1) goes alongside, not replacing either.

### What needs building (this sprint's targets)
1. A new `sandbox-static.html` page in mcp-sandbox running the spec's sandbox-proxy handshake for static artefacts (the missing "non-agent-summoned" path).
2. A `StaticArtefactFrame` host component that mounts that proxy and parses JSON-RPC envelopes.
3. A `useMcpAppMessages` hook (thin parallel to the existing `useSandboxedIframeMessages` — same auth shape, but on the spec path where origin auth works because the sandbox has same-origin).
4. Boldkast artefact rewrite: `emit()` becomes JSON-RPC notification helper, `ui/initialize` handshake on load.
5. `BoldkastSimFrame` refactored to use `StaticArtefactFrame`. Roughly halves in size.
6. AR verification + skill docs + upstream-feedback follow-up.

### What's NOT changing
- Host → backend wire (iframe-context endpoint shape, the `mcp_app_context.*` namespace, the InstructionProvider injection).
- `useHumanToolEvents` chat-card UX. Cards still dispatch on the same triggers with the same Danish labels.
- ADK session state shape; agent prompt rendering.
- `useSandboxedIframeMessages` hook (stays as defensive default for non-proxy contexts).
- `MCPAppToolCallRouter` (agent-summoned UIs continue on AppRenderer).

## Proposed Milestones

### M1: sandbox-static proxy page in mcp-sandbox (`feat(mcp-sandbox): static-artefact sandbox-proxy per MCP Apps spec`)
**Scope:** Sandbox service
**Goal:** A new `/sandbox-static.html` page on the mcp-sandbox origin runs the spec's sandbox-proxy logic for static artefacts. Receives `?artefact=<name>/v<n>` query param, loads the artefact HTML inside its same-origin context, runs the `ui/initialize` handshake on the artefact's behalf (or proxies the artefact's own handshake), forwards JSON-RPC postMessages bidirectionally between Host and View. Same CSP envelope as existing `/sandbox.html`.
**Estimated:** ~120 LOC TS + ~40 LOC HTML + ~30 LOC test = ~190 LOC
**Duration:** ~0.4 d

**Tasks:**
- [ ] Read existing `infrastructure/mcp-sandbox/sandbox.html` + `src/sandbox.ts` (the AppRenderer-driven proxy) for pattern reference. Note CSP, sandbox attributes, JSON-RPC forwarding logic.
- [ ] New `infrastructure/mcp-sandbox/sandbox-static.html`: the proxy shell. Loads the artefact HTML in an inner iframe with `sandbox="allow-scripts allow-same-origin"` (so the artefact can run its handshake; the proxy enforces CSP via `csp` attr).
- [ ] New `infrastructure/mcp-sandbox/src/sandbox-static.ts`: bundle entry. Wires window.parent (host) ↔ inner iframe (artefact) postMessage forwarding. Strips/translates `ui/notifications/sandbox-*` per spec line 486. Sends `ui/notifications/sandbox-proxy-ready` to host on script load; awaits `ui/notifications/sandbox-resource-ready` then loads the artefact.
- [ ] Update `infrastructure/mcp-sandbox/serve.ts` — register `/sandbox-static.html` with the right CSP headers; CORS for the chat origin (`http://localhost:3456` + the Cloud Run domain).
- [ ] Update `infrastructure/mcp-sandbox/package.json` build scripts — `build:script` esbuild step for `sandbox-static.ts` alongside the existing one.
- [ ] Unit test: dispatch a synthetic `ui/initialize` request at the proxy; assert it forwards to the inner iframe and bubbles the response back. (jsdom + mock inner iframe — keep it pure.)
- [ ] Manual: hit `http://localhost:3457/sandbox-static.html?artefact=boldkast/v1` in a browser. Confirm the artefact loads. Confirm console shows the handshake notifications. (No AIPLA host integration yet — that's M3.)

**Files to Create/Modify:**
- `infrastructure/mcp-sandbox/sandbox-static.html` (new, ~40 LOC)
- `infrastructure/mcp-sandbox/src/sandbox-static.ts` (new, ~120 LOC)
- `infrastructure/mcp-sandbox/serve.ts` (modify, +15 LOC)
- `infrastructure/mcp-sandbox/package.json` (modify, +2 LOC build script)
- `infrastructure/mcp-sandbox/tests/sandbox-static.test.ts` (new, ~50 LOC) — only if there's already a tests/ dir in mcp-sandbox; otherwise skip and rely on the StaticArtefactFrame tests in M2 to catch regressions through the host

**Acceptance Criteria:**
- [ ] `curl -I http://localhost:3457/sandbox-static.html` returns 200 with CSP headers per ADR-013.
- [ ] Browser smoke (manual): load the URL, see the artefact, no console errors, handshake messages logged on dev-mode console.
- [ ] esbuild build succeeds in CI for the new entry.

**Risks:**
- The spec's sandbox-proxy section is dense; my implementation might miss a corner case (e.g. handling of `ui/notifications/sandbox-resource-ready` ordering vs `ui/initialize` from the view). Mitigation: re-read spec §Sandbox proxy lines 470-487 against the implementation; cross-check with `@mcp-ui/client`'s sandbox.ts in the existing `sandbox.html` flow.
- CSP for the new page might conflict with the artefact's needs. Mitigation: reuse the existing `sandbox.html` CSP defaults; only widen on real failure.

---

### M2: `StaticArtefactFrame` host component + `useMcpAppMessages` hook (`feat(workspace): spec-compliant host component for static MCP-App artefacts`)
**Scope:** Frontend
**Goal:** A generic host wrapper that mounts the sandbox-proxy iframe, performs the `ui/initialize` handshake (responds with `McpUiInitializeResult` + hostContext), filters incoming notifications, and routes `ui/update-model-context` payloads to a caller-supplied callback. Symmetrical to existing components but on the spec path. Authentication is origin-based (`e.origin === SANDBOX_ORIGIN`) — works cleanly because the sandbox-proxy has a real origin.
**Estimated:** ~120 LOC component + ~80 LOC hook + ~150 LOC test = ~350 LOC
**Duration:** ~0.45 d

**Tasks:**
- [ ] New `frontend/src/components/workspace/StaticArtefactFrame.tsx`:
  - Props: `{ sandboxOrigin: string; artefactPath: string; onUpdateModelContext: (structuredContent: object) => void; onInitialized?: (clientInfo: ClientInfo) => void; hostContext?: HostContext }`
  - Mounts iframe at `${sandboxOrigin}/sandbox-static.html?artefact=${artefactPath}` with `sandbox="allow-scripts allow-same-origin"` (NOT `allow-scripts` only — the inner sandbox-proxy needs same-origin to bridge; the spec is explicit at line 475)
  - Listens for `e.origin === sandboxOrigin` messages
  - Parses JSON-RPC envelope (`jsonrpc: "2.0"`, validates `method`)
  - Responds to `ui/initialize` request with `McpUiInitializeResult` including `hostContext` (theme, displayMode, locale from props or defaults)
  - Routes `ui/update-model-context` notifications to the `onUpdateModelContext` callback with the `params.structuredContent` payload
  - Logs un-handled methods in dev mode but doesn't crash
  - Cleans up on unmount
- [ ] New `frontend/src/hooks/useMcpAppMessages.ts`:
  - Same signature shape as `useSandboxedIframeMessages` for consistency (`{ iframeRef, sourceMarker, onMessage }`) but listens for JSON-RPC envelopes with `method === sourceMarker` (e.g. `"ui/update-model-context"`)
  - Origin-based auth (`e.origin === sandboxOrigin` if provided; else falls back to `e.source` identity)
  - Calls `onMessage(params)` — same notification-callback shape as the spec
  - Returns a `sendNotification` and `sendRequest` pair the caller can use to push host → view messages (we don't use these for Boldkast yet, but the API should be there for v1 sims that need bidirectional flows)
- [ ] New `frontend/src/components/workspace/__tests__/StaticArtefactFrame.test.tsx`:
  - mounts iframe at the expected URL with the right sandbox attrs
  - completes the `ui/initialize` handshake (synthetic incoming request → assert outgoing response shape)
  - rejects messages whose `e.origin` differs from `sandboxOrigin`
  - forwards `ui/update-model-context` notifications to `onUpdateModelContext` with the `structuredContent` payload
  - ignores unrelated JSON-RPC methods (e.g. `tools/call`)
  - cleans up listeners on unmount
- [ ] New `frontend/src/hooks/__tests__/useMcpAppMessages.test.tsx`: mirrors the existing `useSandboxedIframeMessages` test suite but for JSON-RPC shapes. Same 8-9 tests, same coverage of reject cases.

**Files to Create/Modify:**
- `frontend/src/components/workspace/StaticArtefactFrame.tsx` (new, ~120 LOC)
- `frontend/src/hooks/useMcpAppMessages.ts` (new, ~80 LOC)
- `frontend/src/components/workspace/__tests__/StaticArtefactFrame.test.tsx` (new, ~150 LOC)
- `frontend/src/hooks/__tests__/useMcpAppMessages.test.tsx` (new, ~120 LOC)

**Acceptance Criteria:**
- [ ] `npm run test:run -- StaticArtefactFrame useMcpAppMessages` green.
- [ ] `npm run quality:check` green.
- [ ] No emoji introduced (`grep -E "[👤🤖✓⏳]"` returns nothing in the new files).

**Risks:**
- The `ui/initialize` handshake's `hostContext` payload has a lot of optional fields (theme, styles, displayMode, locale, timezone, etc per spec lines 531-578). For v1 of this component we pass through what the chat page already knows (locale, theme) and leave the rest as defaults. Mitigation: defaults are spec-compliant ("Hosts can provide any subset" per spec line 893); if Boldkast needs more it'll surface in M5.
- React strict-mode could double-invoke the iframe mount + handshake. Mitigation: handshake is idempotent (artefact sends `ui/initialize`; host responds; second sends are ignored because the artefact already got its response).

---

### M3: Boldkast artefact rewritten for spec-compliant wire (`feat(boldkast): emit MCP Apps JSON-RPC; ui/initialize handshake on load`)
**Scope:** Artefact JS
**Goal:** Boldkast's `emit()` helper rewrites to send JSON-RPC notifications (`ui/update-model-context` with `structuredContent` carrying the same payload shape under a `kind` field). Add ~30 lines of vanilla-JS JSON-RPC helpers (request/notification/onNotification) per spec line 428-458. Run `ui/initialize` handshake on artefact load, capturing `hostContext` for theming.
**Estimated:** ~50 LOC delta in index.html + ~20 LOC of new JSON-RPC helpers + ~10 LOC self-test update = ~80 LOC
**Duration:** ~0.25 d

**Tasks:**
- [ ] Read existing `infrastructure/mcp-sandbox/artefacts/boldkast/v1/index.html`. Locate `emit()` (~line 590-600) and the event-wiring block (~line 600-700).
- [ ] Add JSON-RPC helpers at the top of the inline `<script>`:
  ```js
  let __nextId = 1;
  function rpcRequest(method, params) {
    const id = __nextId++;
    parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    return new Promise((resolve, reject) => {
      const listener = (e) => {
        if (e.data?.id === id) {
          window.removeEventListener("message", listener);
          if (e.data.result !== undefined) resolve(e.data.result);
          else reject(new Error(e.data.error?.message || "rpc error"));
        }
      };
      window.addEventListener("message", listener);
    });
  }
  function rpcNotify(method, params) {
    parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }
  ```
- [ ] Replace existing `emit(type, extra)` with `emit(kind, extra)` that calls `rpcNotify("ui/update-model-context", { structuredContent: { kind, ...extra } })`. Same payload shape, on-spec envelope.
- [ ] On script-load (`DOMContentLoaded`), perform handshake:
  ```js
  rpcRequest("ui/initialize", {
    protocolVersion: "2026-01-26",
    capabilities: {},
    clientInfo: { name: "boldkast", version: "1.0.0" }
  }).then((result) => {
    // result.hostContext.theme === "light" | "dark"
    // result.hostContext.displayMode etc.
    // For v1, store for later theming. Boldkast already uses light-theme defaults.
  });
  rpcNotify("ui/notifications/initialized", {});
  ```
- [ ] Add `ping` handler (5 lines per spec — required by line 508):
  ```js
  window.addEventListener("message", (e) => {
    if (e.data?.method === "ping" && e.data.id !== undefined) {
      parent.postMessage({ jsonrpc: "2.0", id: e.data.id, result: {} }, "*");
    }
  });
  ```
- [ ] Update the artefact's self-test (`?test=1` path) to assert the handshake completed and at least one `ui/update-model-context` notification was emitted. Existing `document.title` flip stays.
- [ ] Manual: load `http://localhost:3457/artefacts/boldkast/v1/index.html?test=1` in browser DevTools, watch the Network/Console for the JSON-RPC envelope shape.

**Files to Create/Modify:**
- `infrastructure/mcp-sandbox/artefacts/boldkast/v1/index.html` (modify, ~+80 LOC net)

**Acceptance Criteria:**
- [ ] `?test=1` self-test passes (`document.title` becomes "TEST PASS").
- [ ] DevTools console shows the `ui/initialize` request, handshake response, and at least one `ui/update-model-context` notification on every meaningful student interaction.
- [ ] Artefact size still under ADR-013's 200 KB ceiling (`wc -c index.html` < 200000).

**Risks:**
- The handshake might race the first user-driven `emit` call (artefact tries to send `ui/update-model-context` before `ui/notifications/initialized` is sent — spec line 485 says Host MUST NOT send to View before initialized, but is silent on View → Host pre-init ordering). Mitigation: queue user events until `initializedPromise` resolves, then flush. Adds ~10 LOC of buffering.
- Some browsers serialize postMessage payloads differently (structured clone) — the JSON-RPC envelope might survive the boundary differently than I expect. Mitigation: vitest covers this; manual smoke covers the live path.

---

### M4: `BoldkastSimFrame` refactored to use `StaticArtefactFrame` (`refactor(boldkast): host wrapper consumes spec-compliant frame component`)
**Scope:** Frontend
**Goal:** `BoldkastSimFrame` becomes a thin wrapper around `<StaticArtefactFrame>`. The boldkast-specific logic (event vocabulary → snapshot → push + card dispatch) moves into the `onUpdateModelContext` callback. Roughly halves the file: auth gate, type-filter, listener cleanup all move into the shared component.
**Estimated:** ~70 LOC delta (mostly deletion) + ~30 LOC test update = ~100 LOC net
**Duration:** ~0.2 d

**Tasks:**
- [ ] Modify [BoldkastSimFrame.tsx](../../../../frontend/src/components/workspace/BoldkastSimFrame.tsx):
  - Replace the iframe + `useSandboxedIframeMessages` + manual onMessage with `<StaticArtefactFrame sandboxOrigin={...} artefactPath="boldkast/v1" onUpdateModelContext={handleStructuredContent}>`
  - `handleStructuredContent({ kind, marker, revealed, param, value, triggeredBy })` is the existing event-routing logic — pattern-match on `kind` (which is the `type` field from the old wire shape, just relocated to inside `structuredContent`)
  - Slider debounce, snapshot accumulation, push-with-card / silent-push, catch-up effect — all unchanged
- [ ] Update [BoldkastSimFrame.test.tsx](../../../../frontend/src/components/workspace/__tests__/BoldkastSimFrame.test.tsx):
  - The `emit()` helper in the test file goes from raw postMessage to JSON-RPC envelope: `{ jsonrpc: "2.0", method: "ui/update-model-context", params: { structuredContent: { kind, ...payload } } }`
  - Origin in synthetic events is now `SANDBOX_ORIGIN` (the proxy's origin, set in the test as a constant)
  - All 14 existing tests stay green — they cover the SAME behaviours (debounce, marker reveal, presets, no-card on un-reveal, etc.). The wire shape change is invisible to the user-facing behaviour.

**Files to Create/Modify:**
- `frontend/src/components/workspace/BoldkastSimFrame.tsx` (modify, ~70 LOC delta — net reduction)
- `frontend/src/components/workspace/__tests__/BoldkastSimFrame.test.tsx` (modify, +30 LOC for the emit-shape change)

**Acceptance Criteria:**
- [ ] `npm run test:run -- BoldkastSimFrame` green; same 14 tests.
- [ ] `npm run quality:check` green.
- [ ] Manual: open chat in LOCAL_MODE, open Boldkast sim, drag sliders, click Vis, click presets. All cards still appear with the same Danish labels and status transitions. Backend log still shows `server=boldkast` writes with the same `structuredContent` payload.
- [ ] `aiplatform sessions iframe-context <session_id>` dumps the same `mcp_app_context.boldkast.state` shape as the off-spec path.

**Risks:**
- The `kind` field repositioning (was `type` at the envelope level, now nested in `structuredContent`) is the one user-visible change in the host → backend state. If anything downstream consumes the old shape, we'd see it. Mitigation: agent prompt reads via InstructionProvider which uses the raw `structuredContent` dict — no field-name assumptions there. Greppable: `mcp_app_context.boldkast.state` usages should be empty.

---

### M5: AR sign-off + manual demo scenario on the branch (`smoke: spec path matches off-spec path end-to-end`)
**Scope:** Manual verification
**Goal:** Run a full Jutland-style demo scenario on the branch. Compare student-facing behaviour against the `dev` branch. Zero observable difference. AR signs off.
**Estimated:** ~0.15 d (depends on AR availability)
**Duration:** ~0.15 d

**Tasks:**
- [ ] Stop / start local stack on the branch: `make dev-stop && make dev-local`.
- [ ] Confirm `make dev-local` reseeds the local fixture from current SKILL.md (no stale state from dev branch).
- [ ] Walk through the demo scenario:
  - Join group with `local-demo`
  - Land on problem-set-hints chat
  - Open Boldkast sim
  - Drag v₀ to 15, θ to 40, leave g at 9.82 (Earth default)
  - Click Vis on y_max
  - Tick checklist item a)
  - Ask agent "are my values close to correct? what about y_max?"
  - Confirm agent references the values by name in its reply
- [ ] Cross-check backend log: `grep server=boldkast .dev-logs/backend.log | tail -5` should show 4-5 writes during the scenario.
- [ ] Run `aiplatform sessions iframe-context <session_id>` — should show the same payload shape as on `dev`.
- [ ] If AR is available: walk through the scenario together. AR perspective is the canonical "is this what a teacher demo looks like?" check.

**Acceptance Criteria:**
- [ ] Scenario completes without console errors in the browser.
- [ ] Backend log shows the same `server=boldkast` write count as a matching scenario on `dev`.
- [ ] Agent reply references the sim values (qualitatively same quality as off-spec path — sign of the InstructionProvider getting the same payload).
- [ ] No regressions in: card timing, card status transitions, card labels, slider debounce timing, mobile-tab swap.
- [ ] AR sign-off (or M sign-off in AR's absence).

**Risks:**
- Subtle protocol drift (e.g. handshake taking longer than expected, first event arriving after the first chat turn) might show up only in live testing. Mitigation: M5 is the gate before merge; if it fails the branch stays on the shelf.

---

### M6: Docs + upstream-feedback follow-up (`docs: update skill + upstream-feedback after spec path validated`)
**Scope:** Docs
**Goal:** Once M5 passes, update the mcp-app-artefact skill to recommend the spec path for new artefacts, refresh the design doc with "shipped" status, and update upstream-feedback #30 to point at the validated implementation as the contribution shape.
**Estimated:** ~0.1 d
**Duration:** ~0.1 d

**Tasks:**
- [ ] Update `.claude/skills/mcp-app-artefact/SKILL.md`:
  - New section at the top: "Spec-compliant path (recommended)" — describes `<StaticArtefactFrame>` + `useMcpAppMessages` + the artefact's JSON-RPC envelope. Cross-links the design doc.
  - Mark the existing `useSandboxedIframeMessages` path as "Defensive fallback path" — kept for non-proxy contexts (debugging, dev pages, downstream forks that can't run the proxy).
- [ ] Update [mcp-app-iframe-spec-compliance.md](mcp-app-iframe-spec-compliance.md) — flip `**Status**: Planned` to `**Status**: Implemented (branch feature/mcp-app-spec-compliance, merged 2026-MM-DD)`.
- [ ] Update [docs/upstream-feedback.md](../../../upstream-feedback.md) #30:
  - Add a section "Status: validated locally" with the commit SHA.
  - Refine the upstream proposal: "AIPLA's branch shows the static-artefact proxy mode works as ~190 LOC in the sandbox service + ~120 LOC `StaticArtefactFrame` + ~30 LOC JSON-RPC helpers in the artefact JS. Total: ~340 LOC of new framework code, no spec deviations. Recommend the template adopts this shape."
  - Cross-reference the implementation files for the upstream PR series.
- [ ] Update [SEQUENCE.md](SEQUENCE.md) row 0.7 — mark this sprint complete in the timeline table.

**Files to Create/Modify:**
- `.claude/skills/mcp-app-artefact/SKILL.md` (modify, ~+60 LOC for the new section)
- `docs/design/aipla/v0.1.0-jutland/mcp-app-iframe-spec-compliance.md` (modify, status flip)
- `docs/upstream-feedback.md` (modify, ~+30 LOC for #30 update)
- `docs/design/aipla/v0.1.0-jutland/SEQUENCE.md` (modify, row 0.7 status mark)

**Acceptance Criteria:**
- [ ] Skill update reads as "use the spec path; here's the off-spec one for legacy" — not the other way around.
- [ ] Upstream-feedback #30 is concrete enough to file as a GitHub issue / PR against `sunholo-data/ai-protocol-platform` without further authoring.

**Risks:**
- None — pure docs.

---

## Dependency Graph

```
M1 sandbox-proxy page ─── (must exist before host can connect)
        │
        ▼
M2 StaticArtefactFrame + useMcpAppMessages + tests ──┐
                                                     │
                                                     ▼
M3 Boldkast JSON-RPC rewrite (parallel-safe with M2) │
                                                     │
                                                     ▼
M4 BoldkastSimFrame refactor (depends on M2 + M3)    │
                                                     │
                                                     ▼
M5 Manual + AR sign-off ─────────────────────────────┤
                                                     │
                                                     ▼
                                                M6 Docs + upstream follow-up
                                                     │
                                                     ▼
                                              Merge to dev
```

M2 and M3 can land in parallel (different code paths). M4 needs both. M5 and M6 are sequential.

## Day plan — post-Jutland buffer (likely Mon 2026-06-01 → Tue 2026-06-02)

**Day 1:** M1 (sandbox proxy) ~0.4 d + M2 (host component + hook) ~0.45 d + start M3 (artefact rewrite) ~0.15 d. EOD: spec-compliant mcp-sandbox proxy is up; host component renders; artefact wire envelope started. Total ~1 d.

**Day 2:** Finish M3 (~0.1 d) + M4 (refactor) ~0.2 d + M5 (manual) ~0.15 d + M6 (docs) ~0.1 d. EOD: branch ready for merge. Total ~0.55 d.

If AR isn't available for M5 on Day 2, hold the branch in `feature/mcp-app-spec-compliance` until they are. The branch costs nothing to hold; merging without AR sign-off costs UX-regression risk.

## What ships at the end of this sprint

- AIPLA's static-artefact iframe path is on the MCP Apps spec at the iframe ↔ host wire AND at the sandbox-proxy architecture.
- The off-spec `useSandboxedIframeMessages` hook stays in tree as a defensive default for non-proxy contexts.
- `StaticArtefactFrame` + `useMcpAppMessages` are the recommended path for any new static artefact (energy sim, friction sim, etc.).
- mcp-app-artefact skill points at the new path; old path documented as legacy.
- Upstream-feedback #30 gets a "validated locally" addendum with concrete implementation pointers for an upstream PR.

## What does NOT ship

- AppRenderer adoption — that's the agent-summoned-UI path, not the static-artefact path. Untouched here.
- Tool calls or resource reads from the artefact (`tools/call`, `resources/read`) — Boldkast doesn't need these.
- Host → artefact push (`ui/notifications/tool-input`, etc.) — agent doesn't drive Boldkast.
- Browser-loop smoke (Chrome DevTools MCP) — followups.md candidate; the spec-compliance refactor doesn't change the need for that smoke (still recommended post-sprint).
- Multi-artefact testing — Boldkast is the only AIPLA artefact; the second one (whenever it lands) will validate the genericity of `StaticArtefactFrame`.

## Out of scope for this sprint

- Any change to AppRenderer / `MCPAppToolCallRouter` / agent-summoned MCP App rendering. They already speak the spec via `@mcp-ui/client`.
- Any change to the host → backend wire (`/api/sessions/{id}/iframe-context`). Already on-spec at the `{structuredContent}` shape; doesn't need touching.
- Any change to ADK session state / InstructionProvider rendering. The agent's prompt build doesn't see the wire change.
- ADR-013 update — pending separate scoping-site commit on the cphu-uni Quarto repo. Filed as a separate work item.

## Related Documents

- [mcp-app-iframe-spec-compliance.md](mcp-app-iframe-spec-compliance.md) — design source
- [mcp-app-iframe-harness.md](mcp-app-iframe-harness.md) — off-spec harness (defensive default stays)
- [boldkast-mcp-app.md](boldkast-mcp-app.md) — the artefact being migrated
- [SEQUENCE.md](SEQUENCE.md) — sprint 0.7 row
- [MCP Apps spec vendored snapshot](../../../../.claude/skills/agent-protocols/references/mcp-apps-spec-2026-01-26.md) — §Communication Protocol (lines 411–467), §Sandbox proxy (lines 470–487), §Standard MCP Messages (lines 489–509)
- [docs/upstream-feedback.md](../../../upstream-feedback.md) — entries #28 + #30
- Memory: [feedback-search-protocols-first](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_search_protocols_first.md)
- Memory: [feedback-self-testable-loops](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_self_testable_loops.md) — every milestone has acceptance criteria that don't require M to manually verify
