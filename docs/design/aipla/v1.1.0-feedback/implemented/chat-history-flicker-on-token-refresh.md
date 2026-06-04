# Chat history bubbles flicker (disappear → reappear) on Firebase token refresh

**Status:** Implemented (shipped 2026-06-04)
**Priority:** P1 (bad UX — surfaces every ~hour for every active student)
**Estimated:** ~2-3h (frontend-only, ~5-15 LOC + a vitest)
**Actual:** ~1h wall-clock; 11 LOC impl in `AGUIProvider` + 3 new vitest cases (AGUIProvider) + 1 defensive vitest case (`useSessionMessages`). 906/906 frontend tests pass.
**Scope:** Frontend — `AGUIProvider` re-render policy on `user`/token changes; no backend changes
**Dependencies:** None at the data-layer level. Surfaces because of the [Agent Engine session backend](../../v1.0.0-pilot/implemented/session-persistence.md) decision (2026-06-03) — same latent bug existed pre-Agent-Engine but was masked by ~5 ms InMemorySessionService reads
**Created:** 2026-06-04
**Source:** observed on `https://aipla-v01-frontend-…/chat/@aipla-platform/problem-set-hints?session=2899c800-…` on 2026-06-04; traced via Cloud Logging + frontend source
**Upstream feedback:** see [docs/upstream-feedback.md entry #31](../../../../upstream-feedback.md) — the underlying anti-pattern exists in the inherited template and should be fixed there too

## Problem Statement

Students mid-conversation see the chat list **disappear briefly, then come back ~400 ms later** — most reliably on the "Earlier in this conversation" history block, sometimes on the live messages too. Both come back; nothing is lost. But the flicker is distracting and looks like a crash.

The trigger is Firebase ID-token refresh — which happens approximately hourly per active session, and additionally on every `onAuthStateChanged` fire that Firebase emits (anonymous-group identity hydration, tab focus, etc.).

The cause is a subtree unmount/remount cycle inside `AGUIProvider` whose latency-cost-to-the-user used to be ~5 ms (with `InMemorySessionService`) and is now ~400 ms (with `VertexAiSessionService` against Agent Engine in europe-west1, called from Cloud Run in europe-north1 — see [Decision 13 in bootstrap-aipla-dev.NOTES.md](../../../../scripts/bootstrap-aipla-dev.NOTES.md)). The change from invisible to visible flicker is purely a latency story; the root cause is an architectural anti-pattern in the provider that was already present in the inherited template.

**Current State:** ([frontend/src/providers/AGUIProvider.tsx:78-130](../../../../frontend/src/providers/AGUIProvider.tsx#L78-L130))

```tsx
// Effect re-runs on every `user` change (incl. token refresh)
useEffect(() => {
  if (authLoading) { setTokenResolved(false); return; }
  if (!user) { setToken(null); setTokenResolved(true); return; }

  setTokenResolved(false);            // ← BLANKS THE CHILDREN
  void fetchToken()
    .then((t) => setToken(t))
    .finally(() => setTokenResolved(true));
}, [authLoading, user, getIdToken, useTeacherAuth]);

// ... later:
if (!tokenResolved) {
  return /* loading spinner / nothing */;   // ← children get UNMOUNTED
}
```

Every time `user` changes (including silent token-refresh paths), the provider:

1. Sets `tokenResolved = false`.
2. Returns a loading branch instead of `children` → **entire subtree unmounts**.
3. Awaits `fetchToken()` (cheap — JWT swap, ~10-50 ms).
4. Sets `tokenResolved = true` → **subtree remounts**.

What gets caught in that remount:

- `useSessionMessages(sessionId)` — its local state is gone, so it refires `GET /api/sessions/{id}/messages`. That GET now hits Agent Engine in europe-west1 (~400 ms). During the window between mount and fetch return, `initialMessages = []` and the "Earlier in this conversation" block is rendered empty.
- `useSkillAgent` — its `messages` state is gone. The AGUIProvider also rebuilds the HttpAgent (`useMemo([skillId, token, sessionId])`), so the F1 guard in [useSkillAgent.ts:207-237](../../../../frontend/src/hooks/useSkillAgent.ts#L207-L237) sees `agentChanged=true` and yields a *legitimate* reset — `messages = []`. The live area goes blank until the new agent has events to render.

The combined effect: history bubbles vanish for ~400 ms, then come back when the GET returns. Live messages vanish until the next turn populates the new agent. This is the "chat entries disappear then reappear" report from 2026-06-04.

**Impact:**

- Every student, every hour, mid-conversation. Token-refresh is silent and unpredictable from the user's perspective.
- Worse on slow Vertex round-trips (cross-region) — but ALSO triggers any time `user` reference changes for unrelated reasons (auth state listeners firing on tab focus, etc.).
- Erodes trust in the platform at exactly the moment we want pilot teachers to see it as polished.

## Proposed Solution

**Don't unmount children on token refresh.** Gate the loading branch on `!token` (initial load — children would have nothing to talk to) instead of `!tokenResolved` (every refresh).

```tsx
// Track whether we've EVER had a token (i.e. past initial load).
const hadTokenOnceRef = useRef(false);
if (token) hadTokenOnceRef.current = true;

useEffect(() => {
  if (authLoading) {
    // Only gate on initial load, not on subsequent refreshes
    if (!hadTokenOnceRef.current) setTokenResolved(false);
    return;
  }
  if (!user) {
    setToken(null);
    setTokenResolved(true);
    return;
  }

  // Don't blank the subtree if we already have a working token — fetch
  // in the background, swap atomically when ready. This eliminates the
  // unmount/remount cycle on Firebase ID-token refresh that AIPLA's
  // 2026-06-04 chat-flicker report traced to.
  if (!hadTokenOnceRef.current) setTokenResolved(false);
  void fetchToken()
    .then((t) => { if (!cancelled) setToken(t); })
    .finally(() => { if (!cancelled) setTokenResolved(true); });
}, [authLoading, user, getIdToken, useTeacherAuth]);

// Gate is now first-load-only:
if (!tokenResolved && !hadTokenOnceRef.current) {
  return /* loading spinner / nothing */;
}
```

The HttpAgent's `useMemo([skillId, token, sessionId])` still rebuilds when `token` changes — that's correct, the new agent needs the new bearer header. But because children stay mounted across the swap, `useSessionMessages`'s state is preserved, no refetch fires, and `useSkillAgent`'s F1 guard correctly suppresses the visible-reset window (the agent identity DID change, so F1 allows reset; the live `messages` will still empty briefly, but for ~5 ms not ~400 ms, because we're not waiting on a Vertex call).

For the live-messages flicker we'd need a second small change — `useSkillAgent` could seed the new agent's `messages` from the previous agent's messages BEFORE the swap, so the live area doesn't empty at all. That's optional; the history-flicker is the user-visible bad one.

**Scope locks:**

- **In scope:**
  - `AGUIProvider`: gate `tokenResolved` blanking on initial load only (first ever token fetch).
  - Optional `useSkillAgent`: carry over `messages` from old agent → new agent on identity swap, so the live area doesn't blank either.
  - Vitest case: simulate `user` reference change with a stable token → assert children stay mounted, no GET refetch, no message-list reset.
- **Out of scope:**
  - Persisting `initialMessages` in a route-level cache. Useful in general but moot if AGUIProvider stops unmounting children — the fetch never refires.
  - Replacing the Vertex Agent Engine session backend. The fix should make the flicker invisible at any reasonable backend latency, not require sub-50 ms reads.
  - Co-locating Cloud Run + Agent Engine in the same region. Separate decision, separate doc (the cross-region tax is a real cost but fixing this anti-pattern is the right move regardless of region pinning).

## Acceptance Gates

- [ ] Open `?session=X` in browser → wait through a synthetic `user`-reference change (test fixture forces it) → "Earlier in this conversation" bubbles do NOT vanish.
- [ ] Live `messages` from in-flight turn do NOT vanish across the swap (only if the optional `useSkillAgent` carry-over lands).
- [ ] No additional `GET /api/sessions/{id}/messages` calls fire on token refresh (logged or asserted via vitest mock).
- [ ] HttpAgent IS rebuilt on token change (verify via `toolCalls` cleared check) — auth header swap is preserved.
- [ ] Initial app load still shows the loading branch correctly (first-token-ever path unchanged).
- [ ] `npm run quality:check` green.

## Risks

| Risk | Mitigation |
|---|---|
| The blanking-on-refresh was load-bearing somewhere (e.g. preventing a request from being sent with a stale token mid-flight) | Audit the `tokenResolved` gate's other consumers — there is only one (the AGUIProvider's own render). The HttpAgent's bearer header is updated atomically via the `useMemo` rebuild on `[token]` change, so in-flight POSTs to `/api/skill/.../stream` from the OLD agent use the OLD token (still valid for the next ~60 s of grace), and NEW POSTs use the NEW token. No request goes out without a token. The 2026-06-03 comment in AGUIProvider (block at lines 92-99) describes a real bug but conflates "blank the children" with "swap the agent" — the latter is the actual fix, the former is collateral. |
| Some test relies on the unmount cycle to reset state between user-identity events | None known; existing tests use `renderHook` and explicit unmount. The new vitest case pins the *correct* behaviour going forward. |

## Pre-implementation Verification

- [x] Traced the flicker to Cloud Logging entries for session `2899c800-…` on 2026-06-04 — pattern matches expectation.
- [x] Confirmed `emit_messages_snapshot=False` in ag_ui_adk usage — not the cause.
- [x] Confirmed Vertex `get_session()` is the slow leg (~400 ms cross-region) via direct curl latency probe of `/api/sessions/{id}/messages` on deployed dev.
- [x] Read the AGUIProvider's `tokenResolved` gate path + the AGUIProvider 2026-06-03 comment in detail — confirmed the gate IS the unmount trigger.
- [x] Read upstream-feedback.md for prior template-fix patterns and existing entries — slot is entry #31, new entry to be written alongside this design doc.

## Implementation Plan

Single FE-only sprint, no backend changes. Author + ship in one PR.

| # | What | Files | LOC est |
|---|---|---|---|
| M1 | `hadTokenOnceRef` + first-load-only gating in `AGUIProvider` | `frontend/src/providers/AGUIProvider.tsx` | ~10 |
| M2 | Vitest: render with mocked `user`, trigger a user-ref change with a stable token, assert no remount + no extra GET | `frontend/src/providers/__tests__/AGUIProvider.test.tsx` | ~50 |
| M3 | (Optional) Carry-over `messages` on agent identity swap in `useSkillAgent` to also kill the live-area flicker | `frontend/src/hooks/useSkillAgent.ts` + its tests | ~15 + ~30 |
| M4 | Update [upstream-feedback.md](../../../../upstream-feedback.md) entry #31 with the implemented fix; cross-link from there to this doc | `docs/upstream-feedback.md` | ~30 |

**Total:** ~135 LOC max (impl + tests + docs). ~2-3h wall-clock.

## Why this belongs in the template too

The `AGUIProvider` ships in the inherited `sunholo-data/ai-protocol-platform` template (see [frontend/src/providers/AGUIProvider.tsx](../../../../frontend/src/providers/AGUIProvider.tsx) — the file is essentially template-as-is plus AIPLA's 2026-06-03 group-auth additions). The unmount-on-token-refresh anti-pattern is in the template. Upstream Aitana doesn't observe the bug because its Cloud Run + Agent Engine sit in the same region (europe-west1), so the GET `/messages` round-trip is ~5-50 ms and the flicker window is below human perception.

But the anti-pattern itself is wrong even when it's invisible:

- A blank subtree mid-conversation is the wrong default, not just slow.
- Any downstream fork that hosts sessions in a different region than Cloud Run inherits the visible bug with no warning.
- Any downstream fork that swaps the SessionService backend for one with non-trivial latency (Spanner, an external DB, MCP-app-served sessions) hits the same.

The fix is small, surgical, and improves the template's default posture. Filed as upstream-feedback entry #31 with the same diff AIPLA ships.
