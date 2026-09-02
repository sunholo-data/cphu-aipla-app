# Persist & restore MCP-app interaction events in chat history

**Status**: ✅ **SHIPPED** (M1 + M2) — MCP-app interaction cards surface on `/messages` and restore on reload; `useHumanToolEvents.ts`.
**Priority**: P2 (Medium) — transcript fidelity; demo-coherence, not pilot-blocking
**Estimated**: ~1.5–2 days
**Scope**: Fullstack (small backend read change + label threading; frontend restore wiring)
**Dependencies**: builds on [human-tool-use-cards.md](../v0.1.0-jutland/human-tool-use-cards.md) (the live card system) and the 2026-06-16 reload-history hardening (`useEnteredViaResume`, proactive-sentinel filtering)
**Created**: 2026-06-16
**Last Updated**: 2026-06-16

## Problem Statement

When a student interacts with an MCP-App sim (Boldkast / LED Planck / KineBot) — moves a slider, plays a configuration, reveals a marker — a **human-tool-use card** appears inline in the chat: *"Sendte spørgsmål med v₀=15, θ=40"* / *"Afspillede med aktuel konfiguration"*. The tutor often reacts to that interaction with a text turn.

On **reload**, the card disappears. The tutor's text reaction survives (it is a real assistant message), but the interaction that *caused* it is gone — so the resumed transcript shows an unexplained AI response with no visible trigger. M reported this directly (2026-06-16): *"I see them in a session but when we renew I don't see them, just the AI's reaction to them."*

> **Terminology.** M called these *"A2A events from the MCP apps"*. They are **not** A2A (which is agent-to-agent discovery). They are **MCP-App iframe-context interactions** — the student manipulating a sandboxed sim — surfaced in chat as **human-tool-use cards**. Keeping this straight matters because the persistence path rides the MCP-App / ADK-session layer, not A2A. (See the project convention of not conflating A2A / A2UI / AG-UI / MCP Apps.)

**Current State (all verified in code):**
- The card itself is **ephemeral client state**: `useHumanToolEvents` holds events in `useState<HumanToolEvent[]>([])` with no persistence, no restore ([useHumanToolEvents.ts:126](../../../../frontend/src/hooks/useHumanToolEvents.ts#L126)). Its own header comment says so: *"Events are pure UI state for the current page lifetime. Refresh clears them."*
- The **sim state IS persisted**: the interaction POSTs to `/api/sessions/{id}/iframe-context`, which writes an ADK session event via `append_event(...)` with `EventActions(state_delta={state_key: state_value})`, `author="user"`, and a `timestamp` ([iframe_context_routes.py:276-283](../../../../backend/protocols/iframe_context_routes.py#L276-L283)). It also logs a BigQuery `emit_workbench_event` row (powers the teacher session-summary report).
- The **history read endpoint drops it**: `GET /api/sessions/{id}/messages` → `_events_to_messages` skips any event with no text content (`if not e.content or not e.content.parts: continue`, [sessions_route.py:122](../../../../backend/protocols/sessions_route.py#L122)). The interaction events are `state_delta`-only (no `content.parts`) → filtered out.

**Net:** the interaction data is *already persisted and replayed by ADK for the session lifetime* (and survives rejoin). It is simply never surfaced on the read path, and the client card store starts empty on reload. So this is a **read/render gap, not a data-loss problem.**

**Impact:**
- Affects every student who reloads mid-session after using a sim (the common case on shared pilot phones, where tabs get reloaded/restored constantly).
- Severity: major UX-coherence friction. An AI reaction with no visible cause reads as a non-sequitur — exactly the kind of "looks broken on reload" regression M has flagged repeatedly. Directly in scope for the [UX-coherence gate](../../../..) (a probe only counts if it survives a reload a teacher would do in front of a class).

## Goals

**Primary Goal:** On reload, a resumed transcript faithfully shows each MCP-app interaction card in its original position relative to the text turns — so "student did X → tutor responded Y" is legible, matching the live experience.

**Success Metrics:**
- 100% of persisted sim interactions in a session render as (read-only) cards on reload, interleaved at the correct point in the transcript.
- Zero new storage subsystem — restore reads the ADK session events that already exist.
- No regression to the live card path (the F1-isolated `useHumanToolEvents` stream stays untouched for live dispatch).
- Reload of a session with no interactions is byte-identical to today (pure additive).

**Non-Goals:**
- Re-running or re-triggering the tutor on restore — cards are **read-only** replays; the tutor's persisted reaction already follows them.
- Restoring the live *sim iframe state* to the exact post-interaction frame (the workbench reloads to its own initial state; that is a separate concern — `useSimSnapshotPush` / `documents-workbench-surface`).
- Persisting non-sim human-tool-use cards that never POST iframe-context (none exist today; all current dispatchers push).
- Cross-session / analytics surfacing — the teacher report already reads the BigQuery workbench events; this doc is the *student chat transcript* only.

## Axiom Alignment

Score each axiom per [Product Axioms](../../../product-axioms.md). Net score must be >= +4. Max 2 conflicts (-1) allowed.

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | No latency-path change — interactions ride the *existing* `/messages` fetch as a parallel array. Render is cheap; a cap (see Design) keeps it bounded. |
| 2 | EARNED TRUST | +1 | Restores the *cause* of the tutor's reaction. Today reload shows an AI response with no visible trigger; this makes the transcript an honest, complete record of what happened. |
| 3 | SKILLS, NOT FEATURES | 0 | No new user-facing abstraction; rides the existing sims. Invisible plumbing. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model involved. Deterministic read + render. |
| 5 | GRACEFUL DEGRADATION | +1 | Fully additive + fail-soft: if the `interactions[]` array is missing/empty/malformed, the transcript renders text exactly as today. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Rides ADK session events (already `append_event`'d) and the AG-UI/MCP-App state-delta concept. **No new protocol or store.** Exposes events that already persist. |
| 7 | API FIRST | +1 | The interactions ride the existing `/messages` endpoint (one transcript surface), so any channel that reads the transcript gets them — not a web-only patch. |
| 8 | OBSERVABLE BY DEFAULT | +1 | The workbench events are already captured to BigQuery; this makes the in-app transcript match the already-observable record. No reduction in capture. |
| 9 | SECURE BY CONSTRUCTION | 0 | No new data access: same `_require_session` ownership gate, data already in-session, inside the GCP edge. **One new input-handling rule:** the persisted `label` is iframe-influenced text → render as plain text (escaped), never HTML (see Security). |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | On restore the client replays a **stored** label string — no client-side re-derivation of display text. Logic stays server-authored; the frontend just renders a string at a position. |
| 11 | USABLE BY DESIGN | +1 | Directly fixes a confusing reload state. Empty/normal states are designed: no interactions → today's text-only transcript; cards are visibly read-only (no pending spinner, no retry). |
| | **Net Score** | **+7** | Threshold: >= +4. Strong alignment. |

**Conflict Justifications:**
- None (no axiom scores -1).

## Design

### Overview

The interaction events **already persist** as ADK session `state_delta` events and are replayed every session. We (1) enrich each interaction with the human-readable `label` the client already computes for the live card, (2) surface the interaction events through the existing `/messages` read as a parallel `interactions[]` array, and (3) seed the `HumanToolEventsProvider` from that array on restore so the **existing** interleave-by-position render shows them — read-only.

### Framework-Native Capability Check (MANDATORY)

Per the [design-doc-creator] 5b-ter rule — prove the stack doesn't already do this before adding custom plumbing. It mostly does:

- **ADK sessions/events** — *Already persist + replay this.* Each iframe-context interaction is one `append_event` with `EventActions(state_delta=…)` ([iframe_context_routes.py:276-283](../../../../backend/protocols/iframe_context_routes.py#L276-L283)). ADK retains **all** events in `session.events` for the session lifetime and replays them on rejoin. The *ordered per-interaction history is therefore already stored* — note this is the **events list**, not `session.state` (state is a merged dict where only the latest value per `mcp_app_context.{server}.{tool}` key survives; the events preserve each discrete interaction with its own timestamp). **We build no new store.**
- **AG-UI / MCP Apps** — The interaction maps to the AG-UI **state-delta / state-snapshot** concept, which is exactly how we already write it. The card is a *UI affordance* with no AG-UI message-type equivalent (it is not a model `ToolCall` — it's a human manipulating a sandboxed iframe), so its *rendering* is legitimately a frontend concern over restored data. No new protocol.
- **The one genuinely-absent thing** — the **read path**. `_events_to_messages` is text-only by construction, so the persisted `state_delta` events are filtered out, and the client store is page-lifetime only. Surfacing already-persisted events through the read endpoint + seeding the client store on restore is *exposing* an existing capability, not re-implementing one.
- **The one genuinely-missing datum** — a faithful **label**. The stored `state_value` is the raw snapshot (`{v0:15, theta:40, …}`), not the Danish per-sim phrasing (*"Sendte spørgsmål med v₀=15, θ=40"*), which is computed client-side in the snapshot hooks. Two options, below; we recommend **persisting the client label** (it already exists; re-deriving it server-side would duplicate per-sim formatting logic and drift).

This mirrors the [documents-workbench-surface](documents-workbench-surface.md) precedent (aggregate from native AG-UI/ADK events; no new store).

### Backend Changes

**1. Carry the label on the interaction (small contract addition).**
`IframeContextRequest` ([iframe_context_routes.py:98](../../../../backend/protocols/iframe_context_routes.py#L98)) gains an optional `label: str | None` (alias `label`, capped ~200 chars). The handler stores it inside the namespaced `state_value` it already writes (e.g. `state_value["_label"] = body.label`), so the existing `state_delta` event now carries the display string. No new event, no new key namespace — the label travels with the snapshot already being persisted. (Fallback: when absent, the read path derives a generic label from `structured_content.changed` + `value`, the same fields `emit_workbench_event` already reads at [iframe_context_routes.py:296-297](../../../../backend/protocols/iframe_context_routes.py#L296-L297).)

**2. Surface interactions on the read path (additive, one endpoint).**
Extend `GET /api/sessions/{id}/messages`:
- Add a response model `InteractionEvent { label: str, timestamp: float, server_id: str | None, tool_name: str | None }`.
- Add `interactions: list[InteractionEvent]` to `GetSessionMessagesResponse` (default `[]`).
- A new helper `_events_to_interactions(events)` walks the same `session.events`, selecting events whose `actions.state_delta` has an `mcp_app_context.*` key, and emits `{label, timestamp, server_id, tool_name}` (label from `_label`, else the generic fallback). Status is implicitly **confirmed** — it persisted, therefore it succeeded.
- `_events_to_messages` is **unchanged** (still text-only). The two helpers read the same event list independently; the frontend interleaves by timestamp.

Keeping it on the existing endpoint (not a new `/interaction-events` route) satisfies API-First: one transcript fetch returns the full picture, and the channels that render a transcript get interactions for free.

**Bounded output.** Cap `interactions[]` at the most-recent N (e.g. 200) per session and coalesce runs of identical consecutive labels on the same `(server, tool)` (slider "settle" can emit several). If truncated, the response notes it (`interactions_truncated: true`) so the UI can show a quiet "earlier interactions hidden" marker rather than silently dropping — no silent caps.

### Frontend Changes

**Modified hook — `useSessionMessages.ts`:** parse the new `interactions[]` and return it alongside `initialMessages` (e.g. `initialInteractions: RestoredInteraction[]`). Maps `timestamp → afterMessageIndex` by counting restored messages with `timestamp <= interaction.timestamp` (same ordering basis the live `afterMessageIndex` uses). Continues to filter proactive sentinels from messages — the `[event_reactive:*]` *trigger* sentinel and the interaction *card* are distinct events; we restore the card and keep filtering the sentinel, so they never double-render.

**Modified provider — `useHumanToolEvents.ts`:** add a `seed(events: HumanToolEvent[])` (or accept an `initialEvents` prop) that loads restored interactions into state as **read-only confirmed** cards (status `"confirmed"`, no `push`, no pending hold). The live `dispatch` path is untouched. Restored ids are namespaced (`htu-restored-…`) so a subsequent live dispatch never collides.

**Render — `ChatMessageList.tsx`:** already interleaves cards by `afterMessageIndex` via `HumanToolEventsAt`. No render change beyond ensuring restored (confirmed) cards show no spinner/retry affordance. The chat page seeds the provider once on history load.

**Read-only treatment — `HumanToolUseCard`:** a restored card renders the label + a confirmed state only (no retry button, no pending animation). Live cards keep the full pending→confirmed/failed lifecycle.

### API Changes

| Method | Endpoint | Description | Breaking? |
|--------|----------|-------------|-----------|
| POST | /api/sessions/{id}/iframe-context | + optional `label` field on body | No (additive, optional) |
| GET  | /api/sessions/{id}/messages | + `interactions[]` and `interactions_truncated` in response | No (additive; existing clients ignore unknown fields) |

### CLI Surface (optional, light)

Session-event inspection is already covered by the `aitana-adk-testing` skill's HTTP endpoints. A thin convenience — `aiplatform sessions interactions <session_id>` printing the restored `interactions[]` — would help debug "did my interaction persist?" without curl + token. Low value vs. the existing skill; include only if cheap. Backlink: [local-dev-cli.md](../../v6.1.0/local-dev-cli.md).

### Architecture Diagram

```
LIVE (today, unchanged):
  [student moves slider] → useBoldkastSnapshot
        ├─ dispatch({label, push})  → HumanToolEventsProvider (useState)  → card renders live
        └─ push() → POST /iframe-context → append_event(state_delta + _label) → ADK session.events
                                         └→ emit_workbench_event → BigQuery (teacher report)

RELOAD (new):
  GET /api/sessions/{id}/messages
        ├─ _events_to_messages(events)      → messages[]      (text turns; unchanged)
        └─ _events_to_interactions(events)  → interactions[]  (mcp_app_context.* state_delta + _label)
                          ↓
  useSessionMessages → seeds HumanToolEventsProvider (read-only confirmed cards)
                          ↓
  ChatMessageList interleaves by afterMessageIndex (existing render) → cards restored in place
```

## Implementation Plan

### Phase 1: Backend read + label (~0.75 day)
- [ ] Add optional `label` to `IframeContextRequest`; store as `state_value["_label"]` in the handler (~15 LOC + test).
- [ ] `InteractionEvent` model + `interactions` / `interactions_truncated` on `GetSessionMessagesResponse` (~20 LOC).
- [ ] `_events_to_interactions(events)`: select `mcp_app_context.*` state_delta events, label (stored or fallback), cap + coalesce (~60 LOC).
- [ ] pytest: state_delta event → interaction; no-label fallback; cap/coalesce; text-only events unaffected; ownership gate unchanged.

### Phase 2: Frontend restore wiring (~0.75 day)
- [ ] Thread `label` into the iframe-context push body from the snapshot hooks (reuse the label already computed for `dispatch`) — `useSimSnapshotPush` + the three sim hooks (~30 LOC).
- [ ] `useSessionMessages`: parse `interactions[]`, map timestamp→afterMessageIndex, return `initialInteractions` (~30 LOC + test).
- [ ] `useHumanToolEvents`: `seed()` / `initialEvents` for read-only confirmed cards; namespaced restored ids (~25 LOC + test).
- [ ] Chat page: seed the provider on history load; `HumanToolUseCard` read-only variant (no retry/spinner) (~20 LOC).
- [ ] vitest: restored card renders at the right index; live dispatch still works post-seed; empty interactions = today's behaviour.

### Phase 3: Verify on the live deployed session (~0.25 day)
- [ ] Reproduce against the deployed dev session (not just local): interact with Boldkast, reload, confirm cards restore in order with the tutor reaction following. (Per the 2026-06-16 lesson: root-cause and verify reload bugs against the live deployment, not by guessing.)
- [ ] Confirm a no-interaction session reload is unchanged.

## Migration & Rollout

**Database Migrations:** None. Reads existing ADK session events. Sessions created before this ships have no `_label` on their state_delta events → the generic fallback label applies (graceful, no backfill).

**Feature Flags:** None needed — additive and fail-soft. (Optionally gate the frontend seed behind an env flag for one deploy if we want to A/B the render.)

**Rollback Plan:** Frontend revert stops seeding (cards simply don't restore — today's behaviour). Backend revert drops `interactions[]` (clients ignore the missing field). No data written that needs cleanup beyond the optional `_label` key, which is inert if unread.

**Environment Variables:** None.

## Testing Strategy

### Frontend Tests (Vitest + React Testing Library)
- [ ] `useSessionMessages` returns `initialInteractions` with correct `afterMessageIndex` mapping from timestamps.
- [ ] `useHumanToolEvents.seed()` loads read-only confirmed cards; subsequent live `dispatch` does not collide or clear them.
- [ ] `ChatMessageList` interleaves restored cards at the right point; no spinner/retry on restored cards.
- [ ] Empty `interactions[]` → transcript identical to text-only today.

### Backend Tests (pytest)
- [ ] `_events_to_interactions`: state_delta `mcp_app_context.*` event → interaction; stored `_label` used; generic fallback when absent.
- [ ] Cap + coalesce behaviour; `interactions_truncated` set when over cap.
- [ ] `_events_to_messages` output unchanged by the new code path (regression guard).
- [ ] `/messages` ownership gate still enforced; non-owner cannot read interactions.

### Manual Testing
- [ ] Boldkast: change v₀/θ, get a tutor reaction, reload → card + reaction both present, card before reaction.
- [ ] Two interactions between two tutor turns → both restore, in order, in the same gap.
- [ ] LED Planck / KineBot parity spot-check.
- [ ] Reload a text-only session (no sim use) → unchanged.

## Security Considerations

- **Untrusted label.** `label` originates from iframe-influenced client input. It is gated by the existing 7-gate iframe-context allowlist on write and capped (~200 chars), and **must be rendered as plain text** in `HumanToolUseCard` (React escapes by default — assert no `dangerouslySetInnerHTML`). It is never fed back into model context as an instruction (it already isn't; iframe-context content is namespaced data, not prompt — see [iframe_context_routes.py:47-51](../../../../backend/protocols/iframe_context_routes.py#L47-L51)).
- **No new data access / no egress.** Same `_require_session` ownership gate; data already in-session, inside the GCP project edge. The session owner already sees the chat; surfacing their own interactions adds no exposure. No data crosses the GCP boundary.

## Performance Considerations

- One extra parallel array on an existing fetch — no new round-trip. Cap (N≈200) + coalescing bounds payload and render cost for chatty sim sessions.
- Bundle: the seed/read-only path is a few hundred bytes of logic; no new dependency. Within the THIN CLIENT budget.

## Success Criteria

- [ ] All frontend tests passing (`npm run test:run`)
- [ ] All backend tests passing (`pytest tests/`)
- [ ] Lint and typecheck clean (`npm run quality:check`; `make lint && make test-fast`)
- [ ] On the **live deployed** dev session: a sim interaction restores as a read-only card, in order, with the tutor reaction following — verified by reload, not assumed.
- [ ] A no-interaction session reload is byte-identical to today.
- [ ] No regression to the live card lifecycle (pending → confirmed/failed) for fresh interactions.

## Open Questions

- **Label source:** persist the client label (recommended — faithful, no drift) vs. derive a generic label server-side from `structured_content` (no contract change, but loses the Danish per-sim phrasing). Doc recommends persisting; confirm with M if the contract addition is unwanted.
- **Failed interactions:** a live interaction that POSTs but 4xx/5xx's shows a `failed` card but is **not** persisted (no `append_event` on the error path). On reload these vanish. Acceptable? (They represent an action the tutor never saw — arguably correct to omit on restore.)
- **Cap value:** is N=200 interactions/session reasonable for a single lesson, or should it be lower for the shared-phone mobile case (couples to [mobile-performance-pass.md](mobile-performance-pass.md))?

## Related Documents

- [human-tool-use-cards.md](../v0.1.0-jutland/human-tool-use-cards.md) — the live card system this restores.
- [documents-workbench-surface.md](documents-workbench-surface.md) — same "aggregate from native ADK/AG-UI events, no new store" pattern (1.1.33).
- [teacher-ux-refinement.md](teacher-ux-refinement.md) — the broader teacher/student surface-coherence pass (1.1.32); this is the student-side reload-fidelity companion.
- [proactive-greet-refactor-to-path-b.md](proactive-greet-refactor-to-path-b.md) — the `[session_start]` / `[event_reactive:*]` sentinels distinguished from interaction events here.
- [mobile-performance-pass.md](mobile-performance-pass.md) — reload on shared phones is the common case; cap value couples here.
