# Sprint Plan: HTU-PERSIST — Persist & restore MCP-app interaction cards on reload

## Summary
Restore MCP-app interaction cards (Boldkast / LED Planck / KineBot "Sendte spørgsmål med…") on chat reload by surfacing the ADK `state_delta` events that *already persist*, so a resumed transcript shows "student did X → tutor responded Y" instead of an unexplained AI reaction.

**Duration:** ~1.5–2 days
**Scope:** Fullstack
**Dependencies:** Live card system ([human-tool-use-cards.md](../v0.1.0-jutland/human-tool-use-cards.md)); 2026-06-16 reload-history hardening (`useEnteredViaResume`, proactive-sentinel filtering in `useSessionMessages`).
**Risk Level:** Low — additive + fail-soft; no new store; no change to the live dispatch path or `_events_to_messages`.
**Design Doc:** [human-tool-use-card-persistence.md](human-tool-use-card-persistence.md) (SEQUENCE 1.1.34)

## Current Status Analysis

### Recent Velocity
- ~143 commits / last 7 days; 292 files, +21.5k/-2.3k. This exact area (chat resume, sentinels, timestamps, reports) was touched repeatedly in the last week — high familiarity, low ramp-up.
- Recent comparable fullstack slices (1.1.4 session-report, 1.1.9 cost-dashboard) landed in ~1 day each with tests green.

### Existing Implementation (build on, don't reinvent)
- **Persisted already:** `POST /iframe-context` → `append_event(EventActions(state_delta={mcp_app_context.{server}.{tool}: value}))`, `author="user"`, `timestamp` ([iframe_context_routes.py:276-283](../../../../backend/protocols/iframe_context_routes.py#L276-L283)). Survives rejoin. Also `emit_workbench_event` → BigQuery.
- **Filtered out on read:** `_events_to_messages` is text-only (`if not e.content or not e.content.parts: continue`, [sessions_route.py:122](../../../../backend/protocols/sessions_route.py#L122)).
- **Client store is page-lifetime:** `useHumanToolEvents` `useState<HumanToolEvent[]>([])`, no restore ([useHumanToolEvents.ts:126](../../../../frontend/src/hooks/useHumanToolEvents.ts#L126)). Already interleaves by `afterMessageIndex` in `ChatMessageList`.
- **Label exists client-side:** all three sim hooks compute `pushedLabel` and call `dispatch({ label: pushedLabel, push: () => req })` ([useBoldkastSnapshot.ts:171](../../../../frontend/src/hooks/useBoldkastSnapshot.ts#L171), [useLedPlanckSnapshot.ts:198](../../../../frontend/src/hooks/useLedPlanckSnapshot.ts#L198), [useKineBotSnapshot.ts:203](../../../../frontend/src/hooks/useKineBotSnapshot.ts#L203)). The push request `req` is built via `useSimSnapshotPush` ([useSimSnapshotPush.ts:61](../../../../frontend/src/hooks/useSimSnapshotPush.ts#L61)).
- **Restore reader to extend:** `useSessionMessages` already fetches `/messages`, filters proactive sentinels, returns `initialMessages` ([useSessionMessages.ts](../../../../frontend/src/hooks/useSessionMessages.ts)).

## Proposed Milestones

### Milestone 1: Backend — persist label + surface interactions on read
**Scope:** backend
**Goal:** `GET /messages` returns a parallel `interactions[]` derived from the already-persisted `state_delta` events; the iframe-context write carries the client label.
**Estimated:** ~95 impl + ~70 tests = ~165 LOC
**Duration:** ~0.75 day

**Tasks:**
- [ ] Add optional `label: str | None` (alias `label`, `max_length=200`) to `IframeContextRequest`; store as `state_value["_label"] = body.label` in the handler before `append_event` (~15 LOC).
- [ ] `InteractionEvent` Pydantic model `{label: str, timestamp: float, server_id: str | None, tool_name: str | None}`; add `interactions: list[InteractionEvent] = []` and `interactions_truncated: bool = False` to `GetSessionMessagesResponse` (~20 LOC).
- [ ] `_events_to_interactions(events) -> tuple[list[InteractionEvent], bool]`: select events whose `actions.state_delta` has an `mcp_app_context.*` key; label from `_label` else generic fallback from `structured_content.changed`/`value`; parse `server_id`/`tool_name` from the key; coalesce consecutive identical `(label, server, tool)`; cap to most-recent N=200, set truncated flag (~55 LOC).
- [ ] Wire into `get_session_messages` (call alongside `_events_to_messages`; `_events_to_messages` UNCHANGED) (~5 LOC).
- [ ] pytest (`tests/api_tests/` + `tests/unit/`): state_delta event → interaction; `_label` used; no-label fallback; coalesce; cap + truncated flag; **regression: `_events_to_messages` output unchanged**; ownership gate still enforced (~70 LOC).

**Files to Create/Modify:**
- `backend/protocols/iframe_context_routes.py` (modify, ~15)
- `backend/protocols/sessions_route.py` (modify, ~80)
- `backend/tests/api_tests/test_sessions_route.py` (+ cases) and/or `backend/tests/unit/` (~70)

**Acceptance Criteria:**
- [ ] `/messages` returns `interactions[]` ordered by timestamp with correct labels for persisted sim interactions.
- [ ] No-label legacy events get a generic fallback label (no crash, no backfill needed).
- [ ] `_events_to_messages` is byte-identical (regression test green).
- [ ] `make lint && make test-fast` clean.

**Risks:**
- ADK event `actions`/`state_delta` access shape. Mitigation: mirror the existing `_count_sim_runs` / iframe-context write code that already reads these; guard with `getattr`.

### Milestone 2: Frontend — thread label + restore read-only cards
**Scope:** frontend
**Goal:** On reload, restored interactions render as read-only confirmed cards interleaved at the right point; live dispatch path untouched.
**Estimated:** ~95 impl + ~60 tests = ~155 LOC
**Duration:** ~0.75 day

**Tasks:**
- [ ] Thread `pushedLabel` into the iframe-context POST body: extend `useSimSnapshotPush` request builder to accept an optional `label` and include it in the JSON body; pass `pushedLabel` from the three sim hooks (reuse the value already computed for `dispatch`) (~30 LOC).
- [ ] `useSessionMessages`: parse `interactions[]` + `interactions_truncated`; map each `timestamp → afterMessageIndex` (count restored messages with `timestamp <= interaction.timestamp`); return `initialInteractions: RestoredInteraction[]` (+ truncated flag) (~30 LOC).
- [ ] `useHumanToolEvents`: add `seed(events)` (or `initialEvents` prop) loading **read-only confirmed** cards (status `"confirmed"`, no `push`, no pending hold); restored ids namespaced `htu-restored-…`; live `dispatch` untouched (~25 LOC).
- [ ] Chat page: seed the provider once on history load; render a quiet "earlier interactions hidden" marker when `interactions_truncated` (~10 LOC).
- [ ] `HumanToolUseCard`: read-only variant — no spinner, no retry — for restored cards (~5 LOC).
- [ ] vitest: `useSessionMessages` maps `afterMessageIndex` correctly; `seed()` loads read-only cards and a later live `dispatch` doesn't collide/clear; `ChatMessageList` interleaves restored cards at the right index with no retry affordance; empty `interactions[]` == today (~60 LOC).

**Files to Create/Modify:**
- `frontend/src/hooks/useSimSnapshotPush.ts` (modify, ~10)
- `frontend/src/hooks/useBoldkastSnapshot.ts`, `useLedPlanckSnapshot.ts`, `useKineBotSnapshot.ts` (modify, ~5 each)
- `frontend/src/hooks/useSessionMessages.ts` (modify, ~30)
- `frontend/src/hooks/useHumanToolEvents.ts` (modify, ~25)
- `frontend/src/components/chat/HumanToolUseCard.tsx` (modify, ~5)
- chat page (seed wiring, ~10)
- `__tests__` for the above (~60)

**Acceptance Criteria:**
- [ ] Reloading a session with sim interactions renders each as a read-only card in original order, before the tutor's reaction.
- [ ] Live dispatch still flows pending → confirmed/failed for fresh interactions.
- [ ] No-interaction session reload is unchanged.
- [ ] `npm run quality:check` clean (full — tests + build, per the CI-parity rule).

**Risks:**
- Provider seed-vs-live ordering (a live dispatch arriving mid-seed). Mitigation: namespaced restored ids + append semantics; covered by a vitest case.
- `afterMessageIndex` drift if a restored interaction timestamp equals a message timestamp. Mitigation: `<=` tie-break documented + tested.

### Milestone 3: Verify on the live deployed session
**Scope:** fullstack (verification)
**Goal:** Prove the fix on the deployed dev service, not just locally (per the 2026-06-16 reload-bug lesson: verify reload behaviour against the live deployment).
**Estimated:** ~0 LOC (manual + reuse existing smoke), ~0.25 day
**Duration:** ~0.25 day

**Tasks:**
- [ ] Deploy to dev (push to `dev`).
- [ ] On the deployed app: interact with Boldkast (change v₀/θ), get a tutor reaction, reload → confirm the card restores in order with the reaction following.
- [ ] Two interactions between two turns → both restore in order in the same gap.
- [ ] LED Planck / KineBot parity spot-check.
- [ ] Reload a text-only session → unchanged.

**Acceptance Criteria:**
- [ ] All five manual scenarios pass on the deployed dev service.
- [ ] No regression to the live card lifecycle.

**Risks:**
- Seed needed? No SKILL.md template change here, so no `make seed` required.

## Day-by-Day Breakdown

### Day 1
- **Focus:** M1 (backend) fully, then start M2 (label threading + `useSessionMessages` parse).
- **Checkpoint:** `/messages` returns `interactions[]` (verified by pytest + a curl against local); label rides the push body.

### Day 2 (half)
- **Focus:** Finish M2 (provider seed, read-only card, chat-page wiring, vitest); M3 deploy + live verify.
- **Checkpoint:** `npm run quality:check` + `make lint && make test-fast` green; deployed-dev reload shows restored cards.

## Quality Gates

After M1:
```bash
cd backend && make lint && make test-fast
```
After M2:
```bash
npm run quality:check      # full — tests + build (CI parity; NOT the :fast variant)
```
After M3:
```bash
git push   # dev → auto-deploy; then manual live verify
```

## Commit / Workflow Notes
- Commit directly to `dev` (no PRs — AIPLA workflow). Conventional commits (`feat(chat):`, `fix(chat):`).
- Backend CI parity = `make lint && make test-fast`; frontend CI parity = `npm run quality:check` (full).
- No seed needed (no SKILL.md template change).
