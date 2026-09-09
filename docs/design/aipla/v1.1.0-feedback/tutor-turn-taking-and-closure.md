# Knowing when the conversation is over — turn-taking and closure

**Status**: **Design (OPEN)** — **1.1.105**
**Priority**: **P2** — small, un-gated by either legal blocker, and it fixes a behaviour every student meets at the end of every session
**Estimated**: ~1–1.5d (M0 the closing exception ~0.5d · M1 recognising the end ~0.5d · M2 eval ~0.5d)
**Scope**: Backend only — the interaction-style preambles and the four tutor `SKILL.md` files, plus an eval. No schema, no frontend, no new surface
**Dependencies**: [1.1.20 tutor-personas](tutor-personas.md) / `adk/interaction_style.py` (**SHIPPED primitive** — the injection seam and the four styles); [1.1.91 researcher-configurable-tutors](researcher-configurable-tutors.md) (this is one **observable behaviour** of the kind M0 there has to be able to express — build this first, cite it there); [1.1.90 bounded-tutoring-answer-trees](bounded-tutoring-answer-trees.md) (the question *budget* — a sibling problem, the other end of the same axis)
**Created**: 2026-09-09
**Source**: [notes-2026-09-09.md](../../../notes-2026-09-09.md) item 12 — *"Sophia persona — keeps talking even when the conversation is over really"*, and item 13, the in-house dialogue session on *"the bot's style and turn taking"*

## Problem Statement

**The tutor is instructed never to stop, and it obeys.**

The Socratic preamble — the **default** style, applied to every activity that
does not choose otherwise — says:

> *"Every response must end with a question that invites the student to act,
> predict, or describe."*

Unconditionally. The same rule is written inline in four tutor `SKILL.md` files
(`concept-dialogue`, `kinebot-kinematics-tutor`, `led-planck-tutor`,
`problem-set-hints`). **There is no exception for "the work is finished", "the
lesson is over" or "the student has said goodbye"**, and no instruction anywhere
in the prompt stack that permits a turn to end without a question.

So *"Sophia keeps talking when the conversation is over"* is not a persona
misbehaving. It is the prompt contract being followed exactly, by every tutor,
in the one situation nobody wrote a rule for.

### Two details that shape the fix

- **"Sophia" is not in the repo.** No `sophia` string exists anywhere. The eight
  tutors in `backend/skills/templates/` carry names like Jonas; Sophia is a
  **teacher-authored persona name**. So this is not one tutor's bug and must not
  be fixed in one tutor's file.
- **`socratic` is a passthrough — nothing is injected for it.** From
  `adk/interaction_style.py`:

  ```python
  # socratic is the untouched default — no preamble is injected for it this sprint.
  _PASSTHROUGH = "socratic"
  ```

  Which means the platform's *default pedagogy is the absence of a preamble*,
  and the rule that causes this lives duplicated across four tutor files. **The
  de-duplication was already filed as a deliberate follow-up** in that module's
  own docstring. This doc is a good reason to do it, but it is not free and
  should be sized honestly rather than smuggled in.

### Why this is worth more than its size

The three shipped styles that override the rule (`concise`, `rigorous`, `warm`)
each say some version of *"do not end with a follow-up question"* — so the
codebase already knows the rule needs countermanding, and has countermanded it
**three times, per activity, in advance**. What it cannot do is countermand it
**per moment**, which is the only thing that helps here: a tutor should ask a
question in the middle of an investigation and stop asking one at the end,
within a single activity and a single style.

That distinction — a rule that applies *at a phase of the dialogue* rather than
*for a whole activity* — is exactly what the dialogue session (item 13) is
convening to talk about, and exactly the kind of thing
[1.1.91](researcher-configurable-tutors.md) M0 must be able to represent when it
turns a framework into *observable behaviours*. **This is the cheapest possible
first instance of that shape**, which makes it worth building before the
framework work rather than inside it.

## Milestones

### M0 — a closing turn is allowed to close ~0.5d

One exception, stated once and inherited everywhere:

> A turn that closes the conversation ends with an offer, not a question. Say
> what was established, name what is left open if anything, and stop.

**The interesting design choice is where it lives.** Adding it to four
`SKILL.md` files is the fifth copy of a rule already duplicated four times. The
right home is a preamble composed for every tutor — which means either doing the
`socratic.md` extraction the module docstring already names, or adding a small
unconditional `closure` preamble beside it. **Recommend the second**: it is
independent of the extraction, ships alone, and does not touch four tutors'
byte-for-byte behaviour in the same change.

⚠️ **Guard the obvious failure**: a tutor that decides too eagerly it is done
is worse than one that will not stop, because it ends a lesson early and a
student has no way to argue. **Default to continuing**; closure needs a positive
signal, not an absence of one.

### M1 — recognising the end ~0.5d

What counts as a positive signal, in rough order of confidence:

| Signal | Available today | Confidence |
|---|---|---|
| The student says so (*"tak"*, *"vi er færdige"*, *"bye"*) | Yes — in the turn | Highest. It is a person deliberately saying it, the same argument that promotes the raised hand in [1.1.99](live-class-work-wall.md) |
| Every checklist item met | Yes — `checklist_progress` | High for goal-shaped activities |
| The teacher ends the session | Yes — reset/archive | Certain, but it is an event, not a turn |
| Long silence | ⚠️ Not a signal the tutor sees | — |

**Start with the first two.** They cost nothing, they are both explicit, and a
tutor that closes gracefully on *"tak for hjælpen"* and on a completed checklist
covers most of what was reported.

### M2 — an eval, not just a unit test ~0.5d

A unit test proves the preamble reached the prompt. **Arriving was never the
part in doubt** — the same lesson [1.1.87](activity-task-materials-in-context.md)
had to learn. Two eval cases:

1. Student says goodbye with the checklist complete → the turn closes, and does
   **not** end with a question.
2. Student pauses mid-investigation with two items outstanding → the turn
   **does** end with a question. This is the counter-test, and it is the one
   that matters: it fails if M0 made the tutor quit.

## Open questions

1. **Does closure belong to the style or to the tutor?** A Socratic tutor and an
   ESRU tutor probably close differently — ESRU's cycle *ends on use*, which is
   a closing move with a name. Deliberately not answered here: get the mechanism
   in, let [1.1.91](researcher-configurable-tutors.md) express the variation.
2. **Should a closing turn write something durable?** An end-of-session summary
   already has a home ([end-of-class-notes-summary](end-of-class-notes-summary.md))
   and this must not become a second one.
3. **Is "keeps talking" only about closure?** It may also be *turn length* mid-
   conversation, which is a different fix (the verbosity constraint from
   QUICK-WINS-V11). **Ask the reporter which they meant** — a fix to the wrong
   half will read as no fix at all.

## What this doc deliberately does not do

- **Fix one persona.** There is no Sophia in the repo.
- **Do the `socratic.md` extraction.** Related, filed, separately sized.
- **Decide how much a tutor should talk.** That is
  [1.1.90](bounded-tutoring-answer-trees.md)'s question budget and the verbosity
  work; this doc is only about the last turn.
