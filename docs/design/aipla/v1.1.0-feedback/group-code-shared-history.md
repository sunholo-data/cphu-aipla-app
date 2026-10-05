# Many devices on one group code — the tutor reads a conversation nobody can see

**Status:** Design (OPEN) — **1.1.145**
**Priority:** **P1** for M0–M2 (a teacher-visible correctness gap on prod, and it corrupts what the logs mean) · **P2** for M3–M5
**Estimated:** ~2.5–3d phased (M0 evidence ~0.25d · M1 server-authoritative session per (group, activity) ~0.75d · M2 every device renders the shared transcript ~0.75d · M3 bind a session to its activity ~0.5d · M4 device *count* on the log row ~0.25d · M5 crowded-code hint for teachers ~0.25d)
**Scope:** Backend: `db/group_sessions.py`, `protocols/session_bootstrap_routes.py`, `auth/group_routes.py`, `db/chat_sessions.py`, `skills/skill_processor.py`, `observability/chat_log.py` + `infrastructure/modules/chat-logs/views.tf`. Frontend: `app/chat/[...path]/page.tsx`, `hooks/useSessionMessages.ts`, `hooks/useGroupPulse.ts`, `hooks/useStableThreadId.ts`, `components/chat/ChatMessageList.tsx`
**Dependencies:** [1.1.53 group-shared-session-sync](group-shared-session-sync.md) (**shipped**; this revisits its M1 "watcher" rule); [session-persistence](../v1.0.0-pilot/implemented/session-persistence.md) (**shipped**, the 1.F group→session pointer); ADR-001 ([snapshot](../_scoping-snapshot/architecture.qmd#adr-001-student-identity-no-auth-anonymous-group-ids)); [1.1.88 group-shared-table](group-shared-table.md) open question 1 (isolated mode) and [21 Aug triage](teacher-feedback-2026-08-21-triage.md) item 27 (individual codes), both **not** decided here. Un-gated
**Created:** 2026-10-05
**Source:** Teacher seminar 2026-10-05, [notes-2026-10-05.md](../../../notes-2026-10-05.md)

## Problem Statement

At Daniel's teacher seminar on prod, several participants typed the **same group
code**. M's notes, verbatim:

> *"Shared groupIDs share chat history are influencing answers? But we don't see it."*
> *"They were using the same group id but different activities and seeing shared chat in history?"*

Two observations: (1) the tutor's answers seemed shaped by turns the reader could not
see; (2) someone saw chat in their history that was not theirs.

### What the code does (verified)

**Identity.** A group code maps to exactly one synthetic uid, `anon-<code without
hyphens>`, for every device that joins
([`group_id_auth.py:325-339`](../../../../backend/auth/group_id_auth.py#L325-L339),
used at [:768](../../../../backend/auth/group_id_auth.py#L768)). This is deliberate
(2026-06-13): ADK sessions are keyed `(app, user_id, session_id)`, so a shared group
conversation needs a shared uid. The turn runs under that uid
([`skill_processor.py:351`](../../../../backend/skills/skill_processor.py#L351)). The
backend therefore **cannot tell two devices apart**, and every session the group ever
opened is readable and writable by every device holding the code.

**Which session a device uses.** This is decided **on the client**, by a race:

1. On mount, `useStableThreadId` mints a fresh UUID unless `?session=` is already set
   ([`useStableThreadId.ts:30-35`](../../../../frontend/src/hooks/useStableThreadId.ts#L30-L35)).
2. That UUID is bootstrapped **immediately**
   ([`page.tsx:704-719`](../../../../frontend/src/app/chat/[...path]/page.tsx#L704-L719)),
   which calls `set_active_session_for_group(group, sid, activity_id)`
   ([`session_bootstrap_routes.py:121-122`](../../../../backend/protocols/session_bootstrap_routes.py#L121-L122)).
   That write is **first-wins**: a later device's UUID is silently not registered
   ([`group_sessions.py:100-140`](../../../../backend/db/group_sessions.py#L100-L140)).
3. In parallel, the page asks `GET /api/auth/group/active-session?activityId=` and, if
   it returns an id and no `?session=` is in the URL yet, switches to it
   ([`page.tsx:269-296`](../../../../frontend/src/app/chat/[...path]/page.tsx#L269-L296);
   route at [`group_routes.py:404-424`](../../../../backend/auth/group_routes.py#L404-L424)).

If several devices open the same activity at the same moment — exactly what a seminar
does — step 3 returns `null` for all but the lucky ones. Each loser keeps its own UUID,
chats on a **private session no one else watches**, and is not the registered pointer.
On its next reload, step 3 returns the **winner's** session: the student's own
conversation is gone and someone else's is on screen.

**Per-activity scoping exists, but only for `act-…` ids.** The pointer doc is
`group_sessions/{group}:{activity}` ([`group_sessions.py:52-57`](../../../../backend/db/group_sessions.py#L52-L57)),
and all four per-group progress stores (checklist, concept, writing, table) are keyed
`{group}:{activity}` too (`_doc_id` in each of `db/{checklist,concept,writing,table}_progress.py`).
But the turn-lock and the pulse revision are keyed by `activity_id` **only when it starts
with `act-`** ([`useSkillAgent.ts:730-731`](../../../../frontend/src/hooks/useSkillAgent.ts#L730-L731),
[`page.tsx:778`](../../../../frontend/src/app/chat/[...path]/page.tsx#L778)); a legacy
lesson (synthetic activity, `activityId == skillId`) uses the **group-level** doc
`group_sessions/{group}`, shared by every legacy lesson of the group
([`skill_processor.py:217-246`](../../../../backend/skills/skill_processor.py#L217-L246)).
For those chats the join response's **group-level** `resumedSessionId`
([`group_routes.py:222`](../../../../backend/auth/group_routes.py#L222), [:255](../../../../backend/auth/group_routes.py#L255))
is also used as a fast-path resume
([`page.tsx:242-247`](../../../../frontend/src/app/chat/[...path]/page.tsx#L242-L247)).
And nothing server-side binds a session to an activity: `ChatSessionIndex` stores
`skillId`, not `activityId`
([`chat_sessions.py:37-57`](../../../../backend/db/chat_sessions.py#L37-L57)), and the turn
path accepts any `threadId` the group owns.

**What the model sees vs what the student sees.**

| | Model (ADK session) | Student's screen |
|---|---|---|
| Turns from other devices on the same session | **All of them** — they are events in the session | Only those present when history was fetched at mount |
| After this device has sent one message | All of them | **No more refetches** — `watcherRevision = messages.length === 0 ? groupRevision : 0` ([`page.tsx:784-790`](../../../../frontend/src/app/chat/[...path]/page.tsx#L784-L790)) |
| Workbench pushes / trust cards from other devices | All of them | Only via the same (now disabled) refetch |
| Turns from *other* sessions / activities | **None** found — see below | None, except by the resume swap above |

The 1.1.53 doc named this exact defect — *"Ghost context ... the tutor references a
message that isn't on B's screen"* — and said live sync "directly kills" it. M1 then
shipped live sync **for pure watchers only**, because restored history and the live
block render un-deduplicated. The moment a student speaks, the ghost-context bug is back.

**Students do not see a session list.** The sidebar with `SkillSessionPanel` /
`DocumentHistoryPanel` renders only when `showDocumentUI = !isAnonymousGroupAuthMode()`
([`page.tsx:443`](../../../../frontend/src/app/chat/[...path]/page.tsx#L443), [:1219-1230](../../../../frontend/src/app/chat/[...path]/page.tsx#L1219-L1230)).
So "history" in M's note must be the **transcript in the chat pane** — the resumed or
shared session — not a list. (A teacher on Firebase auth does get the list, filtered by
`ownerUid == caller` and skill, [`skills/routes.py:325-348`](../../../../backend/skills/routes.py#L325-L348).)

**Cross-session channels that are closed (verified).** ADK memory tools default off and
no code writes to the memory bank ([`agent.py:470-487`](../../../../backend/adk/agent.py#L470-L487));
no shipped template opts in (`grep "memory: true" backend/skills/templates` is empty).
No turn writes `user:`-scoped ADK state. Compaction summarises events within one
session only. Progress stores are per `(group, activity)`.

## Root cause

**Verified in code**

- **V1 — ghost context within one activity.** Every device on a code shares one ADK
  session per activity by design, but a device that has sent anything stops receiving
  groupmates' turns. The tutor answers against the full shared transcript; the student
  sees a partial one. This alone explains *"influencing answers, but we don't see it"*.
- **V2 — divergent sessions under a simultaneous join.** Session choice is a client race
  with a first-wins server pointer. Simultaneous openers each get a private session;
  on reload they are moved onto the winner's. This explains *"seeing shared chat in
  history"* for a student who never saw it before.
- **V3 — legacy lessons are not activity-scoped for lock, pulse or join-time resume.**
  Two legacy lessons on one code share a turn-lock ("a groupmate is answering" on a
  different lesson) and a revision counter.
- **V4 — the log cannot separate people on one code.** `chat_turns` has no device
  dimension, by ADR-001 design. A code used by eight people is recorded as one group.

**Hypotheses needing log confirmation (M0)**

- **H1** — participants were on the *same* `act-…` activity (V1/V2), and "different
  activities" was a misreading. Confirm: activities per group on 10-05.
- **H2** — some devices diverged (V2). Confirm: `>1` session per `(group, activity)` on 10-05.
- **H3** — the code was a legacy lesson or a pre-ALS-1 code whose group-level pointer
  `group_sessions/{group}` still held a `session_id`; the join-time fast path then
  resumed **another lesson's** session (V3). This is the only verified route by which
  one activity's chat can appear in another's pane. Confirm: `activity_id` not
  `act-…` on that group's rows, or a session logged under two skills/activities.
- **H4** — someone shared a URL carrying `?session=` (projector, chat message). Any
  device with the code would then join that exact session regardless of activity.
  Confirm: one `session_id` with rows under two `activity_id`s.

Side observation, out of scope: `app:resumed_session` / `app:docs_loaded`
([`skill_processor.py:366-368`](../../../../backend/skills/skill_processor.py#L366-L368),
[`callbacks/document.py:24-28`](../../../../backend/adk/callbacks/document.py#L24-L28)) use
ADK's **app-scoped** prefix, which in ADK semantics is shared across all users. Whether
`VertexAiSessionService` honours that scope is unverified; check separately, not here.


## M0 results — prod, read 2026-10-05 evening

One seminar class (*Fysik C – Energi*, owner AR), nine codes, seven activities, 11:23–12:02.

- **H1 holds.** Every `(group, activity)` pair had exactly one session; no session spans two
  activities (H4: zero rows). "Different activities" in the note was groups moving between the
  class's seven activities, each with its own conversation.
- **H2 happened once** (`brave-grove-12`, two sessions on *Mekanisk energi*, 13:38 and 13:39).
- **V1 is the seminar.** `kind-kettle-86` on *Den hoppende bold*: **61 student turns in one
  session** from several people typing seconds apart (11:33:42, :49, :54, :59), talking *about*
  each other — *"Lone er håbløs"*, *"Venter lige på hun svarer dig, så jeg kan se det"*, *"Hvor
  kan jeg se det som de andre har lavet?"*, *"Hvorfor laver de andre i gruppen ikke noget?"*.
  They could see one another were there (the pulse and the composer lock work) but not what was
  said — exactly the `watcherRevision` gap above.
- **The tutor denied it.** Asked *"har du koblet svar fra andre i gruppen ind i din samtale med
  mig?"*, it answered *"Nej, jeg kan kun se det, du og din arbejdsflade bidrager med her"* —
  false: it was answering from all of them. **Add to M-tests:** the tutor's prompt must say the
  conversation is shared by the group when `devices_present > 1`, so it can answer that
  question truthfully.
- **The turn-lock rejected messages.** 7 `409`s on `/stream` during the seminar, **6 on that
  one session** (09:29–09:48 UTC). The soft queue holds a message composed *while the lock is
  visible*; a send that races the pulse is refused. A student whose message bounces and who
  cannot see the reply that beat it has no way to understand what happened.
- **It was the intended design, not misuse.** The teacher's own uploaded instructions (*Prompt
  for Energi*, see 1.1.151 F1) describe *"en parret elevsamtale"* — pairs sharing one code. So
  the shared-code path is the main path for this teacher, not an edge.

**Answer to M's question, 2026-10-05:** not a sync outage — a **latent design gap**. 1.1.53 M1
shipped live sync for *pure watchers only* (`ea08d147`), because restored history and the live
stream render un-deduplicated; the moment a student sends one message, their device stops
refetching. The pulse kept working, which is why presence was visible and content was not.
M2 of this doc (every device keeps syncing, other devices' turns labelled) is the fix.

## Decisions

**D1 — keep one conversation per (group, activity).** Options:

| Option | For | Against |
|---|---|---|
| a. Per-device sub-identity (each device its own session) | Removes shared context entirely; a seminar of 8 on one code behaves | Reverses 1.1.53 and session-persistence ("same code resumes the same session", three students on one phone moving devices); a persisted device id is exactly what ADR-001 excludes ("not device identifiers"); splits one group's work across sessions in the data |
| b. Teacher-chosen isolated mode | Matches 1.1.88 open question 1 | A new product mode; belongs with item 27's ADR-001 revision |
| **c. Keep sharing, make it correct and visible** | Matches the product decision and ADR-001; fixes V1–V3 at their cause | Does not stop a misused code mixing people in the log — needs D3 |

**Recommendation: c.** a and b are a deliberate ADR-001 revision for M and JB, not a bug fix.

**D2 — the server decides the session, not the client.** `POST /api/auth/group/session`
(body `{activityId, skillId}`) returns the active session for `(group, activity)` or
creates it, in a Firestore transaction (create-if-absent). The chat page awaits it
before building the agent; no client-minted UUID for anonymous-group users. This
removes V2 by construction rather than narrowing the race.

**D3 — research data: record a count, not an identity.** Stamp each `chat_turns` row
with `devices_present` (the pulse presence count for that `(group, activity)` at turn
time, `touch_presence` in `group_sessions.py`). An integer is not a device identifier;
it lets a researcher exclude or flag multi-device sessions (`devices_present > 3` on a
code meant for one group). The ephemeral per-tab token itself stays out of the log.
**Needs JB's sign-off** as a change to what is collected.

## Milestones

**M0 — evidence (~0.25d, M runs it; prod reads are not done by the build agent).**

```sql
-- Q1: groups active on 10-05, with how many activities and sessions each.
SELECT group_id,
       COUNT(DISTINCT COALESCE(activity_id, skill_id)) AS activities,
       COUNT(DISTINCT session_id)                      AS sessions,
       COUNTIF(role = 'student')                       AS student_turns,
       MIN(ts) AS first_ts, MAX(ts) AS last_ts
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') = '2026-10-05'
GROUP BY group_id ORDER BY sessions DESC;

-- Q2 (H2): divergence — more than one session for one (group, activity).
SELECT group_id, COALESCE(activity_id, skill_id) AS activity, skill_id,
       ARRAY_AGG(DISTINCT session_id) AS sessions,
       COUNT(DISTINCT session_id) AS n_sessions
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') = '2026-10-05'
GROUP BY 1, 2, 3 HAVING n_sessions > 1;

-- Q3 (H3/H4): one session logged under more than one activity or skill.
SELECT session_id, group_id,
       ARRAY_AGG(DISTINCT COALESCE(activity_id, '(null)')) AS activities,
       ARRAY_AGG(DISTINCT skill_id) AS skills
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') = '2026-10-05'
GROUP BY 1, 2
HAVING COUNT(DISTINCT COALESCE(activity_id, '(null)')) > 1 OR COUNT(DISTINCT skill_id) > 1;

-- Q4 (V1): the shared transcript, in order, for M to read for tutor turns that
-- answer something the asking device had not seen (bursts of student turns
-- seconds apart in one session are the multi-device signature).
SELECT ts, session_id, turn_index, role, SUBSTR(content, 1, 300) AS content,
       activity_id, tutor_id, revision, app_version,
       TIMESTAMP_DIFF(ts, LAG(ts) OVER (PARTITION BY session_id ORDER BY ts), SECOND) AS gap_s
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') = '2026-10-05'
  AND group_id IN (/* the codes Q1 shows with the most turns */)
ORDER BY session_id, ts;
```

Cloud Logging (project `aipla-prod-2026`, 2026-10-05; the backend is a sidecar in
`aipla-v01-frontend` and logs to `textPayload` at INFO):

```
resource.type="cloud_run_revision" AND resource.labels.service_name="aipla-v01-frontend"
AND (textPayload:"group_auth: joined group=" OR textPayload:"session_bootstrap: created uid=anon-")
```

`joined ... session_n=N` gives joins per code per day; `session_bootstrap: created` per
`uid=anon-…` gives sessions *created* (including orphans that never got a turn, which
Q2 cannot see). 409s on `/api/skills/` stream calls (`turn_in_progress`) per code show
how contended a code was. Record findings in this doc before starting M1.

**M1 — server-authoritative session (~0.75d).** D2. `db/group_sessions.py` gains
`get_or_create_active_session(group, activity)` in a transaction; the new route uses it;
`page.tsx` awaits it for anonymous-group users and passes the id to
`useStableThreadId` as `initialSessionId`. The bootstrap's pointer write and the
join-time `resumedSessionId` fast path are removed for group users. "+ New
conversation" does not exist for students; a teacher reset (archive) is the only way
to a new session.

**M2 — every device renders the shared transcript (~0.75d).** Drop the
`messages.length === 0` gate. On a revision advance with no own turn in flight,
refetch `/messages` and render it as the transcript, folding this device's live block
into it by message id (fix the un-deduplicated render in `ChatMessageList`). Invariant:
within one pulse interval plus a fetch, every device on a session shows what
`GET /messages` returns — the same events the model reads. Label turns that arrived by
refetch rather than this device's own stream ("sent from another device in your
group"); this needs no identity, only "not mine".

**M3 — bind a session to its activity (~0.5d).** Store `activityId` on
`ChatSessionIndex` at creation; the turn path refuses (409/422) a `threadId` whose
index names a different activity. Key the lock, pulse and pointer for legacy lessons by
`skillId` instead of group-level, so no two lessons share a doc. Closes V3 and H4.

**M4 — `devices_present` on the log row (~0.25d, gated on JB).** D3: emitter field,
`views.tf` column, a researcher-page filter. NULL before the ship date means "not
recorded".

**M5 — crowded-code hint (~0.25d).** When presence exceeds a threshold (proposal: 4)
on one `(group, activity)`, the teacher class page shows "8 devices are on
`bold-kazoo-87`; mint more codes?" and the student footer already showing
`groupHere` says the tutor reads everyone's messages. No hard cap: a cap refuses a
student mid-lesson.

## Acceptance criteria

- [ ] M0 queries run and their answers written into this doc, with H1–H4 each marked confirmed or refuted.
- [ ] Two devices joining one code and opening one activity **within the same second** end up on the same `session_id` (M1).
- [ ] After device A sends, device B's next tutor answer is never about a message B's screen does not show, within one pulse interval (M2).
- [ ] A turn posted with a `threadId` belonging to another activity of the same group is refused (M3).
- [ ] Two legacy lessons on one code do not lock each other (M3).
- [ ] `devices_present` is populated on new prod rows, or M4 is recorded as declined by JB.

## Tests

- `backend/tests/api_tests/test_group_session_get_or_create.py` — concurrent calls (threads) for one `(group, activity)` return one id; different activities return different ids; an archived pointer yields a new one.
- `backend/tests/api_tests/test_shared_code_end_to_end.py` — **the join test**: two REAL `join_group` calls on one code mint two tokens, both go through the REAL `auth` dispatcher, both resolve the session via the new route, A posts a turn (stub the model), and B's `GET /messages` returns A's turn; then B posts against activity 2's session id and is refused. No `dependency_overrides` of the auth symbol — per the footgun table, tests that override the symbol the route imports pass in lockstep with the bug.
- `backend/tests/unit/test_group_sessions.py` — extend: legacy-lesson keys are per-skill, never `group_sessions/{group}`.
- `frontend/src/app/chat/[...path]/__tests__/shared-transcript.test.tsx` — a device that has sent still refetches on a revision bump, and no message renders twice.
- `frontend/src/hooks/__tests__/useStableThreadId.test.ts` — extend: anonymous-group users never mint a UUID.
- Run storage-touching frontend tests on CI's Node too: `make test-frontend-ci-node`.

## Handover to a cloud agent

**Read first:** this doc's Problem Statement; [1.1.53](group-shared-session-sync.md)
(turn-lock, pulse, presence); CLAUDE.md "Anonymous-Group Auth" and the footguns rows
*Route imports the Firebase-ONLY `get_current_user`* and *A resolver ships with one
consumer*.

**Files:** `backend/db/group_sessions.py`, `backend/auth/group_routes.py` (new route —
import `get_current_user` from `auth`, never `auth.firebase_auth`),
`backend/protocols/session_bootstrap_routes.py`, `backend/db/chat_sessions.py`,
`backend/skills/skill_processor.py`, `backend/fast_api_app.py` (refusal mapping),
`frontend/src/app/chat/[...path]/page.tsx`, `frontend/src/hooks/{useSessionMessages,useStableThreadId,useSkillAgent,useGroupPulse}.ts`,
`frontend/src/components/chat/ChatMessageList.tsx`, `frontend/messages/{da,en}/` for any new copy.
M4 only: `backend/observability/chat_log.py`, `infrastructure/modules/chat-logs/views.tf`.

**Commands before every push:** `cd backend && make lint && make test-fast`;
`cd frontend && npm run quality:check`; `make check-auth-dispatcher`,
`make check-i18n`, `make check-client-api` (the new client function must have a call
site), `make check-routes-tracked`. After pushing, check the dev build:
`gcloud builds list --project=aipla-dev-2026 --region=europe-north1`.

**Do not:** read prod BigQuery, Firestore or logs (M0 is M's); give students a session
list or "+ New conversation"; persist or log a device token; change `_synthesize_uid`
(every existing session is keyed by it, and the legacy-owner shim in
`adk/session.py` depends on it); ship M4 without JB's recorded agreement; open a PR
(commit to `dev`, conventional commits).

**Who decides:** M — D1, D2, M5's threshold; JB — D3/M4 (what is collected); M and JB
together — anything resembling per-device or per-student identity (item 27).

## Open questions for M

1. Does M0 show the seminar participants on **one** activity (H1) or genuinely on
   different ones (H3/H4)? M1–M2 are needed either way; M3's priority depends on it.
2. Is the seminar shape (many adults, one code) a real classroom risk, or should M5 be
   a seminar runbook line ("one code per participant") instead of product?
3. D3: is a per-turn device **count** acceptable under ADR-001 without JB, or does it
   go to JB with the consent-prompt question?
4. Should the 1.1.53 rule "the group is one logical user on N screens" be stated to
   students explicitly (M2's label), or is that a teacher-only concept?
5. Does item 27 (individual codes composable into groups) now move up, given a code is
   evidently being treated as personal by teachers themselves?
