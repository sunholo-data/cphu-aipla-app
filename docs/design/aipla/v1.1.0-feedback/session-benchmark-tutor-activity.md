# Rating a session — a rubric-pluggable benchmark, and the tutor × activity matrix

**Status**: **Design (OPEN)** — **1.1.92**. Decision **D3 taken 2026-09-02**: mechanism first, rubric pluggable
**Priority**: **P2** — high research value, and the payoff for 1.1.91. Not pilot-blocking
**Estimated**: ~3–4d (M0 scoring harness ~1.5d · M1 rubric adapters ~0.75d · M2 the matrix view ~1d · M3 calibration ~0.75d)
**Scope**: Backend — a rubric-agnostic session scorer over the shipped chat-log + workbench-event tables, and a comparison aggregate; frontend — a researcher-facing tutor × activity matrix
**Dependencies**: [1.1.91 researcher-configurable-tutors](researcher-configurable-tutors.md) (**supplies the arms**); [1.1.57 competency-rubrics](competency-rubrics.md) (one rubric); [session-analytics-rubric](../post-pilot/session-analytics-rubric.md); the chat-log pipeline (**SHIPPED** — BigQuery, `revision`-stamped); [1.1.5 researcher-role](researcher-role.md) (**SHIPPED**)
**Created**: 2026-09-02
**Source**: [notes-2026-09-01.md](../../../notes-2026-09-01.md) — *"can we have a benchmark for rating a session? then we can grade tutor vs activity"*

## Problem Statement

> Can we have a **benchmark for rating a session**? Then we can grade **tutor vs
> activity** — which tutor is better for which activity.
>
> **What rubrics to use?** We have a few — are we using them to judge sessions?

**Both halves of that are already true and that is the problem.** We do have
rubrics. We are not judging sessions with them.

- **Rubrics exist** — [competency-rubrics](competency-rubrics.md) (1.1.57, Lens A–D
  including a MAPS problem-solving judge and a SAAR inquiry judge),
  [session-analytics-rubric](../post-pilot/session-analytics-rubric.md), and the
  structure rubric inside `adk/authoring_framework.py`.
- **The data exists** — every chat turn is in BigQuery, `revision`-stamped, with
  workbench events alongside.
- **The A/B arm key exists** — `revision` per class, per the deploy runbook.
- **Nothing scores a session.**

### Why this has not been built, stated plainly

This is the **exact shape** of the failure named in the 17-August audit that
produced 1.1.78, and it is worth quoting because repeating it here would be
inexcusable:

> Each of four designs was gated on *its own* content decision (which quiz format
> / which exit-ticket wording / which rubric), and so none of them built the
> **mechanism** — which none of those decisions gate. Four instruments waited on
> four different humans for the same missing widget.

*"What rubrics to use?"* is precisely such a question. **D3: do not answer it
first.** Build the harness so any rubric drops in, and let AR decide which one
means something afterwards.

## Design

### M0 — The scoring harness (rubric-agnostic)

An offline scorer that takes a completed session and produces a scored record:

```
score_session(session_id, rubric: Rubric) -> SessionScore
    session_id, rubric_id, rubric_version
    scores: {dimension: value}
    evidence: {dimension: [turn_ids]}      # never a bare number
    arm: {persona_id, persona_version, activity_id, revision}
```

Three properties that are not negotiable:

- **Evidence, not just a number.** Every dimension cites the turns that produced
  it. A score a researcher cannot audit is not research output — and this repo has
  now been bitten six times by numbers that were confidently wrong.
- **The arm is recorded on the row.** Persona *version* (1.1.91 M1 open question
  3), activity, and `revision`. Without versioned arms a later prompt edit makes
  earlier scores unattributable.
- **Offline, never in the student's turn.** No added latency, and no possibility
  of the judge leaking into the tutor's context.

### M1 — Rubric adapters

A `Rubric` protocol with the shipped rubrics as the first implementations, and
room for AR's choice:

| Rubric | Source | State |
|---|---|---|
| Competency Lens A–D (MAPS, SAAR) | 1.1.57 | Designed |
| Session analytics (engagement, concept signal) | post-pilot doc | Designed |
| **Etkina scientific abilities** | AR, meeting item 14 | ⚠️ Name unverified |
| Multiple representations | AR | Raised, unspecified |

**Adding a rubric must be writing one adapter, not touching the harness.**

### M2 — The tutor × activity matrix

The thing actually asked for: a researcher-facing grid, personas down one axis,
activities across the other, mean score per cell with n and a confidence hint.

**Its job is to make thin evidence look thin.** With 22 groups of pilot data,
most cells will have n=1 or n=0, and a grid that renders a single session as a
confident number would be actively misleading. Empty and low-n cells must read as
empty and low-n.

### M3 — Calibration

The honest gate, and [living-concept-map](living-concept-map.md) already names it
for its own judge: *the eval is the long pole*. Before any score is shown to a
teacher, agreement between the LLM judge and a human rater on a sample must be
measured and published alongside the scores. Until then the matrix is a
**researcher** surface only.

## Milestones

| M | What | Est | Gate |
|---|---|---|---|
| M0 | Scoring harness + evidence + arm recording | ~1.5d | None |
| M1 | Rubric adapters (≥2 shipped rubrics) | ~0.75d | None for the mechanism |
| M2 | Tutor × activity matrix, researcher-only | ~1d | Needs 1.1.91 arms to be interesting |
| M3 | Judge calibration against human raters | ~0.75d | **AR** — human rating time |

## Testing

- The same session + same rubric version scores identically twice (determinism where claimed)
- Every dimension carries ≥1 evidence turn id; a score with no evidence fails
- A session whose persona was edited afterwards still reports the version it ran under
- The matrix renders n=0 and n=1 cells as insufficient, not as scores
- Scoring never appears in a student-turn code path

## Open questions

1. **What is a "good" session?** Genuinely open, genuinely AR's and JB's. The
   design's whole posture is that the mechanism must not wait for it.
2. **Is the unit the session or the group?** A group may run several sessions on
   one activity. Probably session, aggregated to group.
3. **Confounds.** Tutor × activity varies the tutor, but classes, teachers and
   topics vary too. This produces *signal for researchers*, not causal claims —
   and the UI should not imply otherwise.
4. **Cost.** Judging every session costs model calls. Sampled by default, with a
   researcher-triggered full run.
