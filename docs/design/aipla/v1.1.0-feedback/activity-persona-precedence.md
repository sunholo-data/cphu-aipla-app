# The activity says what to learn, the tutor says how to teach — precedence, detection, and a clean import

**Status:** Design (OPEN) — **1.1.141**
**Priority:** **P2** — the likeliest reason JB sees personas "give the same answers" in real lessons, while BENCH-2 sees the approaches differ in previews
**Estimated:** ~1.5–2d (M0 measure first ~0.25d · M1 explicit precedence block ~0.25d · M2 authoring-time conflict lint ~0.75d · M3 clean import ~0.5d · M4 re-measure ~0.25d)
**Scope:** Backend: a new `adk/teaching_precedence.py` + one line in the composition in `adk/agent.py`; `activity_copilot` / activity import path; an analysis-model lint call at save time. Frontend: one warning in the activity editor. Research: the 1.1.140 M3 real-session harness
**Dependencies:** [1.1.140](meeting-2026-09-29-followups.md) M3 (real-session fidelity, **the before/after measure**); [BENCH-2](tutor-discrimination-benchmark-sprint.md) (fit-all + tone, fidelity-r2); [1.1.98 teaching-prompt-standardisation](teaching-prompt-standardisation.md) (open, the wider prompt-hygiene effort this is one slice of); `adk/teacher_focus.py` (`{teacher_focus}` placeholder, `build_ilo_precedence_block`); `adk/tutor_framework.py` (`inject_framework_preamble`). **Un-gated**
**Created:** 2026-09-30
**Source:** 09-29 meeting: *"There is a risk of conflict if an activity prompt and tutor persona have contradictory instructions. It was suggested that the import process could strip personality traits from activities."* Also *"different tutor personas sometimes gave the same answers"* and the AI suggestion *"a definitive technical solution for resolving conflicts between lesson descriptions and tutor personas was not established."* Split out of 1.1.140 M4

## Problem Statement

A lesson turn's instruction is composed, verified in `adk/agent.py` /
`adk/teacher_focus.py` (2026-09-30), roughly as:

```
SKILL.md body, with the ACTIVITY's teacher focus substituted INSIDE it ({teacher_focus})
  + curriculum grounding
  + the TUTOR's approach preamble     (inject_framework_preamble: appended after the body)
  + image / style / opening / reactive guidance
  + house style (notation, praise) + the persona's identity
```

Two things follow.

1. **Nothing states which one governs *how to teach*.** The activity's teaching goal
   is written by a teacher, often with the co-pilot, and routinely carries pedagogy and
   tone (*"be encouraging, give hints freely"*, *"act as a friendly guide"*, *"if they
   are stuck, show the method"*). The approach says *"elicit, recognise, use"* or
   *"predict before you explain"*. The approach comes **later**, and the file's convention
   is "later instruction wins", but that convention is ours, not the model's. With no
   explicit rule, a small model **blends** the two. A blend of ESRU and "give hints
   freely" looks like every other tutor, which fits what JB saw.
2. **The persona leaks in from the activity side too.** An activity drafted before
   tutors existed, or copied from one written for Sofie, may describe a character. The
   tutor then has two identities.

**What we know and what we do not.** Prod tutors *do* carry their approaches, and every
turn is stamped (verified 2026-09-30). BENCH-2 shows the approaches differ
modestly in **preview**, which has no activity text. We have **not** measured real
sessions, where the activity text is present. So M0 measures before anything changes.

## Design

### M0 — Measure first (~0.25d, runs on 1.1.140 M3)

Run the real-session fidelity harness on 26–30 Sep prod sessions. For each
session, record whether its activity's teaching goal contains pedagogy or tone
instructions, using M2's lint offline. **Prediction:** sessions whose activity text
carries pedagogy score a smaller own-column margin. If they don't, this doc drops to
P3 and M1–M3 wait.

### M1 — Say the precedence out loud (~0.25d)

A short block, `adk/teaching_precedence.py`, composed **immediately after** the approach
preamble and only when a framework is present (so the passthrough guarantee holds:
no framework, no block, byte-identical):

> *The activity description says what the students should learn and do. The
> teaching approach above says how you teach it. If the activity description tells
> you how to teach (tone, hints, how much to explain, what character to play) and
> that conflicts with the approach, follow the approach, and keep the activity's
> learning goals.*

Language-neutral prose (content-localisation rule). Unconditional given a framework,
like the notation and praise blocks. Tests: present with a framework, absent without,
placed after the approach preamble.

### M2 — Tell the teacher at authoring time (~0.75d)

On activity save (and on the co-pilot's draft), one **analysis-model** call reads the
teaching goal and returns spans that are **pedagogy or persona**, not content:
*tone*, *how much to explain or hint*, *character/role*, *answer-giving policy*. If the
activity has a tutor assigned, it also checks each span against that tutor's approach
constructs (the same generated criteria the fidelity judge uses, so no second
description of the approach to drift).
- The editor shows a **non-blocking** warning beside the teaching goal: *"These lines tell
  the tutor how to teach. Mikkel teaches with ESRU, which will take precedence: [span]"*,
  with **"Move to tutor notes"** and **"Keep"**.
- Once per save, never per turn. Cached by a hash of the text. Costs pennies per activity.
- Teacher-facing copy in `messages/{da,en}/teacher-activities.json` via `useT`.

### M3 — A clean import (~0.5d)

When an activity is created by the co-pilot, copied from the library, or imported:
run M2 and **move** detected persona and tone spans into a separate, visible
`tutorNotes` field on the activity, instead of leaving them in the teaching goal. The
teacher sees what moved. `tutorNotes` is shown to the tutor **only when the activity has
no tutor with an approach**, which keeps today's behaviour for tutor-less activities and
removes the conflict everywhere else. This is the meeting's *"strip personality traits
on import"*, made reversible and visible rather than silent.

### M4 — Re-measure (~0.25d)

Re-run M0's selection on sessions after M1 ships (one teaching week). Report the
own-column margin before and after, per approach, in this doc. If the margin does not
move, the blend is not the cause, and the next suspect is the model tier (1.1.142 escalation
data, BENCH's 3.8-flash row).

## Out of scope

- Changing the approach instructions themselves (researchers' remit, 1.1.91).
- Per-turn conflict detection. Too costly and too late; authoring time is the lever.
- Rewriting existing activities in bulk. M3 applies to new, copied or imported ones; old
  ones get M2's warning when next edited.

## Open questions

1. **(JB)** Is "follow the approach over the activity's tone" right for every approach? For
   Accountable Talk the activity's group-work instructions may *be* the approach.
2. **(M)** Should `tutorNotes` exist, or should detected spans simply be deleted with an undo?
   Recommendation: keep them, since teachers trust changes they can see.
