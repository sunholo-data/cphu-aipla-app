# MCP App iframe-message harness — historical (superseded 2026-05-21)

> **SUPERSEDED — read [mcp-app-iframe-spec-compliance.md](mcp-app-iframe-spec-compliance.md) instead.**
>
> This design shipped (2026-05-21 morning) as a defensive off-spec
> harness around `useSandboxedIframeMessages` with window-identity
> auth. Same-day deeper protocol research surfaced that the MCP Apps
> spec covers this case directly via the sandbox-proxy architecture
> (lines 470–487 of the vendored spec snapshot). The spec-compliance
> migration shipped that evening (sprint MCPAPP-SPEC) and AIPLA went
> single-path — the `useSandboxedIframeMessages` hook + this entire
> harness shape were deleted. The on-spec path uses
> `StaticArtefactFrame` (host) + sandbox.html (proxy) + vanilla
> JSON-RPC helpers (artefact-side).
>
> This document is retained for the **historical narrative**: how the
> incident played out, what we learned (the lesson saved in
> [feedback-search-protocols-first](../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_search_protocols_first.md)),
> and what shape future code-archaeology will find when grepping for
> `useSandboxedIframeMessages` in `git log`. It is NOT the current
> guidance — do not implement against it.

**Status**: Superseded by [mcp-app-iframe-spec-compliance.md](mcp-app-iframe-spec-compliance.md) (2026-05-21)
**Original priority**: P1
**Original scope**: Frontend (shared hook) + docs
**Created**: 2026-05-21
**Last Updated**: 2026-05-21 (superseded same day)

## What "standard way" means here

When a new MCP-App iframe artefact ships (energy sim, friction sim, free-body diagram, physics game, etc.), the author should be able to **import three things and have it work**:

1. **`useSandboxedIframeMessages`** — receive authenticated, type-filtered events from the iframe. Handles ADR-013's opaque-origin gotcha (see Problem Statement below).
2. **`useHumanToolEvents.dispatch(...)`** — surface a Danish-labelled chip in the chat at the moment the student interacts with the iframe (already shipped in [human-tool-use-cards.md](human-tool-use-cards.md), `3563af1`).
3. **A per-artefact label function** — maps the artefact's event shape to a human label. Stays artefact-specific (each sim has its own vocabulary); just three or four small functions per wrapper.

Together those three give the wrapper component a ~30-line shape regardless of which sim it's wrapping. The auth gate is audited once, the chat-card UX is consistent, and the labels are the only thing the new author has to write.

## Problem Statement

[BoldkastSimFrame.tsx](../../../../frontend/src/components/workspace/BoldkastSimFrame.tsx) is the first AIPLA artefact to take the ADR-013 "sandboxed iframe" path: `sandbox="allow-scripts"`, no `allow-same-origin`. That security choice has a non-obvious consequence the original ADR-013 didn't call out:

- A sandboxed iframe without `allow-same-origin` has an **opaque** origin per HTML living standard §browsers.opaque-origins.
- Its `postMessage` events arrive at the host with `e.origin === "null"`.
- So an authentication check of the shape `if (e.origin !== expectedOrigin) return;` rejects every legitimate event silently.

Live evidence (2026-05-21): M tested the sim's sliders and "Vis" buttons in browser. The backend's `iframe-context` log over the entire session had **zero** `server=boldkast` writes — the host's onMessage handler rejected every iframe postMessage at the origin gate. M only noticed because the agent's reply said "I cannot see your screen". Without the live cross-check the bug would have shipped to the Jutland demo.

The bug was fixed in `3563af1` by replacing the origin check with `e.source === iframeRef.current.contentWindow` (window-identity auth — works for opaque-origin iframes, and is the pattern the HTML spec actually recommends for this case). But the fix lives inside BoldkastSimFrame. **Every future MCP App that follows the same sandbox profile (Strand A v1: energy sim, friction sim, free-body diagrams; Strand B: games) will write its own listener and the next author will hit the same trap unless they happen to read the comment in BoldkastSimFrame.tsx.**

This is the "incremental special-casing" anti-pattern from the design-doc skill. We caught it on the first artefact; fix the pattern before the second.

**Current state:**
- One artefact (Boldkast) with the right auth, in-line.
- ADR-013's "Consequences" section doesn't mention this — the original ADR focused on the threat model (script injection, top-nav, cookie access) and didn't trace through to "how do you receive events from this thing".
- No browser-loop smoke. The 2026-05-21 backend smoke `scripts/smoke-workspace-context.sh` exercises bootstrap → iframe-context → state, but it skips the iframe → host → backend chain — the very chain that broke.
- No shared abstraction. AR's next sim would start from a copy of BoldkastSimFrame, which is fine if the copy is faithful and the original is right (now it is), but encourages drift.

**Impact (if not built):**
- Each future MCP App author re-decides the auth strategy and risks re-introducing the origin-based check (especially if they reach for a generic "iframe postMessage" tutorial — most of which document origin-based auth because most iframes have a real origin).
- ADR-013 stays subtly incomplete; the next person reading it for security review doesn't see the auth follow-through.
- The smoke chain doesn't cover this class of bug, so the *next* regression in the iframe → host pipeline gets caught by a teacher in a classroom rather than by CI.

## Goals

**Primary Goal:** A new MCP App artefact ships with correct sandbox-aware iframe-message auth without the author having to know the gotcha. They import one hook, mount an iframe with a ref, pass a type-marker string, and get correctly-authenticated typed events. The auth gate is enforced in one place, audited once.

**Success Metrics:**
- BoldkastSimFrame consumes the hook and is **shorter** than today (the auth/filter logic moves out).
- A second MCP App can be written without copy-pasting BoldkastSimFrame — concretely, the [boldkast-mcp-app.md](boldkast-mcp-app.md) "Why hand-coded HTML" rationale applies to the iframe contents, but the host wrapper around the iframe is a 30-line component using the hook.
- The hook has unit tests covering: legitimate event passes, wrong-source event rejected, payload-shape mismatch rejected, listener cleaned up on unmount.
- ADR-013's "Consequences" section in [architecture.qmd](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd#adr-013-artefact-safety-content-review-pipeline-for-generated-html) gains a sub-bullet documenting "Authentication: window-identity not origin" with a one-line rationale.
- A new entry in [followups.md](followups.md) for the browser-loop smoke (deferred — see Out of Scope).

**Non-Goals:**
- Browser-loop smoke (Chrome-DevTools-MCP-driven end-to-end test of the sim → backend chain). Discussed below as a v1 follow-up, not blocking — the unit tests + one in-product manual check cover the risk for v0.1.
- Rewriting BoldkastSimFrame's iframe-internal contract (the `boldkast.show_value` / `boldkast.param.change` event names stay).
- Bidirectional channel (host → iframe). Today's pattern is iframe → host only; we'll cross that bridge if a future sim needs it.
- A generic MCP App framework. Scope is the host-side message-listener pattern, not a whole authoring SDK.

## Axiom Alignment

Scored per [docs/product-axioms.md](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | UX-neutral — pure refactor + docs |
| 2 | EARNED TRUST | +1 | Closes a silent-failure class. The 2026-05-21 incident was the agent claiming it couldn't see student state when the auth gate was eating events — that's exactly the kind of opaque failure that erodes trust |
| 3 | SKILLS, NOT FEATURES | 0 | Plumbing change; doesn't move skills forward |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model in this path |
| 5 | GRACEFUL DEGRADATION | +1 | The hook's dev-mode console logging surfaces when payload-shape filters reject events — gives future authors a debug signal the original implementation didn't have |
| 6 | PROTOCOL OVER CUSTOM | +1 | Uses the HTML living standard's `e.source` window-identity pattern (the spec's recommended approach for sandboxed iframes), not a custom token-exchange or postMessage-channel handshake |
| 7 | API FIRST | 0 | Frontend-only concern; nothing to expose via CLI |
| 8 | OBSERVABLE BY DEFAULT | +1 | The hook centralises the dev-mode console.log for received events. Future authors get diagnostics without writing their own; reduces "is it firing?" cycles |
| 9 | SECURE BY CONSTRUCTION | +1 | Each MCP App previously did its own auth. After this, the auth gate is one audited location. ADR-013 update writes down the rationale so security review of v1 artefacts has a doc to point at |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Client-side refactor; wire format unchanged |
| | **Net Score** | **+5** | Threshold >= +4 OK |

**Conflict Justifications:** None. No -1 scores.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| Sandboxed iframe auth | HTML Living Standard, `postMessage` MessageEvent `source` field | Hook uses `e.source === iframeRef.current.contentWindow` per spec. No bespoke token-exchange |
| iframe sandbox attributes | ADR-013 `sandbox="allow-scripts"` profile | Unchanged — this design is the auth path that survives that sandbox profile |
| TypeScript event typing | React's `RefObject<HTMLIFrameElement>` + generic payload type parameter | Standard React idioms, no DSL |

**No custom protocols introduced.** The hook is a thin wrapper around `window.addEventListener("message", ...)` with the correct auth gate baked in.

## Design

### `useSandboxedIframeMessages` hook

**Location:** `frontend/src/hooks/useSandboxedIframeMessages.ts`

**Signature (sketch — final API verified against running code):**

```ts
interface SandboxedIframeMessage {
  source: string;     // Type-marker — e.g. "boldkast", "energy-sim"
  type: string;       // Event type — e.g. "boldkast.show_value"
  // ...arbitrary other fields per artefact's wire format
}

interface UseSandboxedIframeMessagesOptions<T extends SandboxedIframeMessage> {
  /** Ref on the <iframe> element. Auth: events accepted only when
   *  e.source === iframeRef.current.contentWindow. The hook reads
   *  current at event time so attaching later (e.g. iframe mounts
   *  conditionally) just-works. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Required type-marker. Events with data.source !== sourceMarker
   *  are rejected before the handler sees them. Lets two MCP Apps
   *  coexist on the same page without colliding. */
  sourceMarker: string;
  /** Called once per legitimate, authenticated, type-tagged event.
   *  Hook handles auth, filtering, and unmount cleanup. */
  onMessage: (data: T) => void;
  /** Optional: dev-mode console label. Defaults to sourceMarker. */
  debugLabel?: string;
}

export function useSandboxedIframeMessages<T extends SandboxedIframeMessage>(
  opts: UseSandboxedIframeMessagesOptions<T>,
): void;
```

**Behaviour:**
1. Mount: registers `window.addEventListener("message", internalHandler)`.
2. On every event: rejects if `e.source !== iframeRef.current?.contentWindow` (window-identity auth — works under ADR-013's sandbox profile, where `e.origin === "null"`).
3. Type-tags: rejects if `data.source !== sourceMarker` (lets two MCP Apps coexist; a Boldkast iframe can't spoof events from an Energy Sim iframe even if both render in the same chat tree).
4. Shape check: rejects if `typeof data.type !== "string"` (every artefact's event shape MUST have a string `type` — that's the only field the hook reads; everything else is the caller's concern).
5. Calls the caller's `onMessage` with the validated typed payload.
6. Dev-mode: console.log under `[debugLabel]` for every event that passed auth (visible in browser devtools — closes the "is it firing?" debug gap that took an hour on 2026-05-21).
7. Unmount: removes the listener.

**Auth narrative (for ADR-013 cross-reference):**

> The host authenticates iframe `postMessage` events by **window identity**, not origin. The iframe runs with `sandbox="allow-scripts"` and no `allow-same-origin` (per ADR-013), which means it has an opaque origin and every `postMessage` arrives with `e.origin === "null"`. Origin-based auth would reject every event silently. The HTML living standard's `MessageEvent.source` field (the sender's `WindowProxy`) is the correct identifier in this case: the host owns the `<iframe>` element, so it knows which `contentWindow` is the legitimate sender. Combined with the artefact-specific type marker (`data.source === "boldkast"`), only events from the host's own iframe with the artefact's claimed type marker reach the application code.

### BoldkastSimFrame migration

Before (today, in-line):

```ts
const onMessage = (e: MessageEvent) => {
  if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
  const data = e.data as BoldkastMessage;
  if (!data || data.source !== "boldkast" || typeof data.type !== "string") return;
  // ...30 lines of application logic
};
window.addEventListener("message", onMessage);
return () => window.removeEventListener("message", onMessage);
```

After:

```ts
useSandboxedIframeMessages<BoldkastMessage>({
  iframeRef,
  sourceMarker: "boldkast",
  onMessage: (data) => {
    // ...30 lines of application logic — no auth/filter boilerplate
  },
});
```

Saves ~10 lines per artefact, but more importantly **the auth gate moves to one audited location**. Security review of any future artefact reads the hook once and concludes "this app inherits the audited auth path".

### ADR-013 update (separate PR, scoping site)

Append a sub-bullet to ADR-013's "Consequences" section in `~/Documents/clients/cph-uni/architecture.qmd`:

> **Authentication is window-identity, not origin.** Because `sandbox="allow-scripts"` excludes `allow-same-origin`, the iframe has an opaque origin and every `postMessage` arrives at the host with `e.origin === "null"`. The host authenticates incoming events by checking `e.source === iframeRef.current.contentWindow` (window identity per HTML living standard), not by origin. The shared `useSandboxedIframeMessages` hook in `frontend/src/hooks/` enforces this; any artefact that bypasses the hook MUST do the same check (origin-based auth will silently reject every legitimate event under this sandbox profile).

That's a one-line cross-ref the next security review can land on.

## CLI Surface

None — pure frontend refactor. The existing `aiplatform sessions iframe-context <id>` already gives developers the read side (dump what the backend received); the missing piece is "did the iframe actually send", which the dev-mode console log in the hook now covers without needing a CLI command.

## Testing Strategy

**Frontend vitest (`npm run test:run`):**

- `frontend/src/hooks/__tests__/useSandboxedIframeMessages.test.tsx` (new):
  - registers a listener on mount; removes on unmount
  - accepts an event when `e.source === iframeRef.contentWindow` AND `data.source === sourceMarker` AND `data.type` is a string
  - rejects when `e.source` is null (different window)
  - rejects when `e.source` matches but `data.source` is a different marker (two MCP Apps coexisting)
  - rejects when `data.type` is missing or non-string
  - calls `onMessage` exactly once per valid event
  - dev-mode console logs each accepted event under the debugLabel
- Existing [BoldkastSimFrame tests](../../../../frontend/src/components/workspace/__tests__/BoldkastSimFrame.test.tsx): unchanged in coverage; the hook migration shouldn't break any of the 14 tests.

**Manual verification (last, not only):** open chat with `problem-set-hints`, open the Boldkast sim, drag a slider, click a "Vis" button — all should still produce the right cards / pushes / agent visibility as after `3563af1`.

**Browser-loop smoke (deferred to followups.md):** the existing `scripts/smoke-workspace-context.sh` only exercises the backend half. A future browser-loop check (Chrome DevTools MCP) would mount the chat page, drag a slider in the sim iframe, and assert iframe-context shows the snapshot — the actual chain that broke on 2026-05-21. Scoping note in **Out of Scope** below.

## Migration / Rollout

- **No data migration.** Pure code refactor.
- **Feature flag:** none. The hook ships, BoldkastSimFrame consumes it in the same PR.
- **Rollback:** revert is one commit. The hook is additive; BoldkastSimFrame's behaviour is unchanged when consuming it (same auth predicate, same handler body).

## Implementation Plan

| Step | What | Where | Est |
|---|---|---|---|
| 1 | Hook + tests | `frontend/src/hooks/useSandboxedIframeMessages.ts` (new), `frontend/src/hooks/__tests__/useSandboxedIframeMessages.test.tsx` (new) | 0.2 d |
| 2 | BoldkastSimFrame migration | `frontend/src/components/workspace/BoldkastSimFrame.tsx` | 0.05 d |
| 3 | Run existing BoldkastSimFrame tests, confirm 14/14 still green | (no edits, just verification) | 0.02 d |
| 4 | Lint + typecheck + full vitest sweep | (npm run quality:check) | 0.03 d |
| 5 | followups.md entry for browser-loop smoke | `docs/design/aipla/v0.1.0-jutland/followups.md` | 0.05 d |
| 6 | ADR-013 update | `~/Documents/clients/cph-uni/architecture.qmd` (separate scoping-site commit) | 0.05 d |
| | **Total** | | **0.4 d** |

## Success Criteria

- [ ] `useSandboxedIframeMessages` hook lives at `frontend/src/hooks/useSandboxedIframeMessages.ts`.
- [ ] Hook tests cover all five reject cases + the happy path + cleanup.
- [ ] BoldkastSimFrame uses the hook; its 14 existing tests still pass.
- [ ] `npm run quality:check` green; `make test-fast` (backend) green (no backend changes, but parity check).
- [ ] followups.md has an entry for the browser-loop smoke gap with enough detail to pick up later.
- [ ] ADR-013 in the scoping site gains the window-identity-auth sub-bullet.
- [ ] M tests in browser: sliders, Vis, presets all produce correct cards / pushes / agent visibility — same as after `3563af1`.

## Out of Scope (deferred — followups.md candidates)

- **Browser-loop smoke** (Chrome-DevTools-MCP-driven end-to-end). Would catch the 2026-05-21 class of regression in CI rather than in a teacher's classroom. Scope: open the chat page, mount the sim iframe, dispatch a synthetic "show_value" event from inside the iframe, assert the host POSTs iframe-context to the backend within 1s with the expected shape. Estimate: 0.5 d. Not blocking — manual + unit tests cover today.
- **A2UI surface-action route iframe auth.** The sibling route ([backend/protocols/a2ui_surface_action_routes.py](../../../../backend/protocols/a2ui_surface_action_routes.py)) has the same shape and the same latent risk if a future A2UI surface uses a sandboxed iframe. Not exercised by AIPLA v0.1, but worth a security review when the next non-MCP surface lands.
- **Generic MCP App authoring SDK.** A few sims in we'll likely want a `createMcpApp(name, schema, handler)` factory. Premature now; revisit after Strand A's third artefact.

## Related Documents

- [boldkast-mcp-app.md](boldkast-mcp-app.md) — first artefact, the one this was caught against
- [human-tool-use-cards.md](human-tool-use-cards.md) — sibling sprint where the bug was discovered live
- [human-tool-use-cards-sprint.md](human-tool-use-cards-sprint.md) — sprint plan, M3 manual verification step is what surfaced this
- [ADR-013](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd#adr-013-artefact-safety-content-review-pipeline-for-generated-html) — sandbox + CSP decision this design completes
- [agent-protocols skill](../../../../.claude/skills/agent-protocols/SKILL.md) — should reference this design when adding a "host-side message listener" recipe
- Memory: [feedback-self-testable-loops](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_self_testable_loops.md) — the live-testing principle that surfaced this bug
