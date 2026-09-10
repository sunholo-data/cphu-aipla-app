# Framework fit — what did this conversation actually resemble?

**Status**: **Design (OPEN)** — **1.1.107**. New 2026-09-09 from M's steer
**Priority**: **P1** — it is the piece that turns the seven-tutor library from a *configuration* into an *instrument*, and it is the only item in the tutor workstream that produces research output from **existing** data with no classroom and no legal gate
**Estimated**: ~3–4d (M0 dialogue-unit evidence ~1d · M1 seven framework lenses ~1d · M2 fan-out + profile ~0.75d · M3 the profile view ~0.75d · M4 teacher-training surface ~0.5d)
**Scope**: Backend — a **third evidence rule** (dialogue units, not the student-initiated partition), seven framework rubric definitions, and a fan-out runner over the shipped scorer; frontend — a profile view, and the same profile behind a teacher-facing preview. **No new scoring engine and no new store**
**Dependencies**: **RUBRIC-1 + RUBRIC-2 (SHIPPED)** — `analytics/session_rubric.py` free-form researcher rubrics (`upsert_rubric_def`, `build_generic_prompt`, `LensConfig.family` / `output_keys` / `score_scale`), `analytics/rubric_runs.py` (the run store this reuses unchanged); [1.1.91](researcher-configurable-tutors.md) (**M0's `constructs → behaviours` is the same structure a fit lens scores against — build the two together**); [1.1.92](session-benchmark-tutor-activity.md) (the sibling question, same store); [`docs/literature/tp-framework/`](../../../literature/tp-framework/README.md) (the seven papers)
**Created**: 2026-09-09
**Source**: M, 2026-09-09 — *"in our scoring of sessions be able to switch analysis to see what those tutor types could do under that framework — maybe a % score of how much that conversation fits with each? we can use that then for teacher training"*

## Problem Statement

**Every scoring instrument in the platform asks how well the student did. None
asks what kind of teaching happened.**

The shipped lenses (MAPS, SAAR/Etkina) are **competency** rubrics: they measure
the student's problem-solving and scientific abilities.
[1.1.92](session-benchmark-tutor-activity.md) compares tutors *by those student
outcomes*. Neither can answer the question the seven TP frameworks actually
describe:

> Was this dialogue an **ESRU** cycle? Was it **POE**? Did it look like
> **Accountable Talk**? How much of each?

That is a **descriptive** question, not an evaluative one, and it unlocks three
things the platform cannot currently do:

| Use | Why it needs *fit*, not *quality* |
|---|---|
| **Tutor fidelity** | A tutor configured as ESRU can now be checked: *did it actually behave like ESRU?* Today a tutor's theory claim is unfalsifiable — which is exactly what [1.1.91](researcher-configurable-tutors.md) M0 exists to fix, and this is the half that checks it |
| **Dialogue description** | *"This conversation was strongly POE, weakly CER"* — a finding about what happened, available over the whole existing corpus with no new sessions |
| **Teacher training** | The 09-09 ask. A teacher sees the same dialogue read through seven lenses and learns what the frameworks *look like* in practice — which is a far better teaching aid than seven prose summaries |

**And the corpus already exists.** Every session since the pilot is in BigQuery
and the run store scores by group code with backfill. This instrument can be
pointed at data already collected, which — while both legal gates are shut — is
the rarest property any item in this workstream has.

## The three findings that shape the design

### 1. The shipped evidence rule is exactly inverted for this

`partition_evidence` splits **student** turns into initiated vs tutor-prompted,
and its docstring says why:

> *A tutor is a scaffolding machine that destroys the evidence a competency
> rubric needs. The judge scores only student-INITIATED turns; tutor-prompted
> answers are context, never competence.*

That is right for MAPS and SAAR. **It is precisely wrong here.** ESRU is
Elicit → **Student response** → Recognise → Use: a *cycle spanning both
speakers*. The tutor's moves are the thing being measured, and the shipped
partition discards them. So does POE (three phases across turns), CER, and
Accountable Talk (uptake is by definition a response to what someone else said).

**M0 is therefore a third evidence rule, not a rubric.** The unit is a
**dialogue unit** — an adjacency sequence of tutor and student turns with their
order preserved — never a bag of student utterances.

[competency-rubrics.md](competency-rubrics.md) anticipated this: *"a third lens
family, orthogonal to the R1 choice."* This is that family arriving.

### 2. A percentage is a claim, and these frameworks are not mutually exclusive

**Do not normalise to 100%.** A single good turn can be simultaneously an ESRU
*elicit*, an Accountable Talk *revoicing*, and the *predict* phase of POE. The
seven frameworks overlap heavily by construction — several describe the same
classroom moves from different traditions.

So the output is **seven independent fit scores, each 0–100**, that need not sum
to anything. A stacked bar or a pie chart would be a lie about the underlying
model; a **radar or seven independent bars** is honest. This is the single
constraint most likely to be lost in implementation, and it is the one that would
make the instrument wrong rather than merely rough.

### 3. Fit is not quality, and the UI must never let the two blur

**"80% ESRU" does not mean "good".** A tutor can be faithfully ESRU and
pedagogically useless; a brilliant conversation may match no framework at all.
Fit answers *what kind*, [1.1.92](session-benchmark-tutor-activity.md) answers
*how well*, and they must not share a colour scale, a word, or a cell.

⚠️ **The teacher-training use makes this sharper, not softer.** A number shown to
a professional about their own practice reads as a grade whatever the caption
says. See M4.

## Milestones

### M0 — dialogue-unit evidence ~1d

A second partitioner beside `partition_evidence`, selected by
`LensConfig.family`, producing ordered tutor/student sequences with turn ids
preserved. Everything downstream — the run store, provenance stamping, abstain
behaviour — is untouched and reused.

**The partition rides the result**, exactly as the shipped one does, so a
researcher can audit which units were scored.

### M1 — seven framework lenses ~1d

**These are researcher rubrics, and the shipped code already supports them** —
`upsert_rubric_def` stores a free-form rubric whole, `build_generic_prompt`
serves it, and `LensConfig` carries `family`, `output_keys`, `score_scale` and
`requires_anchors` (which *"defaults to NOT requiring [anchors] so a new
framework can be tried immediately"*).

So M1 is mostly **authoring**: for each of the seven, the constructs, the
observable moves, the scale, and the citation.

⚠️ **Each lens is written from the paper on disk, and the citation is
mandatory.** These lenses will be quoted in a journal article. A fit score
against a framework the system cannot cite is worthless — the same rule as
[1.1.91](researcher-configurable-tutors.md) M2's *never invent a provenance
string*.

**This is where 1.1.91 M0 pays off twice.** A tutor's `constructs → behaviours`
and a fit lens's scoring criteria are the *same structure* read in two
directions: one instructs, the other detects. Authoring them together keeps them
honest; authoring them apart guarantees drift between what a tutor was told to do
and what the judge looks for.

### M2 — fan-out and the profile ~0.75d

`score_session` takes one `lens_id`. The profile is a **loop over the shipped
function**, one run record per (session × framework), which the run store already
keys and de-duplicates deterministically.

Two disciplines carried from the engine rather than re-invented:

- **Abstain per framework, not per profile.** A dialogue with too few units to
  judge against POE still yields a real ESRU score. A missing framework reads as
  **not assessable**, never as 0 — *"the reassuring answer is the one a broken
  read produces"*, and here 0% is that answer.
- **Cost.** Seven judges per session, not one. Sampled by default, researcher-
  triggered for a full run — the same posture 1.1.92 takes, but the multiplier
  is seven and should be stated in the UI before someone backfills a term.

### M3 — the profile view ~0.75d

Researcher-facing, beside the 1.1.92 matrix, sharing its store. Seven independent
bars, each with **its evidence turns** — the shipped rule that a score cites the
turns that produced it is what makes this teachable rather than oracular.

**The most valuable single control: switch the lens on one conversation.** Read
the same dialogue as ESRU, then as POE. That is the "switch analysis" in the ask,
and it is one dropdown over data already scored.

### M4 — the teacher-training surface ~0.5d

**Start where there is no student data at all.** [1.1.91](researcher-configurable-tutors.md)
M3 gives a teacher a scratch conversation against a chosen tutor. Running the fit
profile over *that* conversation is the whole training loop:

> Talk to the ESRU tutor. Here is what it did, read through all seven lenses.
> Now talk to the POE tutor and see how the profile changes.

**No student, no consent question, no legal gate** — the teacher's own turns,
their own conversation. It works today, on preview transcripts, and it makes the
seven-tutor library useful before a single classroom opens.

⚠️ **Applying this to a teacher's own class sessions is a different feature** and
crosses the R1 gate [1.1.57](competency-rubrics.md) holds — *"anything surfaced
in the teacher UI in rubric vocabulary stays R1-gated"* — plus the trust question
in the third finding above. **M4 is the preview case only.** The real-session
case wants JB's view before it is designed, not after.

## Testing

- A fit lens receives **ordered dialogue units including tutor turns**; assert
  the competency partition is *not* used for `family="framework_fit"`
- The seven scores are independent: a crafted transcript scoring high on two
  overlapping frameworks does **not** have its scores reduced to sum to 100
- A framework with insufficient evidence reports **not assessable**, and the UI
  renders that distinctly from a low score
- Every framework score cites ≥1 dialogue unit; a score with no evidence fails
- A fit run records the tutor arm from [1.1.92](session-benchmark-tutor-activity.md)
  M0, so *configured as ESRU* and *scored as ESRU* are separable columns —
  **this is the fidelity measurement and it does not exist without both**
- Scoring never appears in a student-turn code path

## Open questions

1. **What is the scale?** A percentage is what was asked for and it is the most
   readable, but *"60% ESRU"* invites a precision the judge does not have.
   Alternative: coarse bands (absent / partial / strong) with the number behind
   them. **Leaning bands in the UI, the number in the store** — the same shape as
   1.1.92's low-n discipline.
2. **Unit of analysis: the session, or the episode?** A 40-turn session may
   contain one clean POE cycle and thirty turns of something else. A session-level
   percentage would hide that, and the frameworks are all *episode*-shaped.
   Probably: score episodes, aggregate to session, keep both.
3. **Does a low fit against every framework mean anything?** It may be the most
   interesting result in the instrument — a dialogue no tradition describes — or
   simply a judge failing. Needs the calibration corpus to tell apart.
4. **Human dialogue.** The frameworks were written to code *teacher–student*
   classroom talk, not tutor–student chat. Scoring a recorded human lesson is the
   natural extension and the strongest teacher-training version — but it lands on
   the Strand C recording work and its own consent question. **Not scoped here.**
5. **Does the fit lens see the tutor's prompt?** It must not. A judge told *"this
   tutor was configured as ESRU"* will find ESRU. **Blind to the arm** — which is
   the whole reason fidelity is measurable at all.
