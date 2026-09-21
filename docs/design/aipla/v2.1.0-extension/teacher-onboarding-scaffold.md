# Teachers need help getting started — a scaffold, and a way to see who is stuck

**Status**: **SHIPPED prod v0.1.60, 2026-09-21** (dev the same morning) — 1.1.124, M0–M3 in sprint [RSCH-ONBOARD-1](teacher-onboarding-scaffold-sprint.md) (`1b1e3dda` backend, `078bbc03` frontend, `2951e17c` copilot). The checklist mounts at the top of `/teacher/classes` rather than on a new `/teacher` home — see the sprint plan's decisions; 1.1.125 decides what Home becomes
**Priority**: **P1** — third occurrence of the same signal (21-Aug triage, 1-Sep meeting *"teachers find the UI difficult"*, now JB's 19-Sep mail). The previous response was [1.1.96 friction telemetry](../v1.1.0-feedback/teacher-ui-friction-telemetry.md), M0–M2 still open. This doc is what to do *while* that instrumentation is missing, using state we already store
**Estimated**: **~2d** (M0 stuck-teacher column ~0.5d · M1 first-run checklist ~0.75d · M2 hand a teacher a ready class ~0.5d · M3 guide + copilot alignment ~0.25d)
**Scope**: Frontend — `/teacher/classes` (both scopes), one new component on the teacher home; Backend — one derived field on the class-activity summary, one route (M2). **Sits inside extension workstream C**
**Source**: JB, 2026-09-19: *"I am experiencing more and more that the teachers I am giving access need help getting started"* — and Mark's reply: *"I will look at more tools to help you manage the teacher onboarding and clearer UI to make it easier"*
**Related**: [1.1.123 researcher-acts-for-teacher](researcher-acts-for-teacher.md) (the researcher half — this is the teacher half) · [1.1.125 teacher-surface-consolidation](teacher-surface-consolidation.md) (umbrella) · [1.1.96](../v1.1.0-feedback/teacher-ui-friction-telemetry.md) (the instrument this is a stopgap for) · [ACCESS-1 / 1.1.76](../v1.1.0-feedback/public-access-tiers-and-spend-control.md) (the register a granted teacher appears on) · `backend/protocols/teacher_bootstrap_routes.py` (the demo class every teacher already gets) · guides `t1`–`t4`

## What "getting started" actually is, and where it breaks

A granted teacher's path, as the product currently defines it:

```
granted on the register (JB, /teacher/programme)
  → first sign-in: bootstrap seeds "Demo class" + example activities + a join code
    → create a real class                       (t1, Step 1)
      → mint a group code                       (t1, Step 2)
        → create or adopt an activity           (t2)
          → assign it to the class
            → share the join LINK with students  (t1, Step 3)
              → first student turn
```

Seven steps, across three pages, with the guides on a fourth. The bootstrap
was a real improvement — nobody lands on an empty screen — but it means the
common stuck state is **not** "no class". It is **"still only the demo class,
three weeks after being granted"**, and today nothing anywhere shows that.

Two facts from the codebase constrain the design:

1. **We can already see every step of that funnel from stored state**, per
   teacher, without telemetry: the register row (`grantedAt`), the classes a
   uid owns and whether any is non-demo, `groupCodes.length`, assigned
   activities, and `summarize_activity_for_group_codes` (turns, groups that
   spoke, last message — already in the class list). 1.1.96 is needed for
   *where in the builder* a teacher stalls; it is not needed for *whether*
   they have started.
2. **The demo class is the first thing every teacher sees**, and its example
   activities are the ones they are most likely to copy. It is therefore the
   most-read onboarding surface we have, and it is maintained as seed data
   rather than as a guide. Whatever it teaches, it teaches by example.

## Milestones

### M0 — See who is stuck · ~0.5d · the researcher's view · ✅ shipped

On `/teacher/classes` in scope **All**, and on `/teacher/programme` beside each
granted row, a derived **stage** per teacher:

| Stage | Derived from | Reads as |
|---|---|---|
| Granted, never signed in | register row with `uid: null` | *"Invited 12 days ago — not signed in"* |
| Signed in, demo only | owns exactly the bootstrap class | *"Demo only — 9 days"* |
| Class, no code | non-demo class, `groupCodes = []` | *"No join code"* |
| Code, no activity | codes minted, no assigned activities | *"No activity assigned"* |
| Ready, no students | activity assigned, `turns = 0` | *"Waiting for students"* |
| Live | `turns > 0` | last message, relative |

The stage is one small function over data the page already holds, plus the
register's `grantedAt`/`uid` which `/teacher/programme` already renders. It is
sortable, so *"stuck longest"* is one click. Every stage also names the next
step — the wording is the guide's own step heading — so the researcher's
message to the teacher writes itself.

**Acceptance:** JB can answer *"which of the teachers I granted this month
have not got past the demo class?"* from one screen.

### M1 — The first-run checklist · ~0.75d · the teacher's view · ✅ shipped

The teacher home (`/teacher`, today a bare redirect to `/teacher/classes`)
becomes a **progress card** driven by the same stage function, shown until
the teacher reaches *Live* and dismissible after that:

```
Getting started                                  3 of 5
 ✓ Create a class                                 Physics 1.g
 ✓ Mint a group code                              aipla-…
 ○ Add an activity           → Create one · Adopt from the library
 ○ Share the join link       → Copy link
 ○ First student conversation
```

Each incomplete step is a link to the exact control, not to a guide. The
guide link sits under the card as *"prefer to read?"*. This is the same
state-driven shape as the class page's *"No messages yet"* cell — said in
words, never a blank.

**The "Add an activity" step is where teachers stall** (28-item feedback list,
1.1.86, and JB's mail all say the builder is the hard part), so that step
offers **Adopt** first: the shared catalogue's newest published activity for
the class's subject, one click, no builder. The builder is the second offer.

**Acceptance:** a newly granted teacher sees the card on first sign-in after
the demo seed; each step's link lands on the control it names; the card
disappears on its own once students are talking.

### M2 — Hand a teacher a ready class · ~0.5d · the researcher's shortcut · ✅ shipped

With [1.1.123](researcher-acts-for-teacher.md) M2 in place a researcher can
build inside a teacher's class. This milestone makes the common case one
action: from the researcher's own class list, **"Set up for a teacher…"** —
pick the teacher (from the register), pick one of the researcher's own
classes as the template, and the system creates a class **owned by the
teacher** with the template's activities (copied, owned by the teacher, per
1.1.123's ownership rule) and one minted code. The teacher's checklist then
opens at step 4, *share the join link*.

Backend: `POST /api/classes/for-teacher` — researcher-only, reuses
`create_class`, `copy_activity(new_owner_uid=teacher)`, `add_activities` and
the mint route's spend gate **evaluated on the teacher** (a visitor-tier
teacher gets the class but no code, same as today's bootstrap rule). Every
row stamps `last_edited_by` from 1.1.123 M3.

**Acceptance:** JB can take a teacher from *"Demo only"* to *"Waiting for
students"* without the teacher doing anything, and the teacher owns the
result outright.

### M3 — Make the guides and copilots say the same thing · ~0.25d · ✅ shipped

- `t1`/`t2` (both languages) reference the checklist instead of restating the
  steps; `guide-maintenance` staleness check covers this.
- `aipla-help` copilot gets the stage as context (one line in its prompt
  input: *"this teacher is at stage N"*), so *"how do I start?"* is answered
  with the next step, not the whole guide. Mark's *"the AI Copilot should
  help, is that any use?"* is only true if the copilot knows where the
  teacher is.

## What this does not do

- No telemetry. 1.1.96 stays the answer for *where inside the builder*; this
  answers *whether they started*, from state.
- No mail or reminders to teachers. The researcher sees who is stuck and
  decides; the product does not nag.
- No change to the demo bootstrap's content. If the example activities are
  the wrong examples, that is a content review for AR, not a code change —
  flagged in [1.1.125](teacher-surface-consolidation.md) as a question.

## Open questions

1. **Is "Demo only after N days" a reliable stuck signal?** Some teachers are
   granted weeks before a course starts. M0 shows the days and lets JB judge;
   it does not threshold. Revisit after October's grants.
2. **Should M2's template be a *published activity set* rather than one of the
   researcher's classes?** Simpler if the researcher keeps a "starter class"
   per subject as a plain class — no new concept. Start there.
