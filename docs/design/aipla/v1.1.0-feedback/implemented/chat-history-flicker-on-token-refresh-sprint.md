# Sprint: CHAT-HISTORY-FLICKER — AGUIProvider keeps children mounted on token refresh

**Sprint ID:** `CHAT-HISTORY-FLICKER`
**Design doc:** [chat-history-flicker-on-token-refresh.md](chat-history-flicker-on-token-refresh.md)
**Branch:** direct-to-dev (per AIPLA workflow — no PR)
**Base commit:** `dev` HEAD as of 2026-06-04
**Estimate:** ~2-3h wall-clock
**Created:** 2026-06-04
**Status:** planned

## Sprint goal

Stop chat history bubbles vanishing for ~400 ms every time Firebase emits a `user`-reference change. Achieve this by gating `AGUIProvider`'s `tokenResolved=false` blanking on **initial load only** — subsequent refreshes fetch the new token in the background and atomically swap the HttpAgent without unmounting the subtree.

## Scope locks

**In scope:**
- `frontend/src/providers/AGUIProvider.tsx` — add `hadTokenOnceRef`; gate the loading-branch return on `(!tokenResolved && !hadTokenOnceRef.current)`; don't flip `tokenResolved` back to `false` on subsequent refreshes if we already had a token.
- `frontend/src/providers/__tests__/AGUIProvider.test.tsx` — new vitest case: simulate a `user`-reference change with a stable token via `renderHook` + provider rebinding; assert (a) the provider's render output stays stable (children not unmounted), (b) the HttpAgent IS rebuilt (new bearer header reaches it via `useMemo([token])`), (c) no `Authorization`-less requests are observed.
- `frontend/src/hooks/__tests__/useSessionMessages.test.ts` — defensive add: assert the hook does NOT refire its GET when the parent provider re-renders without changing `sessionId`. This pins the fix from the consumer side too.

**Out of scope:**
- Optional M3 from the design doc (carry over `messages` from old agent → new agent on identity swap to also kill the live-area flicker). Defer to a follow-up if the history-flicker fix alone isn't perceived as sufficient — the live area only blanks for ~5 ms with this fix (no Vertex call in critical path), so it likely won't be visible.
- Persisting `initialMessages` in a route-level cache. Moot once children stop unmounting.
- Backend changes. Pure FE refactor.
- Co-locating Cloud Run + Agent Engine. Separate discussion (see [bootstrap-aipla-dev.NOTES.md Decision 13](../../../../scripts/bootstrap-aipla-dev.NOTES.md)).

## Workflow

Direct-to-dev. Branch `dev`. Commit + push when M1+M2 are green.

## Milestones

| # | What | Files | LOC est |
|---|---|---|---|
| M1 | `hadTokenOnceRef` + first-load-only gating in `AGUIProvider` + cancellation hygiene check | `frontend/src/providers/AGUIProvider.tsx` | ~15 |
| M2 | Vitest: stable-token user-ref change does not unmount; HttpAgent IS rebuilt on token change; no Auth-less request | `frontend/src/providers/__tests__/AGUIProvider.test.tsx` | ~60 |
| M3 | Defensive vitest: `useSessionMessages` does not refire GET when provider re-renders without sessionId change | `frontend/src/hooks/__tests__/useSessionMessages.test.ts` | ~30 |
| M4 | Frontend CI parity (`npm run quality:check`); commit + push | — | — |

**Total:** ~105 LOC max (impl + tests). ~2-3h wall-clock.

## Acceptance gates

- [ ] `npm run quality:check` (full — lint + typecheck + vitest) green from `frontend/`
- [ ] New vitest case in M2 passes; existing AGUIProvider tests still pass
- [ ] New vitest case in M3 passes
- [ ] Manual smoke against deployed dev: open a chat session URL, wait/force a token refresh via DevTools (`firebase.auth().currentUser.getIdToken(true)` in the console), confirm history bubbles do NOT visibly disappear. (If we can't easily force a refresh from the console, defer to natural ~hourly observation — vitest is the durable gate.)
- [ ] No new `GET /api/sessions/{id}/messages` calls in Cloud Logging for the session over the refresh window (one before, one after the refresh would be a regression — should be just the one on mount)
- [ ] [upstream-feedback.md entry #31](../../../../upstream-feedback.md) cross-link from this sprint doc lands ✓ (already shipped in the doc-prep commit `4b953dd` follow-up)

## Risks

| Risk | Mitigation |
|---|---|
| Cancellation: the in-flight `fetchToken().then(...)` from a previous run could still race a newer one and write a stale token | The existing `let cancelled = false; ... return () => { cancelled = true; };` cleanup pattern already guards this. M1 keeps that pattern intact. Vitest case verifies that two back-to-back user-ref changes don't write the older token. |
| The `tokenResolved` gate is load-bearing for some other render path | Audited — there is only one render-time consumer (the AGUIProvider's own return). The HttpAgent's bearer header swap is independent and stays correct via `useMemo([skillId, token, sessionId])`. |
| Vitest can't easily provoke a `user`-reference change without remounting | `renderHook` with a `wrapper` and `rerender({newWrapper})` does this — the test pattern is already used in [test_workspace_observability.py](../../../../../backend/tests/api_tests/test_workspace_observability.py) (backend example) and in vitest tests elsewhere in `frontend/src/providers/__tests__/`. |

## Dependencies

- 1.F session-persistence [shipped 2026-06-01](../../v1.0.0-pilot/implemented/session-persistence.md) — provides the GET /messages endpoint that was the symptomatic slow path
- Vertex Agent Engine session backend [shipped 2026-06-03](../../../../scripts/bootstrap-aipla-dev.NOTES.md) — surfaced the latency that made the flicker visible

## Out of scope (do NOT start)

- Live-messages carry-over across agent swap (optional M3 from the design doc; revisit if needed after this lands)
- Route-level `initialMessages` cache
- Cloud Run region migration
- Backend session-restore route changes
- Upstream PR filing — that's a follow-up phase, separate from this sprint

## Verification handoff

When sprint completes:
1. Commit message: `fix(frontend): AGUIProvider keeps children mounted across token refresh`
2. Cross-link the commit SHA into [chat-history-flicker-on-token-refresh.md](chat-history-flicker-on-token-refresh.md) status (planned → implemented).
3. Move the design doc into `implemented/` subfolder per convention.
4. Update SEQUENCE.md row 1.1.14 status from "planned" to "shipped YYYY-MM-DD".
