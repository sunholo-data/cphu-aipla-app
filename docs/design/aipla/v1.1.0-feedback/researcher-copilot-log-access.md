# Researcher (and teacher) access to teacher co-pilot logs

**Status:** DESIGN — **gated on a governance/consent decision** (see §1). The
engineering below is ~2–3d and small; it must **not** ship ahead of the consent
call. No code yet.
**Last Updated:** 2026-06-30.
**Priority:** P1 — surfaced during the 2026-06-30 activity-co-pilot browser-verify
(M: *"this data should be available for researcher"*). The research programme
studies how teachers work with the AI; today the teacher↔co-pilot transcript is
captured but reaches neither the research store nor any reader.
**Estimated:** ~2–3d engineering (pipeline tag ~0.5d · session tagging ~0.5d ·
access + researcher surface ~1d · teacher history list ~0.5–1d, shared with
[teacher-coworking-copilot.md](teacher-coworking-copilot.md) Part 4b). **Plus an
unbounded governance step that precedes all of it.**
**Scope:** Backend (one logging-callback change + a session-index field + a
researcher-bypass route) · frontend (a researcher transcript view + the teacher's
own history list). No new datastore, no new auth mechanism — all reuse.
**Dependencies:** [researcher-role.md](researcher-role.md) (1.1.5 — `is_researcher`,
`assert_can_read_class` shipped) · [researcher-analytics-rollout.md](researcher-analytics-rollout.md)
(sibling — but that covers **student** data; this is a different data class) ·
[teacher-coworking-copilot.md](teacher-coworking-copilot.md) Part 4b (the teacher
history surface + session tagging — built jointly here).
**Source:** 2026-06-30 — M, during the co-pilot verify: co-pilot logs should be
available in the UI for the teacher *and* the researcher. Audit found: captured,
but not surfaced and not in the research store.

## TL;DR

Every teacher↔co-pilot turn is already **persisted** (ADK sessions + the Firestore
`chat_sessions` mirror). Three things are missing, and they are not equal:

1. **The data never reaches the research store.** The chat-log → BigQuery pipeline
   deliberately drops non-student sessions, so teacher co-pilot turns are invisible
   to research tooling.
2. **No reader exists** — neither a teacher history list (only single-thread resume
   ships, Part 4a) nor any researcher view.
3. **It is excluded from researcher access by design** — `researcher-analytics-rollout.md`
   widens researcher reach over *student* engagement data only.

The engineering to fix all three is modest. **The hard part is #1's precondition:
teacher AI-assistant conversations becoming research data is a consent + data-
governance decision, not a toggle.** This doc sequences the consent gate ahead of
the pipeline change.

## 1. Governance gate (the long pole — clears before any code) 🔒

Recording teacher↔AI conversations and exposing them to researchers is a
**materially different** act from aggregating anonymous student *group* data (which
is what every existing research surface does). It is teacher *behaviour* data, tied
to an identifiable teacher (Firebase uid / UCPH SSO), not an anonymous group code.

Before the pipeline filter is relaxed, the programme needs an explicit answer to:

- **Legal basis (GDPR).** On what basis is teacher conversation data processed for
  research? Consent, legitimate interest, or contract? UCPH is the controller.
- **Teacher notice / consent.** Are teachers informed that their co-pilot
  conversations are retained and read by researchers, and have they agreed? Is it
  opt-in, opt-out, or contractual to participation?
- **Retention + scope.** How long are co-pilot transcripts kept for research, and
  which researchers (the `role:researcher` holders: M, AR, JB) may read them?
- **Separation from student data.** Teacher-behaviour data must remain
  distinguishable from student-research data at every layer (see §2.1).

**Ownership:** this is M + AR/JB + (almost certainly) **UCPH data protection**. The
*"may we / on what basis / what notice"* framing belongs in the scoping site
(`~/Documents/clients/cph-uni`), not this repo. This doc treats a written
go/no-go + the consent mechanism as a **hard precondition** — the §2 milestones are
blocked until it clears. (Per the execution-vs-scoping split: the *why/may-we* is
scoping; the *how* is here.)

> **Do not relax the pipeline filter until this gate is signed off.** Shipping the
> capture ahead of consent is the failure mode this section exists to prevent.

## 2. What's captured today vs the gap

| Layer | Today | After |
|---|---|---|
| ADK session (canonical) | ✅ persisted ([protocols/agui.py](../../../../backend/protocols/agui.py) `use_thread_id_as_session_id=True`) | ✅ unchanged |
| Firestore `chat_sessions` mirror | ✅ per-session index ([db/chat_sessions.py](../../../../backend/db/chat_sessions.py): `sessionId, skillId, ownerUid, turnCount, …`) | ➕ tagged with `kind` + scope (§2.2) |
| Chat-log → BigQuery (research store) | ❌ **dropped** — [adk/callbacks/session.py](../../../../backend/adk/callbacks/session.py) `if not group_code: return` (teacher/workshop sessions excluded) | ✅ emitted on a **distinct teacher-co-pilot stream** (§2.1), gated on §1 |
| Teacher reads own past chats | ⚠️ single-thread **resume** only (Part 4a) | ✅ a **history list** (Part 4b, §2.3) |
| Researcher reads co-pilot transcripts | ❌ not in scope ([researcher-analytics-rollout.md](researcher-analytics-rollout.md) is student-only) | ✅ researcher view (§2.3), gated on §1 |

**Framework-native check (per design-doc-creator §5b-ter).** No new plumbing is
invented: the transcript is **already** in ADK session events (replayed for free),
the research path is the **existing** chat-log pipeline, and the authz is the
**existing** `is_researcher` / `assert_can_read_class` helpers. This doc only (a)
stops dropping one stream, (b) adds two index fields, (c) widens one gate, (d) adds
two read surfaces. If any step turns out to need a bespoke store, that's a signal to
stop and re-check — it shouldn't.

### 2.1 Pipeline — emit teacher co-pilot turns on a distinct stream

[adk/callbacks/session.py](../../../../backend/adk/callbacks/session.py) currently
returns early for any session without a `group_code` (teacher/workshop). Instead of
removing that guard (which would dump teacher turns into the student-research tables),
branch it: student turns keep their existing `LOG_ID_CHAT_TURN` path; teacher
co-pilot turns emit with a **role/stream tag** (e.g. `role="teacher_copilot"`,
`skill ∈ {activity-authoring-assistant, manage-class, analytics-chat}`) so BigQuery
can route them to a **separate logical table / partition**. Student-research queries
must be byte-identical afterwards (assert this in tests). The separation in §1 is
enforced *here*.

### 2.2 Session tagging — `kind` + scope on the index (shared with Part 4b)

[db/models/chat_session.py](../../../../backend/db/models/chat_session.py)'s
`ChatSessionIndex` lacks the fields needed to scope/list co-pilot chats. Add:

- `kind ∈ {authoring, manage, analytics}` (derivable from `skillId`).
- a scope handle — `classId` where one applies (manage/analytics class co-pilots),
  acknowledging the **wrinkle**: the *authoring* co-pilot is not class-bound (it's
  teacher + activity), and a manage-class chat may span classes. So the scope is
  **teacher-primary, class-optional** — not the class-primary model student data
  uses. This directly informs §2.3's access shape.

This is the same substrate Part 4b needs; build it once, here.

### 2.3 Access + surfaces

- **Reuse** `is_researcher` + `assert_can_read_class` ([researcher-role.md](researcher-role.md),
  [backend/analytics/auth.py](../../../../backend/analytics/auth.py)). **But** co-pilot
  chats are **teacher-scoped, not class-scoped**, so the researcher bypass can't key
  on class ownership the way student transcripts do. The bypass is: a `role:researcher`
  holder may list/read any teacher's co-pilot sessions; a teacher may read only their
  own (`ownerUid == uid`). The backend already has the list primitives —
  `list_sessions_for_skill` ([db/chat_sessions.py](../../../../backend/db/chat_sessions.py))
  and `GET /api/skills/{skill_id}/sessions` ([skills/routes.py](../../../../backend/skills/routes.py)) —
  unused by the frontend; widen their guard for the researcher and add `kind`/teacher
  filters.
- **Teacher surface (Part 4b):** a history list in the co-pilot panel — past threads
  for this scope, click to resume. Teacher sees only their own.
- **Researcher surface:** a transcript view (likely under the researcher analytics
  area) listing co-pilot sessions by teacher + `kind`, opening a read-only transcript.
  Gated on §1.

## Milestones

> **M0 — governance sign-off (§1).** Not a code milestone. A written go/no-go +
> the consent mechanism, owned by M + AR/JB + UCPH. **Blocks M2–M4.**

- **M1** — session tagging (§2.2): `kind` + teacher/class scope on `ChatSessionIndex`,
  backfilled from `skillId`. Pure substrate; shippable independently and shared with
  Part 4b. *(Not gated on M0 — it's neutral metadata.)*
- **M2** — pipeline branch (§2.1): teacher co-pilot turns emit on the distinct
  stream; student tables byte-identical. **Gated on M0.**
- **M3** — access + researcher transcript view (§2.3). **Gated on M0.**
- **M4** — teacher history list (§2.3 / Part 4b). *(The teacher-reads-own half is
  not gated on M0 — a teacher reading their own chat needs no research consent; only
  the researcher half does.)*

## Acceptance

- A teacher can browse + reopen their own past co-pilot chats (not just resume the
  last one).
- With §1 cleared: a `role:researcher` holder can list + read co-pilot transcripts
  across teachers, by `kind`; the data lands in a research-store stream **separate**
  from student chat logs.
- A teacher cannot read another teacher's co-pilot chats; a non-researcher cannot
  reach the researcher view.
- Student-research BigQuery output (and `chat_log` behaviour for student sessions) is
  **byte-identical** to before — verified by test.
- The pipeline filter is **not** relaxed in any deployed env until M0 is recorded.

## Risk / open questions

- **Consent is the gate, not the code.** The whole value is blocked on §1; do not
  let the small engineering tempt an early pipeline flip.
- **Scope model wrinkle (§2.2).** Teacher-primary scoping differs from the
  class-primary model the rest of the analytics stack uses; get the index shape right
  once so Part 4b and this share it.
- **Two readers, two gates.** The teacher-reads-own surface (M1/M4) is safe to build
  now; the researcher surface (M2/M3) waits on M0. Sequence accordingly so teacher
  value isn't held hostage to the governance timeline.
