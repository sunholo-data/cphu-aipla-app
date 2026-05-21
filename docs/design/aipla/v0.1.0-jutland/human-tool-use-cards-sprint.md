# Sprint Plan: HTUC — human tool-use cards + bootstrap fix

## Summary
Closes the 2026-05-21 demo regression where the agent claimed it couldn't see workspace state (root cause: `iframe-context` POSTs returning 404 because `ChatSessionIndex` doesn't exist until the first chat turn) by combining the structural fix with a visible affordance — inline chat cards mirroring AI tool-use chips, surfacing student workspace actions in the transcript. Four milestones, sequencible 1-2-3-4. Each lands as its own commit. Target: EOD **2026-05-21 (Thu)** — same day as design doc.

**Duration:** ~6h core (M1+M2+M3+M4)
**Scope:** Fullstack — backend bootstrap endpoint + frontend cards/dispatch + CLI affordance
**Dependencies:** v0.1 shipped (`89bf7ee`); BoldkastSimFrame + ProgressChecklist with iframe-context push wired (`145515a`, `b2d62b8`); catch-up effect (`871b5d3`)
**Risk Level:** Low — additive changes only; bootstrap fix preserves the existing `before_agent_callback` path as a backstop
**Design Docs:**
- [human-tool-use-cards.md](human-tool-use-cards.md) — this sprint's source of truth
- [pedagogical-context-sprint.md](pedagogical-context-sprint.md) — upstream wiring this builds on
- [boldkast-mcp-app.md](boldkast-mcp-app.md) — the workspace surface generating events

## Current Status

### Recent Velocity (last 48h, post-v0.1-ship)
- `871b5d3` catch-up iframe-context push when sessionId arrives late
- `acbb5a7` mobile iframe sizing
- `d2be7b2` AppFooter + /privacy + /terms + /credits
- `85aa816` default tools opt-out (load_artifacts + memory)
- `a5058a3` mobile tab pattern
- `b2d62b8` ProgressChecklist observability wire
- `145515a` BoldkastSimFrame observability wire
- Pace: ~5-8 commits/day, sub-hour features, high test coverage

### What works (don't re-build)
- `iframe-context` route ([backend/protocols/iframe_context_routes.py](../../../../backend/protocols/iframe_context_routes.py)) with 7-gate auth; happy path verified in [test_workspace_observability.py](../../../../backend/tests/api_tests/test_workspace_observability.py)
- `wrap_with_iframe_context` InstructionProvider injecting `mcp_app_context.*` into prompt ([backend/adk/iframe_context.py](../../../../backend/adk/iframe_context.py))
- `BoldkastSimFrame` + `ProgressChecklist` POST snapshots with catch-up effect on late `sessionId` arrival
- `ToolCallChip` ([frontend/src/components/chat/ToolCallChip.tsx](../../../../frontend/src/components/chat/ToolCallChip.tsx)) renders agent tool-use as inline chips — the visual pattern to mirror
- `useSkillAgent` ([frontend/src/hooks/useSkillAgent.ts](../../../../frontend/src/hooks/useSkillAgent.ts)) owns `messages: SkillMessage[]` — the array we extend with a new event variant

### What's missing (this sprint's targets)
- Backend: `ChatSessionIndex` created only by `make_session_tracker.before_agent_callback` ([backend/adk/callbacks.py:487](../../../../backend/adk/callbacks.py#L487)) — iframe POSTs before first turn hit 404 (`.dev-logs/backend.log` evidence 2026-05-21)
- Frontend: no visible feedback when student workspace actions reach the agent — the chat is one-sided (agent's side only)
- Frontend: no client-side render path for non-agent transcript events (`SkillMessage` union currently only has `user` + `assistant`)
- DevX: workspace push debugging is a backend-log grep — no `aiplatform` CLI affordance to inspect `mcp_app_context.*` state

## Proposed Milestones

### M1: Session bootstrap endpoint + frontend wiring (`feat(sessions): bootstrap endpoint pre-creates ChatSessionIndex`)
**Scope:** fullstack
**Goal:** `POST /api/sessions/{id}/bootstrap` creates a `ChatSessionIndex` for an empty session ahead of the first chat turn. Frontend `useSkillAgent` fires this fire-and-forget when a session id first appears. Existing `before_agent_callback` stays as a backstop. Closes the 404 race for iframe-context + a2ui-surface-action POSTs alike.
**Estimated:** ~80 LOC backend (route + tests) + ~25 LOC frontend (hook call) + ~30 LOC test = ~135 LOC
**Duration:** 1.5h

**Tasks:**
- [ ] New file `backend/protocols/session_bootstrap_routes.py` — `POST /api/sessions/{session_id}/bootstrap` with body `{skillId: str}`. Returns 204 if created or already exists; 403 if skill doesn't exist or caller can't access it; 404 never (idempotent create).
- [ ] Mount the router in [backend/fast_api_app.py](../../../../backend/fast_api_app.py) alongside the existing iframe-context router.
- [ ] Implement using `db.chat_sessions.create_session_index` (existing) — check first via `get_session_index`, no-op if present.
- [ ] New test file `backend/tests/api_tests/test_session_bootstrap.py`:
  - [ ] `test_creates_session_index_for_workshop_user`
  - [ ] `test_is_idempotent` (second POST also 204, no extra Firestore writes)
  - [ ] `test_403_when_skill_does_not_exist`
  - [ ] `test_iframe_context_works_after_bootstrap_no_agent_turn` — the regression: bootstrap → iframe-context → 204 (was 404 pre-fix)
- [ ] Extend existing [test_workspace_observability.py](../../../../backend/tests/api_tests/test_workspace_observability.py) with a `test_e2e_without_bootstrap_call` to pin the `before_agent_callback` backstop (covers the case where the frontend bootstrap call fails)
- [ ] Frontend: in [frontend/src/hooks/useSkillAgent.ts](../../../../frontend/src/hooks/useSkillAgent.ts), after the agent instance settles and a session id is in hand, fire a one-shot `POST /api/proxy/api/sessions/{id}/bootstrap`. Errors logged, never thrown — the backstop covers failures.
- [ ] Vitest assertion in [useSkillAgent.test.ts](../../../../frontend/src/hooks/__tests__/useSkillAgent.test.ts) (or new file if absent) that the bootstrap POST fires exactly once per session-id mint.

**Files to Create/Modify:**
- `backend/protocols/session_bootstrap_routes.py` (new, ~50 LOC)
- `backend/tests/api_tests/test_session_bootstrap.py` (new, ~80 LOC)
- `backend/tests/api_tests/test_workspace_observability.py` (modify, +20 LOC)
- `backend/fast_api_app.py` (modify, +2 LOC router include)
- `frontend/src/hooks/useSkillAgent.ts` (modify, +25 LOC bootstrap effect)
- `frontend/src/hooks/__tests__/useSkillAgent.test.ts` or sibling (modify/new, +30 LOC)

**Acceptance Criteria:**
- [ ] `cd backend && uv run pytest tests/api_tests/test_session_bootstrap.py tests/api_tests/test_workspace_observability.py -q` — all pass
- [ ] `cd backend && make lint && make test-fast` — green
- [ ] `cd frontend && npm run quality:check` — green
- [ ] Local smoke: open chat in LOCAL_MODE, click ProgressChecklist before sending any message, check `.dev-logs/backend.log` — zero 404s from `/iframe-context`

**Risks:**
- The bootstrap call may race the first iframe-context push on slow networks. Mitigation: backstop in `before_agent_callback` is unchanged; if both fail, the catch-up effect re-pushes on the next click. Worst case is the failed-state card surfaces and disappears on the retry — visible degradation, not silent failure.
- `create_session_index` might require fields we don't have client-side (e.g. `documentIds`). Mitigation: bootstrap passes `documentIds=[]` + `turnCount=0`; the after-agent callback maintains these later.

---

### M2: HumanToolUseCard + useHumanToolEvents hook (`feat(chat): human tool-use cards mirror agent tool-call chips`)
**Scope:** frontend
**Goal:** Two new components — a chip-style `HumanToolUseCard` with pending/confirmed/failed states (matching `ToolCallChip`'s visual language), and a `useHumanToolEvents` hook that owns the dispatch flow. No wiring to workspace surfaces yet — that's M3. Comprehensive vitest first so M3 wiring lands clean.
**Estimated:** ~120 LOC component + ~80 LOC hook + ~100 LOC test = ~300 LOC
**Duration:** 2h

**Tasks:**
- [ ] Read [frontend/src/components/chat/ToolCallChip.tsx](../../../../frontend/src/components/chat/ToolCallChip.tsx) — match its shape (dimensions, padding, status enum).
- [ ] New `frontend/src/components/chat/HumanToolUseCard.tsx`. Props `{ label: string; status: "pending" | "confirmed" | "failed"; httpStatus?: number; detail?: string }`. Leading `User` icon from `lucide-react`. Trailing: `Loader2` (animate-spin) on pending, `Check` on confirmed, `AlertTriangle` on failed. `title` attribute on the chip carries `detail` + `httpStatus` for hover reveal. **No emoji** — per [feedback-no-emoticons](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md).
- [ ] Extend `SkillMessage` union in [useSkillAgent.ts](../../../../frontend/src/hooks/useSkillAgent.ts) with `{ role: "event"; id: string; label: string; status: "pending" | "confirmed" | "failed"; httpStatus?: number; detail?: string; t: number }`. The agent stream never emits these; only the dispatch hook does.
- [ ] New `frontend/src/hooks/useHumanToolEvents.ts`:
  - Exposes a React context provider + `useHumanToolEvents()` hook returning a `dispatch({ label, push }) => void` function
  - `dispatch` synchronously appends a pending `SkillMessage` event to the shared messages array, runs `push()`, and on resolution flips the status to confirmed (204) or failed (anything else)
  - 200 ms minimum pending duration so the success transition isn't a flash
- [ ] In [frontend/src/app/chat/[...path]/page.tsx](../../../../frontend/src/app/chat/[...path]/page.tsx), wrap the chat+workspace tree in `<HumanToolEventsProvider messages={messages} setMessages={setMessages}>` (or similar — exact wiring depends on where `messages` lives; reuse the `useSkillAgent` instance's setter).
- [ ] Modify [frontend/src/components/chat/MessageBubble.tsx](../../../../frontend/src/components/chat/MessageBubble.tsx) — when `message.role === "event"`, render `<HumanToolUseCard ...>` instead of the bubble+markdown. Left-anchored on the user's column side.
- [ ] New `frontend/src/components/chat/__tests__/HumanToolUseCard.test.tsx`:
  - renders pending/confirmed/failed visual states correctly
  - `title` attribute contains the `httpStatus` when failed
  - leading icon is `User` (assert by `aria-label` or test id)
- [ ] New `frontend/src/hooks/__tests__/useHumanToolEvents.test.tsx`:
  - dispatch synchronously appends a pending card
  - resolves to confirmed when push returns a 204 Response
  - resolves to failed with `httpStatus: 404` when push returns a 404 Response
  - resolves to failed with `detail: "network"` when push rejects (e.g. fetch throws)
  - min 200 ms pending hold even when push resolves instantly

**Files to Create/Modify:**
- `frontend/src/components/chat/HumanToolUseCard.tsx` (new, ~80 LOC)
- `frontend/src/hooks/useHumanToolEvents.ts` (new, ~100 LOC)
- `frontend/src/hooks/useSkillAgent.ts` (modify, ~15 LOC for SkillMessage union)
- `frontend/src/components/chat/MessageBubble.tsx` (modify, ~10 LOC render path)
- `frontend/src/app/chat/[...path]/page.tsx` (modify, ~10 LOC provider wrap)
- `frontend/src/components/chat/__tests__/HumanToolUseCard.test.tsx` (new, ~80 LOC)
- `frontend/src/hooks/__tests__/useHumanToolEvents.test.tsx` (new, ~120 LOC)

**Acceptance Criteria:**
- [ ] `cd frontend && npm run test:run -- HumanToolUseCard useHumanToolEvents` — all pass
- [ ] `cd frontend && npm run quality:check` — green
- [ ] No emoji introduced anywhere (`grep -rE "[👤🤖✓⏳⚠🔄📐📊]" frontend/src/components/chat/HumanToolUseCard.tsx frontend/src/hooks/useHumanToolEvents.ts` returns nothing)
- [ ] Visual diff in Storybook-style dev page if one exists, or manual eyeball in browser at `/chat/...`

**Risks:**
- `MessageBubble` currently assumes `role` is `user` or `assistant` and branches on that. Adding a third role may break exhaustive-narrowing assertions. Mitigation: add an early return for `role === "event"` at the top; everything else falls through unchanged.
- The provider may end up needing access to the same `setMessages` that `useSkillAgent` owns. Mitigation: pass the setter into the provider explicitly; resist the urge to refactor `useSkillAgent` to expose a more general API.

---

### M3: Wire BoldkastSimFrame + ProgressChecklist to dispatch (`feat(workspace): dispatch human-tool-use cards on student actions`)
**Scope:** frontend
**Goal:** Every iframe-context push from the two workspace surfaces dispatches a card. Existing push logic moves inside the dispatch hook's `push` closure so the card's success/failure mirrors the network reality 1:1.
**Estimated:** ~50 LOC delta across two component files + ~80 LOC test = ~130 LOC
**Duration:** 1h

**Tasks:**
- [ ] In [frontend/src/components/workspace/BoldkastSimFrame.tsx](../../../../frontend/src/components/workspace/BoldkastSimFrame.tsx), replace the direct `pushSnapshot(latestType)` calls with a `humanToolEvents.dispatch({ label: labelForBoldkastEvent(data), push: () => fetchWithAuth(...) })`. Same network call; new card.
- [ ] Label function (inline or in `BoldkastSimFrame.tsx`): map event type + marker / preset name to a Danish label per the design doc's table — `Afslørede y_max`, `Skiftede tyngdekraft til Månen`, etc. Skip `boldkast.open` (no card for surface opening).
- [ ] In [frontend/src/components/workspace/ProgressChecklist.tsx](../../../../frontend/src/components/workspace/ProgressChecklist.tsx), same pattern in `toggle()`. Label: `Markerede '<sublabel>' som klar` (toggle on) or `Fjernede '<sublabel>' fra klare` (toggle off).
- [ ] Catch-up effect: the catch-up POST from `871b5d3` also dispatches a card, label `Tidligere handlinger opdateret`.
- [ ] Update [ProgressChecklist.test.tsx](../../../../frontend/src/components/workspace/__tests__/ProgressChecklist.test.tsx): add a test that toggling an item calls the `humanToolEvents.dispatch` mock with the right label.
- [ ] Create `frontend/src/components/workspace/__tests__/BoldkastSimFrame.test.tsx` (no existing file): mount the iframe wrapper, send a synthetic `postMessage` with shape `{ source: "boldkast", type: "boldkast.show_value", marker: "y_max", revealed: true }`, assert dispatch is called with `label: "Afslørede y_max"`.

**Files to Create/Modify:**
- `frontend/src/components/workspace/BoldkastSimFrame.tsx` (modify, ~25 LOC delta + new labelFor helper)
- `frontend/src/components/workspace/ProgressChecklist.tsx` (modify, ~20 LOC delta)
- `frontend/src/components/workspace/__tests__/ProgressChecklist.test.tsx` (modify, +30 LOC)
- `frontend/src/components/workspace/__tests__/BoldkastSimFrame.test.tsx` (new, ~80 LOC)

**Acceptance Criteria:**
- [ ] `cd frontend && npm run test:run` — all pass (the two new/extended files + everything else)
- [ ] `cd frontend && npm run quality:check` — green
- [ ] Manual: open chat, click sim show-value for y_max → card appears in transcript with pending then confirmed icon; tick checklist item → card with Danish label appears
- [ ] Manual: stop backend, click checklist → card transitions to failed state, hover shows `network` or `404` detail
- [ ] `.dev-logs/backend.log` shows zero iframe-context 404s during the above (M1 bootstrap effect verified end-to-end)

**Risks:**
- The catch-up effect dispatches on `sessionId` arrival, which may fire AFTER the user has already left the page. Mitigation: only dispatch the catch-up card if the page is still mounted (the effect's cleanup already handles this since `pushSnapshot` is called synchronously inside the effect).
- BoldkastSimFrame doesn't currently have a vitest test file. Mitigation: starter test file is part of this milestone; doesn't try to test the actual iframe rendering, only the postMessage handling.

---

### M4: CLI dump + smoke (`feat(cli): aiplatform sessions iframe-context dumps mcp_app_context state`)
**Scope:** fullstack (backend GET + CLI)
**Goal:** A debug command that prints what the agent's next turn would see for a session — replaces the 2026-05-21 backend-log-grep workflow. Also extends the existing Jutland smoke script with a `--check-context` flag that exercises the full bootstrap + iframe-context + state-readback path.
**Estimated:** ~40 LOC backend GET + ~60 LOC CLI subcommand + ~30 LOC smoke shell + ~30 LOC test = ~160 LOC
**Duration:** 1.5h

**Tasks:**
- [ ] New `GET /api/sessions/{session_id}/iframe-context` endpoint (sibling to the existing POST) — returns the full set of `mcp_app_context.*` keys from ADK session state as a JSON object. Same 7-gate auth; same canonical APP_NAME lookup.
- [ ] Test in `test_session_bootstrap.py` or new `test_iframe_context_get.py`: bootstrap → POST iframe-context for boldkast → GET returns the boldkast key with the expected structuredContent.
- [ ] Locate `cli/aiplatform/` (or wherever sessions subcommands live). New subcommand `aiplatform sessions iframe-context <session_id>` — wraps a single httpx call to the GET above, pretty-prints with `rich` (or whatever the CLI already uses). Flags: `--tail` for SSE follow (optional, can defer if backend SSE adds complexity).
- [ ] Extend [scripts/smoke-jutland.sh](../../../../scripts/smoke-jutland.sh) (or equivalent) with `--check-context`: provision a fresh session via the existing smoke flow, POST bootstrap + iframe-context for boldkast and progress, GET the state, assert both keys present with expected shape, exit non-zero on any miss.
- [ ] Unit test for the CLI subcommand using Click's `CliRunner` with httpx mocked — assert correct endpoint hit + correct rendering.

**Files to Create/Modify:**
- `backend/protocols/iframe_context_routes.py` (modify, +30 LOC GET endpoint)
- `backend/tests/api_tests/test_iframe_context_routes.py` (modify, +30 LOC for GET tests)
- `cli/aiplatform/sessions.py` (modify, +60 LOC subcommand)
- `cli/tests/test_sessions_cli.py` (modify or new, +40 LOC)
- `scripts/smoke-jutland.sh` (modify, +30 LOC `--check-context` block)

**Acceptance Criteria:**
- [ ] `cd backend && uv run pytest tests/api_tests/test_iframe_context_routes.py -q` — passes including GET tests
- [ ] `cd backend && make lint && make test-fast` — green
- [ ] `aiplatform sessions iframe-context <a-real-local-session-id>` dumps the boldkast + progress structuredContent + `_pushedAt` timestamps for a populated session
- [ ] `bash scripts/smoke-jutland.sh --check-context` exits 0 against a running LOCAL_MODE backend
- [ ] `make cli-selftest` — passes

**Risks:**
- The GET endpoint is a new read surface for session state. Mitigation: same 7-gate auth as POST; reads only `mcp_app_context.*` keys (filters out anything else in session state to avoid leaking unrelated context).
- The CLI subcommand layout in `cli/aiplatform/` may differ from what I assume. Mitigation: read the existing `cli/aiplatform/__init__.py` or equivalent before adding subcommand; follow the pattern that's already there.

---

## Day-by-Day

This is sub-day work but ordering matters:

| Order | Milestone | Cumulative |
|---|---|---|
| 1 | M1 backend + frontend wiring + tests | ~1.5h |
| 2 | M2 components + hook + tests | ~3.5h |
| 3 | M3 wire workspace surfaces + tests | ~4.5h |
| 4 | M4 CLI + GET endpoint + smoke | ~6h |

M2 can theoretically start in parallel with M1 (different files), but M3 strictly depends on M2 having landed (it imports the hook), and the end-to-end manual verification depends on M1 having shipped (otherwise the cards all flip to `failed` for the wrong reason). Linear is cleaner.

## Success Metrics

After all four milestones:
- Zero iframe-context 404s in `.dev-logs/backend.log` across a fresh-session smoke run
- Visible card per workspace action with correct status transitions
- `aiplatform sessions iframe-context <id>` works end-to-end
- `make test-fast` (backend) + `npm run quality:check` (frontend) both green
- Demo workflow (open chat → tick checklist → reveal y_max → ask agent about it) results in the agent referencing the revealed state by name

## Out of Scope (deferred)

- A2UI surface-action route's identical 404 race (sibling bug, similar fix — separate PR after this lands, references [test_a2ui_surface_action_routes.py:155](../../../../backend/tests/api_tests/test_a2ui_surface_action_routes.py#L155))
- Bidirectional card editing (clicking a card to undo) — design doc explicitly defers
- i18n of card labels beyond Danish — v1
- `--tail` SSE flag on the CLI — can defer if backend SSE adds session-management complexity
- Storybook entries for the new card states — v1 design-system work

## Related Documents

- [human-tool-use-cards.md](human-tool-use-cards.md) — design doc this sprint executes
- [pedagogical-context-sprint.md](pedagogical-context-sprint.md) — sprint pattern to follow
- [mcp-app-update-model-context.md](../../v6.1.0/mcp-app-update-model-context.md) — upstream iframe-context design
- Memory: [feedback-no-emoticons](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md) — use lucide-react icons, no emoji
- Memory: [feedback-self-testable-loops](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_self_testable_loops.md) — backend test pinned the bootstrap race in M1
