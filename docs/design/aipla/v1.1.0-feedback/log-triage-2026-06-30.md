# Dev log triage — platform-hardening bug inventory

**Status:** Triaged from live dev logs; **fixes deferred to post-freeze (07-06+)** — freeze week, no merges
**Date:** 2026-06-30
**Method:** `gcloud logging read` over the `aipla-v01-frontend` service (`aipla-dev-2026`), 7-day window; non-200 responses + tracebacks aggregated and normalized. Root causes traced to `file:line`.
**Scope:** dev only — pre-pilot, so "user sessions" are M's testing + demo/group accounts. Errors there are still real bugs; pilot scale (10 teachers, 20 classes from 2026-08-14) will multiply the auth one.
**Goal:** firm up *existing* features (per the [UX-coherence gate](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/project_ux_coherence_gate.md)) — no new features.

## Headline

**Server-side is healthy.** No live 5xx anywhere in 7 days; the single 500 cluster (documents endpoint, 06-24) was a missing Firestore index that **self-resolved the same day** (index committed in `868ca66`). Only 2 self-healing Gemini retries. No crashes.

**The one real, pervasive bug is a group-auth 401 cascade** — it *saturated* the entire error sample (every row of a 500-row non-200 pull was a single endpoint 401ing in a loop). A student whose group token lapses gets a silently-broken session — every request 401s with no recovery until a manual page reload — while a poller spams the backend ~360×/hour. This is the highest-value hardening target before the pilot.

## Bug inventory (prioritized)

| # | Pri | Symptom (7d evidence) | Root cause (`file:line`) | Fix | Status |
|---|---|---|---|---|---|
| 1 | **P1** | `GET /api/auth/group/signal` → **401 in a tight loop**, ~6×/min for 13+ min continuous (saturated the sample); plus the whole 401 wall behind it: `/api/skills` (102×), `/api/auth/whoami` (99×), `/api/voice/config` (69×), `/api/skills/{id}/sessions` (29×), and `POST /api/auth/group/refresh` itself 401 (4×) | **No reactive auth recovery.** `fetchWithAuth` ([apiClient.ts:27-37](../../../../frontend/src/lib/apiClient.ts#L27)) sends the group token once and returns the response — **never refreshes-and-retries on 401**. The group-signal poller in [CallTeacherButton.tsx:34-60](../../../../frontend/src/components/chat/CallTeacherButton.tsx#L34) **swallows the 401 and keeps polling every 10s forever** — never backs off, stops, or marks the session expired. Refresh ([AnonymousGroupAuthProvider.tsx:214-267](../../../../frontend/src/contexts/AnonymousGroupAuthProvider.tsx#L214)) is **proactive-only** (token TTL 8h, renew at exp−5min) + on-visibility; a missed timer (laptop sleep/suspend) → stale token → every request 401s with nothing to recover it. | (a) **fetchWithAuth: on 401 with an active group session, call `refresh()` once and retry** (the refresh endpoint accepts expired-but-valid-signature tokens, so this recovers the common case). (b) **CallTeacherButton: on 401, stop the interval + `markExpired()`** instead of swallowing. (c) proactive-refresh-before-first-poll. Fix (a) stops the cascade; (b) stops the log spam. | **FIXED on branch** `fix/group-auth-401-reactive-refresh` (commit `f91ba83`) — new `groupTokenClient.refreshGroupSession` + `readStoredGroupSessionRaw`; `getIdToken` refreshes proactively at near-expiry; `fetchWithAuth` refreshes+retries once on 401; provider syncs + flips to `expired`; poller stops on terminal. 32 vitest passing, lint+typecheck+prod-build green. **MERGED to `dev` 2026-06-30** (M approved the push despite the freeze — contained student-auth hotfix). |
| 2 | **P2** | `POST /api/sessions/{id}/iframe-context` → **404** (~16×) and **403** (~13×) — the workbench→tutor state push | **404 = session-bootstrap race:** the workbench snapshot ([useSimSnapshotPush.ts](../../../../frontend/src/hooks/useSimSnapshotPush.ts)) pushes before the session index is created (`_require_session` in [iframe_context_routes.py](../../../../backend/protocols/iframe_context_routes.py) → 404). **403 = anon-uid ownership mismatch:** caller uid ≠ session `owner_uid` (the [anonymous-group corner case](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_anonymous_users_are_corner_case.md)). **Real partial loss:** the tutor misses the student's *early* workbench interactions. | Lazy-create the session on iframe-context (idempotent), or await bootstrap before the first push; confirm the deterministic anon-uid format on both sides for the 403. **Needs a confirming repro** before the fix (root cause is high-confidence but inferred). | **OPEN** |
| 3 | **P3** | `GET /api/sessions/{id}/messages` → **404** across ~25 distinct session IDs | Same bootstrap race / stale client session ID — message fetch before the session index exists ([sessions_route.py](../../../../backend/protocols/sessions_route.py) `_require_session`). Mostly **self-recovering** (clients retry; history appears after a beat). | Same idempotent-lazy-create or await-bootstrap fix as #2 — likely one fix covers #2 and #3. | **OPEN (low)** |
| 4 | P3 | `GET /api/activities/…d558ef71175895d` → 404 (3×) — a **malformed activity ID** (group-code-like prefix glued to a hex id) | Likely a frontend ID-construction bug (concatenating two IDs). Low volume. | Trace the activity-link construction; one-line client fix. **Note only.** | OPEN (low) |
| 5 | P3 | `POST /api/activities` → 422 (3×) | Activity-create payload validation rejections during authoring — likely a client sending an incomplete config (cf. [activity-config full-overwrite](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/reference_activity_config_full_overwrite.md)). Low volume. | Glance at the 422 body shape; confirm not a real authoring path. **Note only.** | OPEN (low) |

## Verified healthy / resolved (not bugs)

- **`GET /api/documents?skillId=…` → 500 (3× on 06-24):** missing `parsed_documents` composite index (`userId, status, skillId, createdAt`). **RESOLVED** — index added/committed 2026-06-24 (`868ca66`), auto-deploys via `cloudbuild.yaml:113`; **zero documents-500s in the 5 days since.**
- **No other 5xx** in 7 days — no server crashes or unhandled exceptions outside the resolved one.
- **`INFO:google_genai…Retrying due to aiohttp error: Server disconnected`** (2× in 48h) — transient Gemini disconnects, **self-healing retries**. Monitor only.
- **`GET /mcp/ 406`, `POST /mcp/{boldkast,ext-apps-map} 401`** — external/content-negotiation probing of the MCP endpoint; not a user-session bug. Ignore unless volume grows.

## Recommended post-freeze sequence

1. **Bug #1 (P1) first** — it's the platform-robustness keystone and scales badly into the pilot (every lapsed student token = a silently-dead session + backend spam). Fix (a)+(b) is a focused frontend change (`apiClient.ts` + `CallTeacherButton.tsx`), testable with a forced-expired-token vitest. Pairs with the [anonymous-users corner-case](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_anonymous_users_are_corner_case.md) history.
2. **Bug #2/#3 together** — one idempotent-lazy-create (or await-bootstrap) change likely closes both; reproduce the iframe-context 404 first to confirm the tutor-misses-early-state impact.
3. **Bugs #4/#5** — quick client-side glances; note-only unless they recur.

## Also surfaced — pre-existing red test on dev (CI hygiene)

While running the full frontend suite before the push, **1 test fails on clean `dev`** (confirmed in isolation, not a regression from the auth fix): `src/app/teacher/classes/[id]/__tests__/page.test.tsx:146` — `screen.getByRole("status")` matches **multiple** elements ("'New group' click…"), i.e. the teacher class-detail page renders 2+ `role="status"` live regions and the assertion isn't scoped. The other **1411 tests pass.** This is a selector/duplicate-live-region issue, **not** auth-related. It means dev's full-suite gate is red (consistent with the CI-red-unnoticed history). **P3 follow-up:** scope the query (`getAllByRole`/`within`) or de-dupe the live region — separate from this fix. Not blocking the deploy (Cloud Build deploys independently of the GH Actions check).

## Re-run the triage

```bash
P="--project=aipla-dev-2026"; SVC='resource.labels.service_name="aipla-v01-frontend"'
# non-200s, normalized, excluding the group/signal noise:
gcloud logging read "$SVC AND textPayload=~\"HTTP/1\.1. [45][0-9][0-9]\" AND NOT textPayload:\"group/signal\"" $P --freshness=7d --limit=400 --format="value(textPayload)" \
  | sed -E 's/.*"(GET|POST|PUT|PATCH|DELETE) /\1 /; s/ HTTP\/1\.1" / /; s/\?[^ ]*/ /' \
  | sed -E 's#/[0-9a-f]{8,}#/{id}#g; s#/[a-z]+-[a-z]+-[0-9]+#/{group}#g' | sort | uniq -c | sort -rn
# 5xx only (server bugs):
gcloud logging read "$SVC AND textPayload=~\"HTTP/1\.1. 5[0-9][0-9]\"" $P --freshness=7d --limit=50 --format="value(timestamp,textPayload)"
```
