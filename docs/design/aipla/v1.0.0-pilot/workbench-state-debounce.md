# Workbench state debounce — slider events shouldn't spam the chat or model context

**Status**: Planned
**Priority**: P1 (urgent — flagged in 2026-05-25 teacher review; "before next teacher demo")
**Estimated**: ~0.5 day
**Scope**: Frontend (BoldkastSimFrame + StaticArtefactFrame + future LED Planck / KineBot wrappers) + artefact-side debounce in the Boldkast HTML
**Dependencies**: v0.1 shipped; sprint MCPAPP-SPEC merged (partial overlap — see "Delta vs current state" below)
**Pedagogical source-of-truth:** [`workbench-state-debounce.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/workbench-state-debounce.md) in the scoping site
**Created**: 2026-05-25
**Last Updated**: 2026-05-25

## Problem Statement

From the 2026-05-25 teacher review meeting: *"the UI feedback to the AI was overwhelming — needs to only take last modified value?"* Watching a student drag the v₀ slider from 10 → 25 m/s produces a cascade of state events, each one becoming a human tool-use card in the chat:

- Visual clutter (chat gets a chain of "Adjusted v₀ to 11 m/s · 12 m/s · 13 m/s · …" cards)
- Context bloat (every intermediate value pushed into the model's prompt via `mcp_app_context.boldkast.state` history)
- Tutor confusion (the agent's acknowledgement of "your last values" is ambiguous when 15 values arrive in 2 seconds)

## Delta vs current state (important)

**This brief was written reviewing pre-MCPAPP-SPEC behaviour.** Sprint MCPAPP-SPEC (merged 2026-05-21) already shipped a partial fix: BoldkastSimFrame debounces slider events host-side at 500ms, emitting **one** card per drag-end (see [BoldkastSimFrame.tsx](../../../../frontend/src/components/workspace/BoldkastSimFrame.tsx)). So the chat already gets one card per pause, not one per pixel.

The brief proposes a **different** + **more robust** architecture:

| Layer | Current (shipped) | Brief proposes |
|---|---|---|
| Workbench artefact | Fires postMessage on every slider input event | Debounce 800ms inside the artefact; emit only final settled value |
| Host wrapper | 500ms debounce, then one card per settle | 300ms coalesce window per `changed` field; one card per field-burst |
| Context injection | Snapshot accumulates all intermediate values into `mcp_app_context.*` state at every push | Only the settled value enters context (intermediate values never serialised) |
| Wire shape | Full snapshot (`{kind, marker, v0, theta, g, lastEvent, ...}`) | `{kind, changed: "v0", value: 25, unit: "m/s"}` — minimal delta |

**Why the brief's architecture is structurally better:**

1. **Debounce-at-the-source** means the workbench doesn't even *send* intermediate values; today they're sent then dropped at the host. Lower bandwidth (matters for low-end school WiFi), lower CPU on the iframe-side message loop.
2. **Field-keyed coalesce** at the host is more selective than time-window debounce — if two different fields change in the same 300ms window, BOTH cards fire; current implementation would dedupe by snapshot-time alone.
3. **Minimal-delta wire shape** means the agent's context window doesn't see all five sim parameters every push — only what actually changed. Material for KineBot where the snapshot is much bigger than Boldkast's.

**Scope of this work:** Migrate from the shipped 500ms-host-only approach to the brief's two-part architecture. The existing 500ms behaviour stays as a fallback if the workbench-side debounce isn't wired (e.g. for legacy artefacts), but new artefacts (LED Planck, KineBot) implement both layers from the start.

## Goals

**Primary Goal:** Dragging any continuous control in any workbench artefact produces **exactly one** human tool-use card showing the final settled value, and adds exactly one entry to `mcp_app_context.*` state. Discrete controls (preset buttons, dropdown changes) fire immediately without debounce. The wire shape is minimal (`{kind, changed, value, unit}`) — not a full snapshot.

**Success Metrics:**
- Manual: drag Boldkast v₀ slider continuously for 5 seconds → land on final value → wait → exactly 1 card appears in chat, exactly 1 entry shows in `aiplatform sessions iframe-context <id>` output, latest only.
- Clicking a planet preset (Moon → Mars) fires immediately, no debounce delay — manually verifiable in <300ms.
- BigQuery logs (when 1.2 lands) show 1 row per intentional change, not N rows per drag.
- Model context size (chars in the InstructionProvider's rendered block) drops from O(N) per-slider-event to O(1) per-settled-value.
- All three workbench artefacts (Boldkast, LED Planck, KineBot) follow the same two-part pattern.

**Non-Goals:**
- Configurable per-artefact debounce delays. v1 uses 800ms (artefact) + 300ms (host coalesce) — same constants everywhere.
- Per-field debounce delays. All continuous fields debounce identically.
- Backpressure / quota enforcement on workbench events. If a misbehaving artefact spams 100 events/sec post-debounce, the host coalesce catches it but doesn't penalise the artefact. That's a separate concern.
- Server-side debounce (in iframe-context route). All debouncing lives client-side; backend trusts what arrives.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Discrete clicks (presets) get 0ms debounce — instant. Continuous drags settle in <1s post-release. Net: faster *perception* of feedback because the right feedback (not noise) lands |
| 2 | EARNED TRUST | +1 | The 2026-05-25 meeting feedback names this directly as a UX trust hole. Closing it earns trust with teachers reviewing the platform |
| 3 | SKILLS, NOT FEATURES | 0 | Plumbing |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model in this path |
| 5 | GRACEFUL DEGRADATION | +1 | If artefact-side debounce isn't implemented (legacy artefact), the host-side coalesce still catches the burst — graceful fallback |
| 6 | PROTOCOL OVER CUSTOM | +1 | Wire shape converges on the minimal-delta envelope — same shape every artefact uses. One contract, not per-artefact variants |
| 7 | API FIRST | 0 | No new API |
| 8 | OBSERVABLE BY DEFAULT | +1 | The new wire is easier to log + analyse in BigQuery (one row per intentional change, not noise). Researchers asking "what did students adjust" get cleaner data |
| 9 | SECURE BY CONSTRUCTION | 0 | No security delta |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | The wire becomes thinner (delta-only payload). The host coalesce logic centralises in `StaticArtefactFrame` so per-artefact wrappers don't reimplement it |
| | **Net Score** | **+6** | Threshold >= +4 OK |

**Conflict Justifications:** None.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| Wire envelope | MCP Apps spec JSON-RPC `ui/update-model-context` notification | Existing — `params.structuredContent` carries `{kind, changed, value, unit}` instead of full snapshot |
| Debounce primitive | Vanilla `setTimeout` / `clearTimeout` — no library | Already the pattern in `BoldkastSimFrame.tsx` (post-MCPAPP-SPEC) |
| Coalesce primitive | `Map<changedField, TimerId>` | Standard JS, no new dep |

**No new protocols.**

## Design

### Wire shape change

**Before** (current Boldkast post-MCPAPP-SPEC):
```js
// On every slider input event:
rpcNotify("ui/update-model-context", {
  structuredContent: {
    kind: "boldkast.param.change",
    param: "v0",
    value: 25,
    triggeredBy: "slider"
    // Plus the full snapshot in the host-side accumulator
  }
});
```

**After** (this design):
```js
// Only after 800ms of slider inactivity:
rpcNotify("ui/update-model-context", {
  structuredContent: {
    kind: "boldkast.state-change",
    changed: "v0",
    value: 25,
    unit: "m/s"
  }
});

// Discrete clicks fire immediately:
rpcNotify("ui/update-model-context", {
  structuredContent: {
    kind: "boldkast.preset",
    preset: "moon",
    g: 1.62
  }
});
```

The host-side accumulator keeps building the full snapshot — the agent's prompt still gets the complete state — but only **settled** values feed into it. The wire becomes delta-only; the model's context view is still the assembled snapshot.

### Host-side coalesce (added to `StaticArtefactFrame`)

Currently `BoldkastSimFrame.tsx` does the 500ms debounce locally. Move that primitive into `StaticArtefactFrame` so every artefact wrapper inherits it:

```tsx
// frontend/src/components/workspace/StaticArtefactFrame.tsx (added internals)
const pendingByField = useRef<Map<string, number>>(new Map());

function coalesceNotification(data: SandboxedIframeMessage) {
  const changed = data.changed ?? data.kind;
  const existing = pendingByField.current.get(changed);
  if (existing) window.clearTimeout(existing);
  const id = window.setTimeout(() => {
    pendingByField.current.delete(changed);
    onUpdateModelContext(data);
  }, 300);
  pendingByField.current.set(changed, id);
}
```

Discrete events (no `changed` key, or events tagged with `immediate: true`) bypass coalesce. Continuous events go through.

### Files to modify

| File | Change | LOC delta |
|---|---|---|
| `frontend/src/components/workspace/StaticArtefactFrame.tsx` | Add 300ms coalesce-by-field primitive; expose `immediate` opt-out for discrete events | +35 |
| `frontend/src/components/workspace/BoldkastSimFrame.tsx` | Remove the 500ms host-side debounce (moved into shared); event handlers shorten | -25 |
| `frontend/src/components/workspace/__tests__/BoldkastSimFrame.test.tsx` | Test updates: debounce assertions now go via StaticArtefactFrame mock | minor |
| `frontend/src/components/workspace/__tests__/StaticArtefactFrame.test.tsx` | New cases: coalesce-by-field, immediate-opt-out | +50 |
| `infrastructure/mcp-sandbox/artefacts/boldkast/v1/index.html` | Wrap slider `oninput` handlers with 800ms artefact-side debounce; emit `{changed, value, unit}` shape | +25 |
| `infrastructure/mcp-sandbox/artefacts/_template/...` (if exists; else new file) | Document the debounce pattern as a required convention | +50 |
| `.claude/skills/mcp-app-artefact/SKILL.md` | Add "Debounce convention" section: 800ms artefact + 300ms host, discrete bypass | +40 |

### Files to NOT modify (yet)

- LED Planck and KineBot will pick up the convention from the mcp-app-artefact skill update **before** they're wired (they don't exist in tree yet). When [1.C](led-planck-skill.md) and [1.D](kinebot-migration.md) implementations land, they apply the convention from the start.

## API Changes

**None.** Wire envelope is still `ui/update-model-context` with `structuredContent`; only the payload shape (delta vs snapshot) shifts.

## Migration

- **No data migration.**
- **Cumulative snapshot in session state stays the same.** The host-side accumulator still builds the full state; only the delta arrives on the wire. The `mcp_app_context.boldkast.state` key in ADK session state retains the full snapshot shape, so the agent's prompt-injection code is unchanged.
- **Rollback:** revert. The 500ms host-only debounce was acceptable; reverting falls back to that.

## Testing Strategy

**Vitest:**

- `StaticArtefactFrame.test.tsx`:
  - Two events for `changed: "v0"` within 300ms → only the second fires `onUpdateModelContext`.
  - One event for `changed: "v0"` + one for `changed: "theta"` within 300ms → both fire (different fields, no coalesce).
  - Event tagged `immediate: true` bypasses coalesce, fires same-tick.
- `BoldkastSimFrame.test.tsx`: update the slider-drag test to dispatch 5 events in quick succession + advance fake timer past 300ms → assert exactly 1 card.

**Vitest (sandbox-side, via puppeteer or jsdom-with-postmessage):**

- Synthetic slider input loop (5 events in 100ms) → MediaRecorder-style: artefact emits 1 postMessage after 800ms.

**Manual:**

- Drag v₀ slider continuously for 3s, release, wait 1s → exactly 1 card in chat, exactly 1 entry in `aiplatform sessions iframe-context` dump.

## Implementation Plan

| Step | What | Where | Est |
|---|---|---|---|
| 1 | Add coalesce primitive to `StaticArtefactFrame` | `frontend/src/components/workspace/StaticArtefactFrame.tsx` | 0.1 d |
| 2 | New tests for coalesce + immediate-bypass | `__tests__/StaticArtefactFrame.test.tsx` | 0.1 d |
| 3 | Refactor `BoldkastSimFrame` to drop local 500ms debounce | `BoldkastSimFrame.tsx` + its tests | 0.1 d |
| 4 | Wrap Boldkast HTML slider handlers with 800ms artefact-side debounce | `boldkast/v1/index.html` | 0.05 d |
| 5 | Update mcp-app-artefact skill with debounce convention | `.claude/skills/mcp-app-artefact/SKILL.md` | 0.05 d |
| 6 | Manual smoke against LOCAL_MODE backend | — | 0.05 d |
| | **Total** | | **~0.45 d** |

## Success Criteria

- [ ] Continuous slider drag produces exactly 1 card per pause.
- [ ] Discrete preset click produces a card within 300ms.
- [ ] `aiplatform sessions iframe-context <id>` shows 1 entry per settled change, not N.
- [ ] All workspace tests pass (`npm run test:run -- workspace`).
- [ ] mcp-app-artefact skill documents the 800ms + 300ms convention.
- [ ] BoldkastSimFrame size reduces (debounce moved out to shared frame).
- [ ] Manual verification with M against LOCAL_MODE.

## Out of Scope (deferred)

- Configurable per-artefact debounce delays.
- Server-side debounce.
- Backpressure on misbehaving artefacts.

## Related Documents

- **Source of truth:** [`workbench-state-debounce.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/workbench-state-debounce.md)
- [SEQUENCE.md](SEQUENCE.md) row 1.E
- [boldkast-mcp-app.md](../v0.1.0-jutland/boldkast-mcp-app.md), [implemented/mcp-app-iframe-spec-compliance.md](implemented/mcp-app-iframe-spec-compliance.md) — current state this builds on
- [led-planck-skill.md](led-planck-skill.md), [kinebot-migration.md](kinebot-migration.md) — pick up the convention from the start
- [.claude/skills/mcp-app-artefact/SKILL.md](../../../../.claude/skills/mcp-app-artefact/SKILL.md) — debounce convention lands here
