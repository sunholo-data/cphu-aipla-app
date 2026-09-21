# Framework fit — what did this conversation actually resemble?

**Status**: **M0 + M5 SHIPPED (dev) 2026-09-21** — `analytics/framework_fidelity.py`; M1–M4 (the seven-lens radar, the profile view, the training surface) still OPEN. **1.1.107**. New 2026-09-09 from M's steer
**Priority**: **P1** — it is the piece that turns the seven-tutor library from a *configuration* into an *instrument*, and it is the only item in the tutor workstream that produces research output from **existing** data with no classroom and no legal gate
**Estimated**: ~3.5–4.5d (M0 dialogue-unit evidence ~1d · M1 seven framework lenses ~1d · M2 fan-out + profile ~0.75d · M3 the profile view ~0.75d · M4 teacher-training surface ~0.5d · **M5 real-session single-framework case ~0.5d, new 2026-09-16**)
**Scope**: Backend — a **third evidence rule** (dialogue units, not the student-initiated partition), seven framework rubric definitions, and a fan-out runner over the shipped scorer; frontend — a profile view, and the same profile behind a teacher-facing preview. **No new scoring engine and no new store**
**Dependencies**: **RUBRIC-1 + RUBRIC-2 (SHIPPED)** — `analytics/session_rubric.py` free-form researcher rubrics (`upsert_rubric_def`, `build_generic_prompt`, `LensConfig.family` / `output_keys` / `score_scale`), `analytics/rubric_runs.py` (the run store this reuses unchanged); [1.1.91](researcher-configurable-tutors.md) (**M0's `constructs → behaviours` is the same structure a fit lens scores against — build the two together**); [1.1.92](session-benchmark-tutor-activity.md) (the sibling question, same store); [`docs/literature/tp-framework/`](../../../literature/tp-framework/README.md) (the seven papers); [1.1.65 rubric-results-in-product](rubric-results-in-product.md) (**M5's consumer — the session report's teacher band**)
**Created**: 2026-09-09
**Updated**: 2026-09-16 — M5 added, scoping the "real-session" case M4 deliberately deferred. Source: [notes-2026-09-16.md](../../../notes-2026-09-16.md) — *"the sessions report should also include an analysis of how the teaching framework was used and how much it was stuck to — the report should only report on the teaching framework that tutor used, it doesn't need to compare across."*
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

### M0 — dialogue-unit evidence ~1d — ✅ SHIPPED 2026-09-21

`analytics.framework_fidelity.dialogue_units`: the ordered tutor+student
sequence, original turn ids preserved, windowed to the last 80 turns with
`truncated_from` reported. `partition_evidence` is not used — a test asserts
it. The evidence summary rides every result.

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

### M5 — the real-session case, scoped 2026-09-16 ~0.5d — ✅ SHIPPED 2026-09-21

What shipped, and where it departs from the sketch below:

- **The criteria are generated from the framework YAML**, not hand-authored
  `rubric_defs` (M1's route). `criteria_block` renders each construct's
  summary, behaviours (*look for*), `avoid` (*counts against*) and
  `evaluationHint` (*the question*) verbatim — the same structure that
  instructs the tutor, read the other way, so instruction and judge cannot
  drift. A test holds every behaviour/avoid/hint line against the prompt.
- **One run per session**, against `SessionSummary.framework_id` (now read
  from the chat-turn log's TUTOR-5 stamp; the LAST stamped tutor turn wins).
  Stored in the RUBRIC-2 run store as `lens_id = "fidelity:<framework_id>"`,
  `prompt_version = fidelity-r1`; cached from there and regenerated when the
  session grows or on the report's *Refresh*.
- **Blind to the arm** (open question 5): the prompt names the criteria and
  says not to assume configuration; the tutor id never appears.
- **Bands, not percentages** (open question 1): `absent | partial | strong`
  per construct and overall, the 0–2 number kept in the store only.
- **The spoken transcript is evidence** where the class recorded — labelled,
  speakers unidentified, and scoped by the approach's `setting`: for a
  `group_talk` approach it is where the community exists; for every other
  approach it is context for student-side criteria, and tutor moves are
  evidenced from the chat alone. This is the answer to the 2026-09-21
  question *"do the class reports grade the class chat/audio on the criteria
  the approach was supposed to cover?"* — they did not; now they do, for the
  one approach the session ran.
- **Abstains** without a stamped framework, on a placeholder framework, on
  fewer than 3 tutor turns, or on a non-Gemini judge — and the report says
  *Not assessed — <reason>*.
- **Surface: the session report's "Teaching approach" section**
  (`TeachingApproachSection`, between Summary and At a glance). Teachers get
  prose + *Where it drifted* + a link to the public approach page; a
  researcher's payload additionally carries the bands and a per-construct
  table with rationale and cited turn ids (`GET /api/reports/…` splits on
  `is_researcher`). This is 1.1.65's teacher band, delivered here rather than
  there.

Not done: episode-level scoring (open question 2 — session-level only), and
any cross-framework view (deliberately, per the 09-16 steer).

**The view this doc was waiting for, from the 2026-09-16 meeting:** the session
report should include an analysis of how faithfully the tutor followed its
teaching framework — and **only the one framework that session ran under**,
never the seven-way radar. *"The report should only report on the teaching
framework that tutor used, it doesn't need to compare across."*

That single constraint changes the shape of this milestone a lot from M2–M3's:

- **No fan-out, no seven-judge cost.** M2's "loop over the shipped function,
  one run per (session × framework)" collapses to **one call**, for the
  `framework_id` TUTOR-5 already stamped on the session. The cost concern M2
  raises (*"seven judges per session... the multiplier is seven"*) does not
  apply here at all — this is the cheap case, not the expensive one.
- **This is fidelity, not the radar.** M3's "switch the lens on one
  conversation" (read the same dialogue as ESRU, then as POE) is explicitly
  **not** what's wanted in the report — a teacher does not want to know their
  ESRU-configured tutor's session also scores 40% as POE, they want to know
  *did it do ESRU well*. Single-lens output only.
- **Feeds [1.1.65 rubric-results-in-product](rubric-results-in-product.md)'s
  teacher band**, not a new researcher surface — `competency_notes` (or a
  sibling field beside it, R1-gated the same way) gains a plain-language
  fidelity read: which framework, what it looked like in this session, where
  it drifted. The fit *score* stays behind the R1 gate exactly like a
  competency score does (finding 3 above still holds — fit and quality must
  never share a cell, and neither should read as a grade to a teacher about
  their own practice); the **prose** description of adherence is what's
  teacher-facing, same split 1.1.65 already uses for competency.
- **Answers the R1/trust question M4 deferred, for this one case.** Showing a
  teacher *"your ESRU tutor mostly elicited and recognised, but skipped the
  use phase in the second half"* is lower-stakes than a numeric fidelity score
  or a cross-framework comparison — it's a description of what the *tutor*
  did, not a judgement of the teacher or the student, which is why this can
  ship ahead of the harder open question M4 raised (fidelity feedback ABOUT a
  teacher's own configured tutor, at scale, is still a JB/AR call — this
  milestone is one session, one framework, descriptive).

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
