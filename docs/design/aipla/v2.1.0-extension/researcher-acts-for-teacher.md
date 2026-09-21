# A researcher acts for a teacher — from moderation to assistance

**Status**: **SHIPPED prod v0.1.60, 2026-09-21** (dev the same morning) — 1.1.123, M0–M3 in sprint [RSCH-EDIT-1](researcher-acts-for-teacher-sprint.md) (`221a41e3` backend, `e5191518` frontend). M3 shipped as option 1 (the passive line); the notice question below is still JB's to answer
**Priority**: **P1** — a researcher asked to help a stuck teacher and the answer today is "publish something and ask them to adopt it". The backend half of the write path has existed since June with no UI on it
**Estimated**: **~1.5–2d** (M0 ownership-aware pages ~0.5d · M1 wire the shipped M3b writes ~0.25d · M2 class writes on behalf ~0.5d · M3 attribution + notice ~0.5d · tests throughout). M3 is gated on one JB/AR answer, below
**Scope**: Backend — `classes_routes.py` write guards, one attribution field; Frontend — `/teacher/classes/[id]`, `/teacher/activities/[id]`, the research views. **No new claim, no new role**
**Source**: JB, mail 2026-09-19: *"I am experiencing more and more that the teachers I am giving access need help getting started. It would be nice if I can make the first activity for them — or edit an activity if they're lost. Or is that already possible for me to do?"*
**Related**: [1.1.5 researcher-role](../v1.1.0-feedback/researcher-role.md) (the read bypass this extends — and which explicitly listed *"researcher edit / write privileges — not asked for"* under out-of-scope; now asked for) · [ALS-SHARE M3b](../v1.1.0-feedback/implemented/activity-library-sharing-share-sprint.md#m3b--researcher-crud-over-all-moderation) (the activity write bypass, shipped backend-only 2026-06-26) · [1.1.124 teacher-onboarding-scaffold](teacher-onboarding-scaffold.md) (the sibling: what the teacher sees) · [1.1.125 teacher-surface-consolidation](teacher-surface-consolidation.md) (the umbrella) · CLAUDE.md footgun *"a whole stack ships with the control unmounted"*

## The answer to JB's question, as of 2026-09-21

**Read: yes, everywhere. Edit: the backend says yes for activities and no for
classes; the UI says no for both; and one control on the class page quietly
says yes.** Three different answers to one question, which is the actual bug.

| Resource | Backend permits a researcher | The UI exposes |
|---|---|---|
| Class — read, sessions, spend, signals, live | ✅ read (`_load_readable`, span-tagged) | ✅ Classes → scope **All** |
| Class — rename, add/remove activity, mint/delete codes, reset session, delete | ❌ `_load_owned` → **404 "class not found"** (`classes_routes.py:118`) | ⚠️ **Manage** is rendered for every class in All scope; the detail page has no ownership awareness, so every control is shown and every one fails with a message that reads as a bug |
| Class — set tutor (`PUT /api/tutors/class/{id}`) | ✅ **write** (`tutors_routes.py:218`) — the one class write that admits a researcher, undocumented as an exception | ✅ works — the only control on another teacher's class page that does |
| Activity — get, patch, facets, delete, publish/unpublish | ✅ **write** (`_load_for_modify`, `activity_routes.py:123`) — M3b | ❌ Research view and its detail say *"read-only, nothing here is editable"*; the class list's comment says the same (stale since June). The editor at `/teacher/activities/[id]` **works on another teacher's activity by URL** — nothing links to it |
| Activity — create *into* a class (`POST /api/activities` + `classId`) | ❌ owner check on the class (`activity_routes.py:218`) | n/a — the *"make the first activity for them"* case has no path at all |

The 1.1.5 design was coherent: observation is read-only, and the OTel span
`auth.researcher_bypass` answers "who looked at what". M3b then opened writes on
activities for **moderation** — cleanup of a public catalogue — as a backend
milestone, and the frontend never followed. JB is now asking for writes for
**assistance**, which is a different purpose with a different audit question:
not "who looked" but "who changed a teacher's live class, and does the teacher
know".

## Decision: extend the bypass to classes, and make the UI say what it does

Three alternatives were considered and rejected:

- **Keep read-only; researcher publishes, teacher adopts.** This is today's
  workaround and it fails the stated need — the teacher who is *lost* is the one
  being asked to perform the adopt step. It also creates a second `activity_id`
  under the teacher, so a later edit by the researcher does not reach the class.
- **Add the researcher as a co-owner of the class.** Multi-owner classes are a
  data-model change (`owner_uid` is a scalar read by ~35 call sites, the spend
  gate, and the chat-log stamp). It answers a question nobody asked — JB does not
  want to *own* the class, he wants to fix it and leave.
- **A separate "assist" claim.** 1.1.76 already split `role` from
  `programmeAdmin` because the questions differ (reading data vs committing
  money). Editing a teacher's class is closer to reading their data than to
  spending: same people, same trust basis, same audit shape. A third claim would
  be a real cost (grant CLI, per-env sync, the *claims never sync* footgun) for
  no boundary anyone has asked to draw.

So: **`role:researcher` may write on any class and any activity, and every
surface that lets them says so.** The bypass stays a bypass at the check layer
(ADR-014 unchanged), the span tag stays, and the write adds an attribution the
read never needed.

## Milestones

### M0 — Ownership-aware pages · ~0.5d · frontend · ✅ shipped

The class detail page and the activity editor learn whose resource they are
showing. Both already receive `ownerUid` (and `ownerLabel` in All scope).

- A banner at the top when `ownerUid !== currentUid`: **"You are editing
  {ownerLabel}'s class as a researcher."** Same on the activity editor. The
  copy lives in a `copy` object per 1.1.108 M4.
- ~~Until M2 lands, the class page **disables** the owner-only controls~~ —
  M0 and M2 shipped in one sprint, so the interim step was skipped; the
  controls simply work. *(Kept as the rule for any future page: never let a
  control fail with a 404 that reads as a bug.)*
- The class list's Research-scope activity titles become links again (they
  were made plain text on the belief the editor would reject them; it does
  not).
- Delete the stale *"read-only"* claims from the research activity list and
  detail, and from `r1-researcher-onboarding.md`, which promises *"you do not
  edit their work"*.

**Acceptance:** a researcher opening another teacher's class or activity sees
the banner; a teacher opening their own sees no change.

### M1 — Wire the M3b writes that already exist · ~0.25d · frontend · ✅ shipped

- Research activity detail (`/teacher/research/activities/[id]`) gains **Open
  in editor** → `/teacher/activities/[id]` (which already works) and
  **Unpublish** (the `visibility` route). The list gains the visibility toggle
  the teacher library already renders (`activityDisplay`'s `VisibilityBadge`
  becomes the toggle for researchers).
- Nothing new on the backend. This is the CLAUDE.md footgun closed: grep for
  the call site, not the function — after M1, `_load_for_modify`'s write
  branch has one.

### M2 — Class writes on behalf · ~0.5d · backend + frontend · ✅ shipped

- `classes_routes.py`: the write routes move from `_load_owned` to a new
  `_load_editable` = owner **or** researcher, span-tagged — the write twin of
  `_load_readable`. **Kept owner-only: `DELETE /{class_id}`.** Deleting a
  teacher's class is not assistance; a researcher who needs it can ask.
- `POST /api/activities` with `classId`: the class check uses the same
  `_load_editable`, so *"make the first activity for them"* becomes: open the
  teacher's class in All scope → **Add activity** → the activity is created
  **owned by the teacher** (`owner_uid = cls.owner_uid`, not the researcher's).
  This is the one place ownership is assigned rather than checked, and it is
  deliberate: the activity must show up in the teacher's own library, and the
  teacher must be able to edit it without the bypass. `source_owner_uid` is
  not used — that field means *adapted from* and this is *authored for*.
- `PUT /api/tutors/class/{id}` is left as is; it was already right, and this
  milestone makes it the rule rather than the exception.
- Re-enable the M0-disabled controls.

**Acceptance (one test per write, against the real dispatcher — the
dual-auth lesson):** a researcher can rename, add an activity to, mint a code
for, and create an activity inside another teacher's class; a plain teacher
still gets 404 on each; the created activity lists under the *teacher's*
`owner=me`; `DELETE` still 404s for the researcher.

### M3 — Attribution and the teacher's notice · ~0.5d · ✅ attribution shipped (option 1); the notice is the open question

Every write that goes through the bypass stamps `last_edited_by: {uid, at}` on
the class or activity document (a new optional field; `updated_at` already
exists on activities and is bumped regardless). The class page and the
activity History panel (M-HIST) render it: *"Last edited by JB, 2 hours ago."*

**The open question for JB/AR** — not a UI question: **does a teacher need to
be told when a researcher edits their live class?** Options, cheapest first:

1. The History/last-edited line only (passive, always on) — sufficient if the
   working assumption is that a researcher edits *with* the teacher, on a call
   or in a mail thread, which is the situation JB describes.
2. A one-line notice on the teacher's class page until dismissed — *"JB
   edited this class on 21 Sept"*.
3. A mail. Not recommended: there is no mail path from the app today and this
   would not be the reason to build one.

Recommendation: **1**, and revisit if a teacher is ever surprised. The
research-ethics dimension — the classes' *data* — is untouched by this doc:
the read bypass and its audit are what they were, and no student-facing
behaviour changes because a researcher edited a configuration.

## What this does not do

- No approval or review gate on researcher edits — M3b's Q3 already decided
  post-hoc trust for the research-mode set; this inherits that.
- No researcher impersonation ("view as teacher X"). The banner is enough to
  know whose class it is; impersonation would need the copilots to act under
  another identity, which is a different and larger design.
- Does not touch the copilots. `manage-class` and `activity-authoring-assistant`
  act as the signed-in user against the routes above, so after M2 a researcher's
  copilot can operate on a teacher's class for free — no work, and worth a test.

## Guards this adds to the footgun table

**"A resource page shows controls the caller cannot use."** Symptom: a
researcher clicks Manage, every button 404s with an enumeration-resistant
message that reads as a bug. Guard: any page that loads a resource carrying
`ownerUid` renders against `canEdit(resource, user)` and never lets a write
fail with the read's 404. Status after M0: manual; a component test on the
class page asserting the disabled state for a non-owner is the cheapest witness.
