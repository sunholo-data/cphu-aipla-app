# The tutor × activity matrix — adding the arm the shipped scorer never recorded

**Status**: **Design (OPEN)** — **1.1.92**. Decision **D3, 2026-09-02**: mechanism first, rubric pluggable.
**⚠️ REWRITTEN 2026-09-09 — the first version's premise was false.** It opened *"nothing scores a session"*. The scorer shipped **2026-07-11** (RUBRIC-1) and was extended by RUBRIC-2, which is most of what the old M0 and M1 proposed. What is missing is one field, one view and one measurement — see [What was wrong](#what-was-wrong-and-why-it-matters-beyond-this-doc)
**Priority**: **P2** — high research value, and the payoff for [1.1.91](researcher-configurable-tutors.md). Not pilot-blocking
**Estimated**: **~1.5–2d** (M0 the tutor arm ~0.5d · M1 the matrix ~1d · M2 calibration ~0.5d) — **was ~3–4d against a harness that already existed**
**Scope**: Backend — add the tutor arm to the shipped `RubricResult` and run store, and a comparison aggregate; frontend — a researcher-facing tutor × activity matrix. **No new scoring engine**
**Dependencies**: [1.1.91 researcher-configurable-tutors](researcher-configurable-tutors.md) (**supplies the arms — this doc is unbuildable without it**); **RUBRIC-1 + RUBRIC-2 (SHIPPED)** — [`analytics/session_rubric.py`](../../../../backend/analytics/session_rubric.py), [`analytics/rubric_runs.py`](../../../../backend/analytics/rubric_runs.py), [`analytics/rubric_evidence.py`](../../../../backend/analytics/rubric_evidence.py), [`protocols/research_lens_routes.py`](../../../../backend/protocols/research_lens_routes.py); [rubric-results-in-product](rubric-results-in-product.md) (**owns trigger + display — read together, do not duplicate**); [1.1.57 competency-rubrics](competency-rubrics.md) (the design of record); [1.1.5 researcher-role](researcher-role.md) (**SHIPPED**)
**Created**: 2026-09-02 · **Rewritten**: 2026-09-09
**Source**: [notes-2026-09-01.md](../../../notes-2026-09-01.md) — *"can we have a benchmark for rating a session? then we can grade tutor vs activity"*

## Problem Statement

> Can we have a **benchmark for rating a session**? Then we can grade **tutor vs
> activity** — which tutor is better for which activity.

**Almost all of the machinery exists. Exactly one thing is missing, and it is the
tutor.**

### What ships, verified against code 2026-09-09

| Piece | Where |
|---|---|
| Post-hoc per-session judge, **never live-cadenced** | `analytics/session_rubric.py` — `score_session`, `score_session_summary` |
| **Evidence integrity** — scores only student-initiated turns, partition rides every result | `partition_evidence`, `EvidencePartition` |
| **Abstain over fabricate** — no anchor pack ⇒ *uncalibrated*, scores withheld | `_abstain`, `requires_anchors` |
| **Provenance stamped** — `{lens_id, prompt_version, model, partition_summary}` | `RubricResult` |
| **Free-form researcher rubrics**, versioning, promote-to-live | `upsert_rubric_def`, `promote_rubric`, `is_version_live` |
| **Run store** — one doc per (session × rubric × version), deterministic `run_id`, Firestore **and** BigQuery sinks | `analytics/rubric_runs.py` |
| **Backfill by group code** | `backfill_group` |
| HTTP + CLI + researcher config UI | `research_lens_routes.py`, `aiplatform rubric`, `_LensConfigPanel.tsx` |

Two of the seed lenses are the ones the meeting asked about by name: **Lens C is
MAPS** (Docktor et al. 2016) and **Lens D is SAAR — Etkina et al. 2006.** The
1 September triage carried *"Etkina — ⚠️ name unverified"*; it has been in the
codebase, cited, since July.

### The gap, stated exactly

```python
class RubricResult(BaseModel):
    session_id: str
    activity_id: str        # ← the activity axis EXISTS in stored data
    lens_id: str
    prompt_version: str
    model: str
    ...                     # ← no tutor. no persona. no `revision`.
```

**So the matrix has one axis and not the other.** Every scored session already
knows which activity it belonged to; none of them knows which tutor ran it,
because until [1.1.91](researcher-configurable-tutors.md) there was no tutor
identity to record — a tutor was a file in git, identical for everyone.

That is the whole of this doc: **add the arm, render the grid, measure the
judge.**

## What was wrong, and why it matters beyond this doc

The first version of this doc asserted *"Nothing scores a session"* and specified
a harness, an evidence rule, a provenance rule and a rubric-adapter protocol —
**all four of which had shipped eight weeks earlier**, and three of which the
shipped code implements more strictly than the doc asked for.

It was written on 2026-09-02, **a month after** [rubric-results-in-product](rubric-results-in-product.md)
(2026-08-06) laid out precisely what shipped, in a table, correctly.

**The lesson is not "check the Status header".** The 2026-09-02 sweep already did
that — 94 docs, 14 wrong — and added `scripts/check-doc-status-drift.sh`. This
error was not in a header. **It was in a Problem Statement**, which no guard
reads and which a builder trusts more than any other paragraph, because it is the
part that says *why the work is needed at all*.

Recorded here rather than in a retro because the cost was nearly incurred: D7
committed the extension's largest workstream to this doc and 1.1.91 on
2026-09-09, and the estimate it carried was **double** the real one.

## Milestones

### M0 — record the arm ~0.5d

Add to `RubricResult` and the run-store document:

| Field | Why |
|---|---|
| `tutor_id` + `tutor_version` | The axis that does not exist. **Version, not just id** — an edited tutor must be a new arm or earlier scores become unattributable |
| `revision` | The Cloud Run revision already stamped on every chat-log row and used for A/B per class. Present in the log pipeline, absent here |
| `group_id` | Already on the run-store doc; promote it onto the result so one object carries the whole arm |

⚠️ **Backfill honestly.** Sessions scored before 1.1.91 have no tutor. They must
read as **unknown**, never as a default tutor — a null arm silently collapsed
into "the standard tutor" would put pre-migration sessions in a cell they do not
belong to. `run_id` is deterministic (`{session}__{rubric}__{version}`), so
re-scoring updates in place rather than duplicating; the arm can be added to
existing runs without a second scoring pass.

### M1 — the matrix ~1d

Tutors down one axis, activities across the other, mean score per cell with n.
Reads the run store; no new aggregation pipeline.

**Its job is to make thin evidence look thin.** With 22 groups of pilot data most
cells are n=0 or n=1, and a grid that renders one session as a confident number
is worse than no grid. Empty and low-n cells must read as empty and low-n.

⚠️ **Coordinate with [rubric-results-in-product](rubric-results-in-product.md).**
That doc owns *trigger + display* for a single session's scores and is P1, ~2d,
accurate. This is the **cross-session comparison** view. One screen each; do not
build two rubric UIs that disagree about vocabulary.

### M2 — calibration ~0.5d

The shipped engine already **abstains** without an anchor pack, which is the
honest half. What it does not do is **measure agreement with a human rater** and
publish it beside the score. Until it does, the matrix stays researcher-only.

The TP-framework *example conversations* (action on Aswin, [1.1.91](researcher-configurable-tutors.md) M5)
are the seed corpus this has never had. **They do not replace human rating** —
exemplars calibrate a judge, they do not make one trustworthy.

## Testing

- A scored session records `tutor_id`, `tutor_version` and `revision`; a session
  from before 1.1.91 records the arm as **unknown**, and the matrix renders it in
  an explicit "no tutor recorded" row rather than dropping or defaulting it
- An edited tutor produces a new `tutor_version`; earlier runs still report the
  version they ran under
- Re-scoring the same (session, rubric, version) updates one run record
- The matrix renders n=0 and n=1 as insufficient, not as scores
- Scoring never appears in a student-turn code path (the shipped rule; assert it
  still holds after the arm is added)

## Open questions

1. **What is a "good" session?** Genuinely AR's and JB's. The posture is
   unchanged: the mechanism must not wait for it.
2. **Confounds.** Tutor × activity varies the tutor; classes, teachers and topics
   vary too. This is *signal for researchers*, not causal claims, and the UI must
   not imply otherwise.
3. **Cost.** Sampled by default, researcher-triggered full run. Unchanged.
4. **Does the matrix belong beside the framework-fit profile?**
   [1.1.107](framework-fit-profile.md) scores the same sessions on a different
   question — *what did this dialogue resemble*, rather than *how well did the
   student do*. They share a store and probably a screen.
