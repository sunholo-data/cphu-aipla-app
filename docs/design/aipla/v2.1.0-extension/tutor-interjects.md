# The tutor interjects when its teaching approach says to

**Status**: **PROPOSED — needs a research decision before any build** 2026-11-24 — **1.1.162**
**Priority**: **P2**. Nothing is broken without it. It becomes P1 if AR/JB make interjection a variable in the tutor comparison study ([notes-2026-11-19](../../../notes-2026-11-19.md))
**Estimated**: decision ~0.25d · M1 interjection policy as tutor data ~0.75d · M2 the *stuck* trigger ~0.5d · M3 the workbench trigger ~0.5d · M4 the group-talk trigger ~0.5d · M5 every interjection logged with its cause ~0.5d. **~3d** after its dependencies, which are another ~3.5d ([1.1.161](live-status-counts-workbench-work.md) ~1.5d, [group-talk-to-tutor](group-talk-to-tutor.md) ~2d)
**Scope**: Backend: `backend/frameworks/*.yaml` + `frameworks/loader.py` (an optional `interjection` block), `protocols/proactive_routes.py` (the gate reads it), the chat-log row (a `trigger` field). Then `make tutor-docs` regenerates the public tutor pages. Frontend: the existing `useProactiveEventCheck` handoff, unchanged in shape
**Dependencies**: [proactive-sim-reactive-tutor](../v1.1.0-feedback/implemented/proactive-sim-reactive-tutor.md) (**shipped**, the gate) · [1.1.154 tutor-pacing-and-reactivity](../v1.1.0-feedback/tutor-pacing-and-reactivity.md) (**open**: M1 *never interrupt a draft* is a hard prerequisite, and M4 *proactive budget as data* is the same knob at skill level) · [1.1.161](live-status-counts-workbench-work.md) (a *stuck* signal worth trusting) · [group-talk-to-tutor](group-talk-to-tutor.md) (the tutor hears the room) · [tutors-handover-2026-09-10](../v1.1.0-feedback/tutors-handover-2026-09-10.md) (the passthrough guarantee)
**Source**: [notes-2026-11-23-session-feedback.md](../../../notes-2026-11-23-session-feedback.md), point 4: *"we are also contemplating the tutor could be more active and interject as needed."*

## What the tutor does today

It speaks without being asked in exactly these cases
(`protocols/proactive_routes.py`, `lib/proactiveEventCheck.ts`):

| Trigger | Since | Gates |
|---|---|---|
| Group joins (greeting) | Phase A, June 2026 | once per session, outside the cooldown |
| Sim events: `sim_run`, `step_advance`, `measurement_commit`, `completion` | 1.1.2, 1.1.140 | 30 s session-wide cooldown, optional `proactive_max_per_session` per skill, an allowlist |
| Checklist step marked done | via `step_advance` | the same |

It never speaks because of **silence**, a **table or writing** entry, the
group's **spoken discussion**, or a *stuck* flag on the teacher's screen.

## The history this has to respect

- **June 2026: the idle check-in was retired before it was built**
  ([proactive-tutor.md](../v1.0.0-pilot/proactive-tutor.md), Phase B): it
  overlapped with the greeting and *"risks anti-Socratic interrupts"*.
- **22 October 2026: the opposite complaint.** *"Needs to be more reactive to
  the student (although a flood of notifications)"* and *"the students were
  trying to answer"*. 1.1.154 found that the flood was mostly **trust cards**,
  and that a proactive turn could start **while a student was typing**.
- **23 November 2026: "more active, interject as needed".**

These are not contradictory. The complaints are about interjections that were
**badly timed** (mid-draft) or **about nothing** (every press of *Run*). The
request is for interjections that are **about something** (a group stuck, a
wrong reading, a claim worth challenging in the discussion). So the design
problem is the triggers and the timing, not the volume.

## Decision (proposed)

**How readily the tutor interjects is a property of its teaching approach,
declared as data, like everything else about a tutor since 1.1.91.**

Some approaches want restraint. Accountable Talk turns Rowe's wait time into
*"do not answer your own question, do not fill the turn"*
(`frameworks/accountable-talk.yaml:38-42`). Others, such as a didactic arm or
POE's observe step, want the tutor to step in. A single global setting would be
wrong for one of them, and a per-approach setting makes interjection
**measurable in the tutor comparison**, which is where the master's student's
study lands.

```yaml
# backend/frameworks/<approach>.yaml — optional; absent = today's behaviour
interjection:
  triggers: [completion, measurement_commit, stuck, group_talk_claim]
  min_spacing_seconds: 90       # replaces the 30 s constant for this approach
  max_per_session: 6
  on_silence: never             # never | after_minutes: N (only with `stuck`)
  rationale: >                  # rendered on /project/tutors, like every other field
    Why this approach steps in when it does, with a citation.
```

**Precedence.** The skill sets the ceiling (1.1.154 M4: `proactiveMaxPerSession`,
`proactiveMinSpacingSeconds`), and the approach decides **which triggers** and
**how readily** within it. The skill is the activity, the approach is the
pedagogy: a teacher can turn the noise down for a lesson, and the tutor cannot
exceed that.

**Passthrough guarantee.** A framework without an `interjection` block, or no
framework at all, behaves byte-for-byte as today. That is the same rule as
`load_framework(None)`.

**Never mid-draft.** Every trigger in this doc rides 1.1.154 M1: a proactive
turn waits while the composer has text in it. Without M1, a more active tutor
is the 22 October complaint made worse. **M1 of 1.1.154 ships first or this
doc does not start.**

## Milestones

### M0 — evidence (~0.25d, M runs the queries)

Read-only, prod, 2026-11-23:

- How many proactive turns fired, by trigger (the user message is the sentinel
  `[event_reactive:<kind>]`), and how many the gate **refused**, by reason
  (`cooldown active`, cap, allowlist). If most refusals are cooldown, the
  tutor was already trying to be more active and the knob is too tight.
- How long after the last student message each proactive turn landed, and
  whether a student message followed within ~10 s (the *trying to answer*
  signature from 22 October).

### Decision with AR/JB (~0.25d)

1. Is interjection a **research variable** (differs between the compared tutors
   and is logged), or a **product default** (same everywhere, tuned)? The schema
   above serves both, but the defaults differ.
2. Which approaches get which triggers, and is any trigger off-limits for
   pedagogical reasons, for example silence for Socratic?

### M1 — interjection policy as tutor data (~0.75d)

The `interjection` block in the framework schema and loader, read by the
proactive gate after the skill ceiling. Generated docs regenerate
(`make tutor-docs`; `make check-tutor-docs` is CI-gated). Researcher-editable
in-app like the rest of the tutor.

### M2 — the *stuck* trigger (~0.5d, needs 1.1.161)

A new `MEANINGFUL_EVENT_KINDS` entry `stuck`, raised server-side from the
corrected live signal. It is never raised from the client, because the server
knows the signal. Keep the backend/frontend set equality in
`test_proactive_reactive.py`.

### M3 — a workbench trigger (~0.5d)

A deliberate workbench commit (a completed table row, a submitted writing
draft) becomes an event kind, as `measurement_commit` already is for sims.
Keystrokes never count.

### M4 — the group-talk trigger (~0.5d, needs group-talk-to-tutor M0)

With the recent transcript in context, the tutor may interject on a claim in
the discussion, only for approaches whose `setting` is `group_talk`. This
inherits group-talk-to-tutor's consent gate unchanged.

### M5 — every interjection says why (~0.5d)

The chat-log row gains `trigger` (`greeting | completion | stuck | …`) instead
of the reader parsing it out of a sentinel string. The research views can then
count interjections per tutor, which is the comparison the study needs.

## Acceptance criteria

- A framework with no `interjection` block produces exactly today's proactive
  turns (same tests, unchanged).
- A framework that lists `stuck` interjects once when a group goes from working
  to stuck, and not while the composer has text.
- No proactive turn exceeds the skill's ceiling, whatever the framework says.
- Each proactive turn's log row names its trigger.

## What this doc deliberately does not do

- It does not choose numbers. 1.1.154 records why: JB retracted the last ones.
- It does not bring back the idle heartbeat as a global feature. Silence is
  only ever a trigger an approach opts into, and only with *stuck*'s evidence
  of earlier work.
- It does not let the tutor hear the room. That is
  [group-talk-to-tutor](group-talk-to-tutor.md), with its own consent gate.
