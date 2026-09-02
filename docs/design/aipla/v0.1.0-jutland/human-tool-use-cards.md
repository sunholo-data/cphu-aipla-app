# Human tool-use cards — visible chat affordances for student workspace actions

**Status**: Planned
**Priority**: P1 (blocks the Jutland demo's "agent reacts to student actions" narrative)
**Estimated**: 0.75 day (0.4 frontend cards · 0.2 backend bootstrap fix · 0.15 tests + smoke)
**Scope**: Frontend + small backend callback move
**Dependencies**: [boldkast-mcp-app.md](boldkast-mcp-app.md) (the surface generating events), [pedagogical-context-sprint.md](pedagogical-context-sprint.md) (iframe-context endpoint)
**Created**: 2026-05-21
**Last Updated**: 2026-05-21

## Problem Statement

v0.1 wires two workspace surfaces (BoldkastSimFrame, ProgressChecklist) to the `iframe-context` endpoint, so the agent's next turn *should* see what the student clicked. Live evidence on 2026-05-21 says it doesn't:

- A student tutor screenshot shows the agent answering "I can't see your screen or the values you've entered" after the student ticked a checklist item and revealed `y_max` in the sim.
- Backend log: 6× `POST /api/sessions/.../iframe-context HTTP/1.1" 404 Not Found` — POSTs are firing (frontend wiring is correct, the catch-up effect from `871b5d3` works) but the route returns 404 because **`_require_session` can't find a `ChatSessionIndex` for the session id**.
- Cause: `ChatSessionIndex` is created lazily in `make_session_tracker`'s `before_agent_callback` ([backend/adk/callbacks.py:487](../../../../backend/adk/callbacks.py#L487)) — it only exists *after the first chat turn*. The frontend mints the session id client-side and starts pushing context the moment the student clicks anything. Chicken-and-egg.

The bug is one cause of "agent claims it can't see workspace state", but the deeper problem is **visibility**:

- The student has no signal their click was registered by anything. The checkmark goes on, but they don't know whether the AI tutor was told.
- The dev/debug surface is invisible — to know whether a push fired, I had to grep backend logs after the fact.
- The chat already renders AI tool-use as inline chips ([ToolCallChip.tsx](../../../../frontend/src/components/chat/ToolCallChip.tsx)). The symmetric "this is what the human just did" affordance is missing. Without it, the chat transcript is a half-record — only the agent's side of the interaction.

**Impact (if not built):**
- Jutland demo continues to have the screenshot failure mode visible on the projector.
- Debug cycles waste M's time as the only verification surface (the [feedback-self-testable-loops](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_self_testable_loops.md) memory's whole point).
- Future workspace widgets (v1 energy sim, friction sim, free-body diagrams) inherit the same invisibility — the cost compounds.

## Goals

**Primary Goal:** Every iframe-context push from a workspace surface renders an inline card in the chat transcript at the moment of the click, with a chip-style status indicator that transitions `pending → confirmed | failed`. The card shows what the student did (Danish label + brief value), is visually distinct from agent messages, and is anchored to the next user turn so the agent's reply lands directly under the action it's reacting to.

**Success Metrics:**
- **Visibility:** Every Boldkast `show_value` / preset-click and every ProgressChecklist toggle produces an inline card within 100 ms of the click — no perceptible lag relative to the checkmark itself.
- **Status fidelity:** Card transitions to `confirmed` (Check icon) when the POST returns 204, `failed` (AlertTriangle icon) when it returns 4xx/5xx, with the HTTP status visible on hover. A failed card is what would have surfaced the 2026-05-21 404 in 30 seconds instead of an hour of log-grepping.
- **Bootstrap fix:** Zero 404s from `iframe-context` POSTs in `.dev-logs/backend.log` across a fresh-session smoke test (`scripts/smoke-jutland.sh --check-context`).
- **Agent symmetry:** Chat transcript reads coherently when copy-pasted — `[You: Markerede 'a' som klar]` followed by the agent's reply makes the cause-and-effect explicit for screenshots / bug reports / pedagogical research review.

**Non-Goals:**
- Cards for *every* iframe message — only the pushed (pedagogically meaningful) subset. Slider drags stay silent; preset clicks and marker reveals appear.
- Bidirectional editing (clicking the card to undo an action). Each card is read-only; un-toggling on the source widget produces a *new* card (`Fjernede 'a' fra klare`) — additive history.
- Persisting cards across reloads. They live in the same client-side `SkillMessage[]` as everything else; refresh clears them.
- A new AG-UI event type. The card is a *client-side* synthetic message — never serialized to the agent stream — because the agent already gets the same info via the iframe-context InstructionProvider injection. Avoid double-counting in the prompt.

## Axiom Alignment

Scored per [docs/product-axioms.md](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Card renders synchronously on click, before the network round-trip. Status updates async but the affordance is immediate |
| 2 | EARNED TRUST | +1 | Student literally sees that their click was noted. "Did the AI know?" becomes a visible truth, not a guess. Failed-push state makes errors honest instead of silent |
| 3 | SKILLS, NOT FEATURES | 0 | Cards aren't a skill-config concept yet (v1 might add `skillMetadata.humanToolCards` to filter which actions render). Honest neutral for v0.1 |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model in this path |
| 5 | GRACEFUL DEGRADATION | +1 | If the POST fails, the workspace UI still works locally — the card surfaces the failure but doesn't block the student. Agent loses that turn's context but next turn re-syncs |
| 6 | PROTOCOL OVER CUSTOM | 0 | Cards are pure client-side `SkillMessage` rows — no new wire protocol. Reuses the same render slot as `ToolCallChip` with a different icon. Neutral because there's no standard for "human tool-use UI" to adopt either |
| 7 | API FIRST | +1 | The bootstrap fix exposes `POST /api/sessions/{id}/bootstrap` (or pre-creates on session-id mint) so the iframe-context endpoint stops being conditional on agent-turn ordering. Also adds `aiplatform sessions iframe-context <id> --tail` for log-free inspection |
| 8 | OBSERVABLE BY DEFAULT | +1 | The cards ARE the observability — visible to student, demo viewer, and (via screenshot) anyone reviewing the session afterwards. Plus the CLI affordance for backend inspection |
| 9 | SECURE BY CONSTRUCTION | 0 | Cards display structured content already vetted by the iframe-context 4 KB size cap + per-server allow_context_writes gate. No new attack surface. Neutral |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Cards are pure client UI; the wire shape doesn't change. Symmetric thinness vs ToolCallChip — neither pulls extra logic into the client |
| | **Net Score** | **+5** | Threshold >= +4 OK |

**Conflict Justifications:** None — no -1 scores. The five 0s are honest neutrals.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| Chat transcript event shape | Existing `SkillMessage` (internal — no spec for "human tool-use" exists in AG-UI/A2UI/MCP) | Add a `role: "event"` variant alongside `user`/`assistant`. Pure UI concept, never crosses the wire |
| Card visual language | Reuse `ToolCallChip.tsx` patterns | Same chip dimensions, same status states (running/success/error), different leading icon (`User` for human, `Bot` for agent — both from `lucide-react`) |
| Status transitions | Match the existing `ToolCallState.status` enum (`running`/`success`/`error`) | One status enum across both card types — keeps the renderer code shared |
| Iframe → host event bus | Existing `postMessage` bridge from [BoldkastSimFrame.tsx](../../../../frontend/src/components/workspace/BoldkastSimFrame.tsx) | No new channel — the card is dispatched by the same handler that calls `fetchWithAuth` |
| Session bootstrap | ADK `SessionService.create_session` + Firestore `ChatSessionIndex` mirror | Move bootstrap from `before_agent_callback` to the session-id mint path (frontend's first hook call), so it exists before any iframe-context POST can race it |

**No custom protocols introduced.** AG-UI/A2UI/MCP don't speak to "render human actions in the transcript" because that's a client-side concern. We stay within existing in-repo shapes.

## CLI Surface

Per [design-doc-creator skill 5b-bis](../../../../.claude/skills/design-doc-creator/SKILL.md), every developer-facing surface needs a CLI affordance. The 2026-05-21 debug session was a backend-log-grep — exactly the kind of thing a CLI command should replace.

| Command | Purpose | Position in tree |
|---|---|---|
| `aiplatform sessions iframe-context <session_id>` | Dump all `mcp_app_context.*` keys currently in ADK session state — see exactly what the agent's next turn will receive, by server.tool, with `_pushedAt` timestamps | new under existing `aiplatform sessions` |
| `aiplatform sessions iframe-context <session_id> --tail` | Stream pushes as they happen (server-sent events over the same endpoint backend; for live debug during a workshop) | extends the above |
| `aiplatform smoke jutland --check-context` | Fresh session → POST iframe-context for boldkast + progress → assert 204 (not 404) → assert state visible via the dump command above. Pins the bootstrap fix | extends [scripts/smoke-jutland.sh](../../../../scripts/smoke-jutland.sh) |

Estimate: **0.2 day** total (one new Click subcommand wrapping a backend GET that lists state keys, plus a smoke-script extension).

## Design

### Architecture overview

```
┌────────────────────────────────────────────────────────────────────┐
│ Browser                                                            │
│ ┌──────────────────────┐    ┌─────────────────────────────────┐    │
│ │  workspace surface   │    │  chat (SkillMessage[])           │    │
│ │  ──────────────────  │    │  ─────────────────────────       │    │
│ │  ProgressChecklist   │    │  [You: Markerede 'a' klar]  OK   │    │
│ │     onToggle ─────────────────► dispatch synthetic event    │    │
│ │  BoldkastSimFrame    │    │  [You: Afslørede y_max]    .... │    │
│ │     onShowValue ──────────────► dispatch synthetic event    │    │
│ │                      │    │  (status flips to OK on 204)   │    │
│ └──────────┬───────────┘    │                                  │    │
│            │ fetchWithAuth   │  ┌─ assistant ─────────────────┐ │    │
│            ▼                 │  │ "Great — what range did you │ │    │
│   POST /iframe-context       │  │  get for y_max?"            │ │    │
│            │                 │  └────────────────────────────┘ │    │
│            ▼                 └─────────────────────────────────┘    │
│   pre-existing route                                                 │
└─────────────┬───────────────────────────────────────────────────────┘
              │                                              ▲
              ▼                                              │
      ADK session state                                      │
      mcp_app_context.boldkast.state      ────► InstructionProvider
      mcp_app_context.progress.state      ────► appends to prompt
              ▲
              │ MUST EXIST BEFORE FIRST POST
              │
      ChatSessionIndex (Firestore)
              ▲
              │ created on:
              │  (current) before_agent_callback ← causes 404
              │  (new)     useSkillAgent mount    ← race-free
```

### Frontend

**New files:**

- `frontend/src/components/chat/HumanToolUseCard.tsx` — chip-style component, mirrors `ToolCallChip` shape. Props: `{ label: string; status: "pending" | "confirmed" | "failed"; httpStatus?: number; detail?: string }`. Leading `User` icon (from `lucide-react`); trailing `Loader2` (pending, with `animate-spin`) / `Check` (confirmed) / `AlertTriangle` (failed). Hover reveals `detail` + `httpStatus`.
- `frontend/src/hooks/useHumanToolEvents.ts` — registers a function on a React context that `BoldkastSimFrame` and `ProgressChecklist` can call to dispatch a card. Signature: `dispatch({ label, push: () => Promise<Response> })` — the hook owns the status transitions; callers don't manage state.

**Modified files:**

- `frontend/src/hooks/useSkillAgent.ts` — `SkillMessage` union gains a third variant `{ role: "event"; id: string; label: string; status: ...; httpStatus?: number }`. The agent stream **never produces these** — only `useHumanToolEvents.dispatch` does.
- `frontend/src/components/chat/MessageBubble.tsx` — when `message.role === "event"`, render `HumanToolUseCard` instead of bubble + markdown. No avatar; left-anchored on the user's side of the column.
- `frontend/src/components/workspace/BoldkastSimFrame.tsx` — wrap each `pushSnapshot(latestType)` call in `humanToolEvents.dispatch({ label: labelFor(data), push: () => pushSnapshot(latestType) })`. Existing logic moves inside the `push` closure.
- `frontend/src/components/workspace/ProgressChecklist.tsx` — wrap the `toggle()` call's `pushSnapshot(next)` the same way. Label is the item's Danish text (`Markerede '<label>' som klar` / `Fjernede '<label>' fra klare`).
- `frontend/src/app/chat/[...path]/page.tsx` — provide the `HumanToolEventsContext` at the page level so both the chat and workspace columns share one dispatch.

**Danish labels (v0.1; v1 i18n):**

| Event | Label |
|---|---|
| ProgressChecklist toggle on | `Markerede '<sublabel>' som klar` |
| ProgressChecklist toggle off | `Fjernede '<sublabel>' fra klare` |
| Boldkast show_value reveal | `Afslørede <marker>` (e.g. `Afslørede y_max`) |
| Boldkast preset click | `Skiftede tyngdekraft til <planet>` (e.g. `Skiftede tyngdekraft til Månen`) |
| Boldkast open | (skipped — surface opening is not a pedagogical action) |

### Backend — bootstrap fix

**The fix:** `ChatSessionIndex` must exist before the first iframe-context POST can race the first chat turn. Move creation out of `make_session_tracker`'s `before_agent_callback` and into either:

**Option A (chosen)** — pre-create on session-id mint, via a new `POST /api/sessions/{id}/bootstrap` endpoint that the frontend calls when `useSkillAgent` first mounts. Idempotent: returns 204 if already exists. Frontend calls it once per session-id mint, before any iframe-context POST can fire.

**Option B (rejected)** — backstop the iframe-context route: if the index is missing, create it on-the-fly. *Rejected* because (a) it spreads creation logic across two callsites, (b) doesn't help A2UI surface-action POSTs which have the same race ([sibling fix 2026-05-18](../../../../backend/protocols/a2ui_surface_action_routes.py)), and (c) hides the race instead of fixing the ordering.

**Modified files:**

- `backend/protocols/sessions_routes.py` (new file or extend existing `sessions_route.py`) — `POST /api/sessions/{id}/bootstrap` body `{skillId}`. Creates `ChatSessionIndex` (or returns 204 if exists). Same auth gates as the existing chat-turn path.
- `backend/adk/callbacks.py` — `make_session_tracker.before_agent_callback` becomes idempotent and a backstop only; if `get_session_index(session_id)` returns None at agent-turn time, it still creates one (covers the case where the frontend's bootstrap call fails). Belt and braces.
- `frontend/src/hooks/useSkillAgent.ts` — on agent mount or session-id change, fire-and-forget `fetch("/api/proxy/api/sessions/{id}/bootstrap", { method: "POST", body: { skillId } })`. Errors are logged but don't block the agent — the backstop above handles it.

This intentionally **does not** require iframe-context to wait for bootstrap completion; the workspace can push immediately. The bootstrap POST is fast (single Firestore write) and the iframe-context POST hits the route slightly later in practice. If the bootstrap call hasn't completed before the first iframe push lands, the POST returns 404 once and the catch-up effect in [BoldkastSimFrame.tsx](../../../../frontend/src/components/workspace/BoldkastSimFrame.tsx)/[ProgressChecklist.tsx](../../../../frontend/src/components/workspace/ProgressChecklist.tsx) retries on the next interaction — which is exactly the pattern we already shipped. The human-tool-use card status indicator will visibly show this "first push raced bootstrap, retried" path (failed card followed by a confirmed one) if it happens.

### Coupling to iframe-context

The card is dispatched **regardless** of whether the iframe-context POST succeeds. Three states:

1. **Pending** (`role: "event"`, `status: "pending"`): card renders the moment the workspace action fires.
2. **Confirmed** (`status: "confirmed"`): POST returns 204. The agent's next turn will see the state.
3. **Failed** (`status: "failed"`, `httpStatus: 404`): POST failed. The agent's next turn will NOT see the state. Card shows the warning + status code; student knows the AI didn't catch this one.

The pending state stays visible for at least 200 ms even on instant success, so the transition isn't a flash — visible-success > invisible-success for UX confidence.

## Testing Strategy

Following the [feedback-self-testable-loops](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_self_testable_loops.md) principle — Claude should be able to iterate without M clicking around.

**Backend pytest (`make test-fast`):**

- `backend/tests/api_tests/test_session_bootstrap.py` (new):
  - `test_bootstrap_creates_session_index`
  - `test_bootstrap_is_idempotent` (POST twice → 204 both times, single index row)
  - `test_iframe_context_works_after_bootstrap_no_agent_turn` — the exact regression: POST bootstrap → POST iframe-context → assert 204 (was 404 before fix)
  - `test_iframe_context_backstop_creates_index_if_bootstrap_missed` — covers the belt-and-braces path
- Extend [test_workspace_observability.py](../../../../backend/tests/api_tests/test_workspace_observability.py) with a `test_e2e_without_bootstrap_call` to pin Option-B-style backstop behaviour even though we chose Option A.

**Frontend vitest (`npm run test:run`):**

- `frontend/src/components/chat/__tests__/HumanToolUseCard.test.tsx` (new): render shape for each status, hover detail.
- `frontend/src/hooks/__tests__/useHumanToolEvents.test.tsx` (new):
  - dispatch creates a pending card immediately
  - resolves to confirmed on 204
  - resolves to failed on 4xx/5xx with `httpStatus` captured
  - min 200 ms pending state holds even on instant success
- Extend [ProgressChecklist.test.tsx](../../../../frontend/src/components/workspace/__tests__/ProgressChecklist.test.tsx) with: toggling dispatches a card with the correct Danish label.
- Extend an equivalent test file for BoldkastSimFrame (none exists yet — add one).

**Smoke:** `scripts/smoke-jutland.sh --check-context` (extends existing): fresh session → bootstrap → POST iframe-context for boldkast + progress → assert both return 204 → dump state via the new CLI command → assert both keys present.

**Manual verification (last, not only):** open chat with `problem-set-hints`, tick checklist item, watch the card appear with the pending spinner then the check icon. Refresh forcibly to the bootstrap-race window; confirm card shows the failed-state icon with `404` on hover; tick again; second card shows the check icon.

## Migration / Rollout

- **No data migration.** `ChatSessionIndex` schema unchanged; bootstrap just creates the existing doc shape earlier in the lifecycle.
- **Feature flag:** none. The card is a pure UI addition with no fallback path that would justify gating. If it breaks, it breaks visibly and we ship `git revert`.
- **Rollback:** if Option A causes unexpected load (it shouldn't — one extra Firestore write per session), revert the frontend bootstrap call and rely on `before_agent_callback`'s existing creation path. The backstop in `make_session_tracker` is unchanged from today's behaviour, so rollback is purely additive removal.

## Implementation Plan

| Step | What | Where | Est |
|---|---|---|---|
| 1 | Backend bootstrap endpoint + tests | `backend/protocols/sessions_routes.py`, `backend/tests/api_tests/test_session_bootstrap.py` | 0.15 d |
| 2 | Frontend bootstrap call in `useSkillAgent` | `frontend/src/hooks/useSkillAgent.ts` | 0.05 d |
| 3 | `HumanToolUseCard` + `useHumanToolEvents` + tests | new files under `frontend/src/components/chat/`, `frontend/src/hooks/` | 0.2 d |
| 4 | `SkillMessage` event variant + `MessageBubble` render path | `frontend/src/hooks/useSkillAgent.ts`, `frontend/src/components/chat/MessageBubble.tsx` | 0.1 d |
| 5 | Wire `BoldkastSimFrame` + `ProgressChecklist` to dispatch | existing component files | 0.1 d |
| 6 | CLI `sessions iframe-context` dump | `cli/aiplatform/sessions.py` | 0.1 d |
| 7 | Smoke script `--check-context` flag + dev verification | `scripts/smoke-jutland.sh` | 0.05 d |
| | **Total** | | **0.75 d** |

## Success Criteria

- [ ] Backend test `test_iframe_context_works_after_bootstrap_no_agent_turn` passes — no 404 race possible.
- [ ] `make test-fast` green; new tests included.
- [ ] Frontend vitest green; `useHumanToolEvents` covers all three card states.
- [ ] `.dev-logs/backend.log` shows zero 404s from `iframe-context` POST during a fresh-session smoke run.
- [ ] Manual demo path: open chat, click checklist, see pending-spinner then confirmed-check card with Danish label.
- [ ] Manual demo path: open chat, click sim "Show value" for `y_max`, see `Afslørede y_max` card transition pending then confirmed.
- [ ] On purpose-broken backend (stop the backend service, click checklist), card surfaces failed-state icon plus `network` detail on hover instead of failing silently.
- [ ] CLI: `aiplatform sessions iframe-context <session_id>` dumps `mcp_app_context.boldkast.state` and `mcp_app_context.progress.state` for a populated session.
- [ ] Repeat of the 2026-05-21 screenshot scenario: agent's reply directly references `y_max` (or asks specifically about it) within 1 turn of the reveal click — verified manually by AR sign-off before 2026-05-26.

## Related Documents

- [boldkast-mcp-app.md](boldkast-mcp-app.md) — the sim surface generating these events
- [pedagogical-context-sprint.md](pedagogical-context-sprint.md) — the iframe-context endpoint + InstructionProvider this depends on
- [mcp-app-update-model-context.md](../../v6.1.0/mcp-app-update-model-context.md) — upstream design for the iframe-context endpoint (the seven-gate auth model)
- [local-dev-cli.md](../../v6.1.0/local-dev-cli.md) — `aiplatform` CLI conventions for the new `sessions iframe-context` subcommand
- [ADR-013](../_scoping-snapshot/architecture.qmd#adr-013-artefact-safety-content-review-pipeline-for-generated-html) — sandbox iframe constraints (cards are host-side so unaffected, but the events they reflect come from sandboxed surfaces)
- [ADR-015](../_scoping-snapshot/architecture.qmd#adr-015-unified-multi-surface-ui-ai-directs-the-layout) — multi-surface UI; cards are the `chat`-surface mirror of `workspace`-surface actions
- Memory: [feedback-self-testable-loops](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_self_testable_loops.md) — why this doc has a backend pytest first, manual verification last
