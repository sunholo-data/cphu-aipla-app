# Sprint plan — Group shared-session live sync + turn-lock (1.1.53)

**Sprint ID:** `GROUP-SYNC`
**Design doc:** [group-shared-session-sync.md](group-shared-session-sync.md)
**Created:** 2026-07-01
**Goal:** Make the primary classroom shape work — a group of students on
**separate devices**, one activity, one shared conversation that **syncs live**
and **can't race**. Fixes the four verified bugs (#1 no live sync, #2 ghost
context, #3 concurrent-turn race, #4 workbench clobber).

## Summary

| | |
|---|---|
| **Duration** | ~3d core (M0+M1) · ~5d full (M0–M3) |
| **Scope** | fullstack |
| **Build order** | **M0 → M1 → M2 → M3** (strict; M0 lands first) |
| **New collection?** | No — lock rides the existing `group_sessions` doc |
| **New endpoint** | One: `GET /api/sessions/{id}/pulse` |
| **Velocity context** | 169 commits / 26k LOC in the last 7d — the ~3d core estimate is comfortable |

## Milestones

### M0 — Turn-lock (backend, correctness first) · ~1d · **must land first**

The atomic guard that actually prevents bug #3. Without it, M1's composer-lock is
cosmetic (racy on the poll interval).

**Tasks**
- `db/group_sessions.py`: add `turn_in_flight_at: str|None` + `turn_lock_token:
  str|None` to the `group_sessions/{group_id}:{activity_id}` doc. Add
  `acquire_turn_lock(group_id, activity_id, token)` (Firestore **transaction**:
  read; if in-flight and younger than 90s TTL → `False`; else set now+token →
  `True`) and `release_turn_lock(group_id, activity_id, token)` (clear **only if
  token matches**; TTL makes a stale lock stealable). (~90–130 LOC)
- `skills/skill_processor.py:process_skill_request` (~L68, has `user.group_id` +
  `activity_id`): acquire the lock at the **top, before the ADK run**; wrap the
  stream in `try/finally` → release. On failure raise a typed `TurnLockedError`.
  Proactive/mcp/channel callers get the same serialization for free (they run
  through this function).
- Student stream route (`fast_api_app.py:~644`): translate `TurnLockedError` →
  **HTTP 409** (`{error: "turn_in_progress"}`) *before* the SSE body starts, so
  the FE can show the queued state cleanly. Proactive route
  (`protocols/proactive_routes.py:192`) simply **skips** when locked (a student
  turn is live — don't fire a proactive one).

**Tests (backend, ~120 LOC)**
- Two concurrent `acquire` calls → exactly one `True`, one `False`.
- Locked send → 409; lock released → next send succeeds.
- Release only by the holding token; a foreign token can't unlock.
- Stale lock (>90s) is stealable.
- A proactive turn is skipped while a student turn holds the lock.

**Acceptance:** two devices in one group send at once → one turn runs, the other
409s; no interleaved/lost events; a crashed turn's lock reclaims after TTL.

**Gate:** `cd backend && make lint && make test-fast`.

---

### M1 — Live chat sync (fullstack, the headline) · ~1.5–2d · depends on M0

**Backend tasks**
- `protocols/sessions_route.py` (next to `/messages` at L337): add `GET
  /api/sessions/{id}/pulse` → `{revision, turnInFlight, turnStartedAt}`.
  - `revision` = a monotone signal for "a turn committed" — use the ADK session
    event count (most reliable) or `chat_sessions.turnCount + proactiveTurnCount`
    (`db/models/chat_session.py:40,54`); pick the monotone one at implement time.
  - `turnInFlight` / `turnStartedAt` from the M0 lock (non-stale only).
  - Group-auth'd (`fetchWithAuth` group token), keyed off the caller's session —
    zero LLM, single small doc read. (~70–100 LOC + tests)

**Frontend tasks**
- `hooks/useSessionPulse.ts` (new): poll `/pulse` ~2–3s while the tab is
  focused+active; back off / stop on `visibilitychange` hidden. (~90 LOC)
- Extend `hooks/useSessionMessages.ts`: refetch on `revision` change (remove the
  one-shot short-circuit at L159; add a `revision` dep). **Do not** refetch the
  client's own in-flight turn (its AG-UI stream is appending locally) — reconcile
  when that stream closes. Keep the sentinel filter (L119). Merge without
  disrupting scroll position or a half-typed composer. (~120 LOC)
- Composer: on `turnInFlight && !isHolder` → disable + "Tutor is answering your
  group…"; a message typed meanwhile is **queued locally** and auto-sent when
  `turnInFlight` clears. On a `409` from the stream POST → flip to queued +
  auto-retry on the next clear. (~120 LOC)

**Tests (~180 LOC fullstack)**
- Backend: pulse returns the right `revision`/`turnInFlight`; bumps after a turn.
- FE: watcher sees a new turn appear within a poll; composer disabled while
  in-flight; queued send fires on release; the sender's own live stream isn't
  double-applied by a pulse refetch.

**Acceptance:** device B (same group/activity, not reloaded) sees A's new turn +
the tutor reply within ~one poll (~2–3s of commit); B's composer locks + queues
while A's turn runs; ghost-context gone (B saw A's question).

**Gate:** `cd backend && make lint && make test-fast` + `cd frontend && npm run quality:check`.

---

### M2 — Workbench state sync (fullstack) · ~1–1.5d · depends on M1

**Tasks**
- Backend: add `workbenchRevision` to the pulse; bump it on each iframe-context
  write (`protocols/iframe_context_routes.py`).
- Frontend: on `workbenchRevision` change, refetch `GET
  /api/sessions/{id}/iframe-context` and reconcile local element state (via
  `hooks/useSimSnapshotPush.ts`); **last-write-wins with convergence**
  (documented; simultaneous same-cell edit is an accepted edge). A groupmate's
  "shared with the AI" trust-card surfaces in the shared thread.

**Tests (~100 LOC):** workbenchRevision bumps on write; a second device refetches
and converges; no silent divergence.

**Acceptance:** A edits the table/calculator → B reflects it within a poll; B's
next edit doesn't silently erase A's (both converge).

**Gate:** backend + frontend as M1.

---

### M3 — Presence (fullstack, optional) · ~0.5d · depends on M1

**Tasks**
- Backend: `activeDevices` heartbeat count in the pulse (~15s window — a
  **count**, not identities, per "single group voice").
- Frontend: "● live · N here" indicator; phrase the turn-lock as "a classmate is
  asking…".

**Acceptance:** the indicator shows the live device count; drops when devices leave.

## Risks / notes

- **Lock surfacing (M0):** `process_skill_request` is an async generator consumed
  with `async for` by four callers (student stream, proactive, mcp, channels).
  Acquire at the top so all are serialized; the *student* route is the only one
  that must return a clean 409 before the SSE body — the others skip/no-op. If a
  clean pre-SSE 409 proves awkward, fallback is a terminal AG-UI
  "turn_in_progress" event the FE maps to the queued state (documented in the
  design doc's future/edge notes).
- **`revision` source:** confirm which counter increments on **every** committed
  turn (student + proactive) before wiring the pulse — the ADK session event
  length is the safest monotone source if `turnCount` lags.
- **Anon-group auth:** every new fetch (pulse, iframe-context refetch) is
  student-facing → **group token** via `fetchWithAuth`, never the teacher helper
  (the recurring 401 trap — CLAUDE.md "Anonymous-Group Auth").
- **Poll cost:** pulse is a tiny doc read, zero LLM, backing off when hidden;
  matches the teacher live-view cost posture. Cadence (2–3s) is the
  "how-soon-does-the-partner-see-it" knob — tunable post-pilot.

## Success metrics

- All four bugs closed (M0→#3, M1→#1+#2, M2→#4).
- Backend `make lint` + `make test-fast` green; frontend `npm run quality:check`
  green.
- No per-student identity introduced anywhere (ADR-001 / "single group voice").
- Manual two-device check: two browser tabs on `aipla-demo-1`, same activity —
  turns appear cross-device within a poll; simultaneous sends 409 cleanly.
