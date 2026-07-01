# Group shared-session live sync + turn-lock (1.1.53)

**Status:** M0 + M1 SHIPPED to `dev` 2026-07-01 (branch `sprint/group-sync`); M2 + M3 open. See the "Build" table for per-milestone state.
**Priority:** P1 — correctness, not polish. The primary classroom shape is
**several kids in one group working the same activity on separate devices**,
and today that shape has a data race and a silent-desync bug (below). This is
"make the core multi-student case actually work", not a feature.
**Builds on:** [live-group-drilldown.md](live-group-drilldown.md) (the
poll-while-active live idiom this reuses) · [call-teacher.md](call-teacher.md)
(the group-scoped `group_signals/{group_id}` doc + poll precedent) · the
shared-uid group-session model (ADR-001).
**Origin:** 2026-07-01 code-level verification of "what happens when two
students share a group ID and both have the app open" (M). Findings below.

## Decisions (locked — M, 2026-07-01)

Three product calls fix the shape of this doc; recorded here because they are
load-bearing:

1. **One shared live thread.** All members of a group share **one**
   conversation; each device sees the others' turns appear live; one tutor
   addressing the group. (Keeps today's shared-uid design — see below — and adds
   the live sync + concurrency safety it's missing.)
2. **Single group voice.** Student turns are **not** attributed to individuals.
   The group is one anonymous author. This means **no new per-student identity
   or data model** — it matches what the backend already does. Deliberately the
   minimal surface.
3. **Soft turn-lock.** One turn at a time per group. While the tutor is
   answering, other devices' composers show "tutor is answering your group…" and
   a typed message **queues** until the turn completes.

The through-line: **the group is one logical user rendered on N screens.**
Everything already converges on one backend session; the gaps are that the other
screens don't refresh, and two screens can drive a turn at once.

## What's actually broken today (verified in code)

The group's identity is **deterministic and shared** — every join to a code
resolves to the *same* synthetic uid
([`group_id_auth.py:_synthesize_uid` 304-318](../../../../backend/auth/group_id_auth.py#L304-L318),
join at [731](../../../../backend/auth/group_id_auth.py#L731)) — and the group
keeps **one active session pointer per activity**
([`group_sessions.py:62-113`](../../../../backend/db/group_sessions.py#L62-L113)).
So both students' turns already land in **one** ADK session and one Firestore
transcript. The sharing is real. Three things then go wrong:

| # | Bug | Root cause | Severity |
|---|---|---|---|
| **1** | **No live sync.** If A types, B does **not** see it — not after 1s, not after a minute — until B **reloads**. | History is fetched **exactly once** per session: [`useSessionMessages.ts:159`](../../../../frontend/src/hooks/useSessionMessages.ts#L159) short-circuits (`if (sessionId === lastSessionId.current) return;`). No polling, no `onSnapshot` on messages, and the AG-UI stream is **per-turn**, not a subscription. | High — it's the headline complaint. |
| **2** | **Ghost context.** Because the session is shared, when B sends, the tutor answers against the *combined* history — including A's turns B never saw. The tutor references a message that isn't on B's screen. | Same root as #1: shared backend session, no shared view. | High — confusing, and **guaranteed**, not a race. |
| **3** | **Concurrent-turn race.** If A and B send at the same instant, two parallel `ADKAgent.run()` calls append to one session with **no serialisation** — turn order undefined, events can interleave/clobber. | No turn-lock on the shared session. | Medium — real, untested, corrupts the shared transcript. |
| **4** | **Workbench clobber.** A edits the table/calculator → POST to the shared session state ([`iframe_context_routes.py`](../../../../backend/protocols/iframe_context_routes.py)); B doesn't see it and B's next edit silently overwrites it (last-write-wins, no convergence). | Shared session state, no sync + no merge. | Medium — silent data loss. |

**Live sync (#1) directly kills the ghost-context bug (#2)** — once every device
renders the shared thread live, there is no invisible context. The turn-lock
(#3) and workbench sync (#4) close the two clashes.

## The model — one logical user, N screens, poll-synced

Reuse the platform's **existing** live idiom: **poll a tiny pulse while the tab
is active, refetch the heavy payload only when it changes** — exactly the cadence
[live-group-drilldown.md](live-group-drilldown.md) already ships for the teacher
view (zero LLM, no websockets). No new transport.

```
 Device A (Ali)                Device B (Mia)
 ┌───────────────────┐         ┌───────────────────┐
 │ shared thread     │         │ shared thread     │
 │  Ali: why fall?   │◀──┐  ┌──▶│  Ali: why fall?   │   both render the
 │  Tutor: what…?    │   │  │   │  Tutor: what…?    │   SAME session
 │  [composer]       │   │  │   │  tutor answering  │   live
 └────────┬──────────┘   │  │   │  your group…      │
          │ send         │  │   └───────────────────┘
          ▼              │  │
   POST skill stream ────┘  │   pulse: {revision, turnInFlight}
   (acquires turn-lock)     │   polled ~2–3s while active
          │                 │   revision bumps → refetch /messages
          ▼                 │   turnInFlight=true → lock B's composer
   group_sessions/{g}:{a} ──┘
   turn_in_flight_at / token  ← atomic CAS = the correctness guard
```

### Two primitives

**(a) Turn-lock** — three fields added to the existing
`group_sessions/{group_id}:{activity_id}` doc
([`group_sessions.py`](../../../../backend/db/group_sessions.py), which already
holds the shared pointer — no new collection):

```
turn_in_flight_at : str | None   # ISO ts the current turn started
turn_lock_token   : str | None   # the holder's ephemeral run id
                                  # (only the holder — or TTL — may release)
```

- `acquire_turn_lock(group_id, token, activity_id=…)` runs a **best-effort CAS**:
  read the doc; if `turn_in_flight_at` is set **and** younger than the TTL (and
  held by a different token) → return `False` (locked); else set
  `turn_in_flight_at=now`, `turn_lock_token=token` → return `True`. Two
  simultaneous sends → one wins, the other is refused (409).
  **Implementation note (shipped):** it is *best-effort*, not a hard mutex — the
  `db.firestore` abstraction deliberately exposes **no transactions** (in-memory
  client: "v6 doesn't use them"), the same posture as the sibling
  `set_active_session_for_group`. The residual window is milliseconds wide, the
  M1 client composer-lock removes most simultaneous sends before the wire, and a
  lost race just reproduces today's behaviour (two turns) for that one turn — no
  new corruption. Strict once-only semantics stay deferred to the prod Terraform
  runbook, consistent with the sibling.
- `release_turn_lock(group_id, activity_id, token)` clears the fields **only if
  the token matches**, so a stale release from a different client can't unlock a
  live turn.
- **TTL = 90s.** A lock older than the TTL is *stealable* — if a device closes
  its tab mid-turn and the `finally` release never runs, the group must not
  wedge. Tutor turns are short; 90s is generous. (A future long-running turn
  could heartbeat-extend; out of scope.)

**(b) Session pulse** — a new tiny read, modeled on the `group_signals` poll
([`group_signals.py`](../../../../backend/db/group_signals.py)):

```
GET /api/auth/group/pulse?activityId=<act>   →   (SHIPPED path — see note)
  {
    revision:         <turn_revision>,   # monotone; bumps when a turn commits
    turnInFlight:     bool,              # from the turn-lock (non-stale)
    turnStartedAt:    <iso>|null,
    workbenchRevision:<int>,             # M2 (open) — bumps on iframe-context write
    activeDevices:    <int>              # M3 (open) — presence count
  }
```

**Endpoint note (shipped as M1):** the pulse is keyed off the **caller's
`group_id`** (from the group token) + an `activityId` query param — exactly like
`raise-hand` — *not* `/sessions/{id}/pulse`. Keying by session id would need a
session→(group, activity) lookup that doesn't exist; keying by the caller's group
needs none and can't leak across groups. It lives at
`/api/auth/group/pulse`, declared **before** `GET /{group_id}` so it isn't
captured as `group_id="pulse"`.

**Revision source (shipped as M1):** `chat_sessions.turnCount` is flushed to
Firestore only **every N turns** (`adk/callbacks/session.py`), so it can't be the
live signal. Instead a `turn_revision` counter on the `group_sessions` doc is
bumped at **turn completion** (in the M0 lock-release path) — race-free because
the lock serialises turns (single writer), so a plain read-increment-write is
safe. The pulse is a **single small doc read, zero LLM**; polled ~2.5s while the
tab is focused, backing off when hidden.

### How each device behaves

- **Watcher (not the turn holder):** poll pulse. On `revision` change → refetch
  `GET /api/sessions/{id}/messages` (the endpoint already exists; the fix is to
  *re-run* it, see M1). On `turnInFlight=true` → disable composer, show "Tutor is
  answering your group…". A message typed meanwhile is **queued locally** and
  auto-sent when `turnInFlight` clears.
- **Sender:** the skill-stream POST **acquires the turn-lock** before starting the
  ADK run; on refusal (409) it flips into the queued state and retries when the
  pulse says the lock cleared. Its own turn streams live as it does today (its
  AG-UI stream appends locally), so it does **not** pulse-refetch its own
  in-flight turn — it reconciles when the stream closes.
- **Proactive/reactive tutor turns** (`[session_start]`, `[event_reactive:*]`)
  also take the lock, so a proactive turn and a student send can't collide.

Watchers see a completed exchange appear ~one poll (~2–3s) after the turn
commits; they do **not** get live token-by-token mirroring of a groupmate's turn
(that needs a push fan-out — noted as a future enhancement, not v1).

## Build

| MS | Deliverable | State |
|---|---|---|
| **M0 — turn-lock (correctness first)** | `acquire_turn_lock`/`release_turn_lock` + `get_turn_lock` + `TURN_LOCK_TTL_SECONDS` on `group_sessions` (best-effort CAS, 90s TTL steal). Wired into `process_skill_request` (a locking wrapper over `_run_skill_turn`, gated on `user.group_id` so teachers bypass): acquire before the run, **409 if held** (in the student route), release in `finally`. Proactive greet skips (`skipped=True`) when locked. | **SHIPPED** — 12 lock units + 3 stream-wiring + 1 proactive-skip test. |
| **M1 — live chat sync (the headline)** | `turn_revision` counter bumped at turn completion + `GET /api/auth/group/pulse` → `{revision, turnInFlight, turnStartedAt}`. Frontend: `useGroupPulse` (poll ~2.5s active / back off hidden); `useSessionMessages` silent refetch on a forward revision jump (**watcher-gated** — see boundary); composer "A classmate is asking the tutor…" banner + local queue that auto-sends on release. | **SHIPPED** — +12 backend, +6 frontend tests. |
| **M2 — workbench state sync** | Add `workbenchRevision` to the pulse (bump on iframe-context write). Other devices refetch `GET /api/sessions/{id}/iframe-context` and reconcile element state; **last-write-wins with convergence**. **Bigger than it looks:** the workbench elements currently OWN their local state and don't accept external updates, so this needs each element to take a controlled/external-state path — a materially larger change than M0/M1 with a real collaborative-edit product question. | **OPEN** — needs its own scoping. |
| **M3 — presence (optional)** | Pulse carries `activeDevices` (heartbeat count, ~15s window — a count, **not** identities). "● live · N here" indicator; phrase the turn-lock as "a classmate is asking…". | **OPEN** — polish. |

**M0 + M1 are the core (SHIPPED) and fix bugs #1–#3.** M2 fixes #4. M3 is polish.

### M1 known boundary (shipped)

Live history-refetch is **watcher-only**: a device with no live messages of its
own (`messages.length === 0`) refetches on a revision bump and sees groupmates'
turns live. A device that has **itself** sent relies on its own live AG-UI stream
and won't live-refetch others' turns until reload — because `ChatMessageList`
renders restored history and the live block as **two un-deduped sections**, so a
sender-side refetch would double every bubble. The **turn-lock is what covers the
interaction case** (turns are serialised; while a groupmate holds the turn this
device is queued, not diverging). Full bidirectional live-refetch = dedupe the
merge; deferred. There is also **no live token-mirroring** (watchers see the
completed exchange ~one poll after commit) — the design's stated v1 boundary.

## Acceptance

- [ ] **M0:** Two devices in one group send simultaneously → exactly one turn
      runs; the other receives 409 and its message queues. No interleaved/lost
      events in the shared transcript. A crashed turn's lock is reclaimable after
      the TTL (group not wedged).
- [ ] **M1:** On device A, send a turn. On device B (same group, same activity,
      not reloaded), the new user turn **and** the tutor reply appear within one
      poll (~2–3s of commit). While A's turn is in flight, B's composer shows
      "tutor is answering your group…" and a message B types is sent
      automatically once the turn completes. The ghost-context bug is gone (B saw
      what A asked).
- [ ] **M2:** A edits the table/calculator → B's workbench reflects it within a
      poll; B's subsequent edit does not silently erase A's (last write wins, but
      both devices converge to the same state). A groupmate's trust-card is
      visible in the shared thread.
- [ ] No per-student identity anywhere — everything keyed on `group_id` /
      `(group_id, activity_id)` (ADR-001, "single group voice").
- [ ] Pulse is zero-LLM; poll backs off when the tab is hidden/idle.
- [ ] `make lint` + `make test-fast` (backend) and `npm run quality:check`
      (frontend) green.

## Privacy / scope (ADR-001)

- Everything is **group-scoped**. The turn-lock and pulse key on `group_id` /
  `(group_id, activity_id)` — never a student. Consistent with "single group
  voice": there is no per-device identity, only an ephemeral lock **token** (a
  random run id, not a person) and, in M3, a **count** of active devices.
- No new collection: the lock rides the existing `group_sessions` doc; the pulse
  is a read over data that already exists. The only genuinely new endpoint is
  `GET …/pulse`.
- Auth: the pulse and the skill-stream are already student-group-authenticated
  (`fetchWithAuth` → group token). The lock writes are keyed off the **caller's**
  `group_id` (like `group_signals.raise_hand`), never a path param — a device can
  only lock its own group's turn.

## Out of scope / future

- **Live token-mirroring to watchers** (watchers see the tutor typing in real
  time, not just the finished exchange). Needs a push fan-out (SSE broadcast or a
  server-relayed stream); the poll model deliberately doesn't attempt it. Revisit
  if the ~2–3s settle feels laggy in the pilot.
- **Per-student attribution / presence identities** — explicitly rejected
  (decision #2). If a later pilot wants "who said what" within a group, that's a
  separate data-model change, not this doc.
- **Optimistic locking on workbench cells** — M2 accepts last-write-wins; true
  CRDT/OT merge is out of scope for a classroom tool.

## How this maps back to the four bugs

| Bug | Closed by |
|---|---|
| #1 no live sync | **M1** (pulse + refetch on revision) |
| #2 ghost context | **M1** (a consequence of #1 — every device sees the shared thread) |
| #3 concurrent-turn race | **M0** (transactional turn-lock CAS + 409) |
| #4 workbench clobber | **M2** (workbench revision sync + documented last-write-wins) |
