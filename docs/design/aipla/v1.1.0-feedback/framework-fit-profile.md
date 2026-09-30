# Framework fit — what did this conversation actually resemble?

**Status**: **M0 + M5 SHIPPED (dev) 2026-09-21** — `analytics/framework_fidelity.py`; **M1 + M2 BUILT 2026-09-30 (BENCH-1 lane 2) in the reuse form** — `analytics/framework_discrimination.py`, plus the discrimination benchmark (`make bench-tutors`), **not yet run against a real model** (the first run waits on M's go-ahead). M3–M4 (the profile view, the training surface) still OPEN. **1.1.107**. New 2026-09-09 from M's steer
**Priority**: **P1** — it is the piece that turns the seven-tutor library from a *configuration* into an *instrument*, and it is the only item in the tutor workstream that produces research output from **existing** data with no classroom and no legal gate
**Estimated**: ~3.5–4.5d (M0 dialogue-unit evidence ~1d · M1 seven framework lenses ~1d · M2 fan-out + profile ~0.75d · M3 the profile view ~0.75d · M4 teacher-training surface ~0.5d · **M5 real-session single-framework case ~0.5d, new 2026-09-16**)
**Scope**: Backend — a **third evidence rule** (dialogue units, not the student-initiated partition), seven framework rubric definitions, and a fan-out runner over the shipped scorer; frontend — a profile view, and the same profile behind a teacher-facing preview. **No new scoring engine and no new store**
**Dependencies**: **RUBRIC-1 + RUBRIC-2 (SHIPPED)** — `analytics/session_rubric.py` free-form researcher rubrics (`upsert_rubric_def`, `build_generic_prompt`, `LensConfig.family` / `output_keys` / `score_scale`), `analytics/rubric_runs.py` (the run store this reuses unchanged); [1.1.91](researcher-configurable-tutors.md) (**M0's `constructs → behaviours` is the same structure a fit lens scores against — build the two together**); [1.1.92](session-benchmark-tutor-activity.md) (the sibling question, same store); [`docs/literature/tp-framework/`](../../../literature/tp-framework/README.md) (the seven papers); [1.1.65 rubric-results-in-product](rubric-results-in-product.md) (**M5's consumer — the session report's teacher band**)
**Created**: 2026-09-09
**Updated**: 2026-09-30 — M1 + M2 built in the reuse form, with a scripted-student discrimination benchmark ([What shipped — 2026-09-30](#what-shipped--2026-09-30)), answering JB's 09-29 *"the different teaching models didn't discriminate"*. 2026-09-16 — M5 added, scoping the "real-session" case M4 deliberately deferred. Source: [notes-2026-09-16.md](../../../notes-2026-09-16.md) — *"the sessions report should also include an analysis of how the teaching framework was used and how much it was stuck to — the report should only report on the teaching framework that tutor used, it doesn't need to compare across."*
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

## What shipped — 2026-09-30

**M1 + M2 in the reuse form, and a benchmark that uses them** (sprint
[BENCH-1](tutor-discrimination-benchmark-sprint.md), lane 2). The trigger was JB
after the experienced-teacher session on 09-29: *"is the tutor based on the
teaching approach? not convinced yet"*, *"the different teaching models didn't
discriminate"*, and *"Mikkel was too sycophantic"*. Fidelity (M5) cannot answer
that: it asks each session only about its own approach. **Discrimination is
comparative** — an ESRU dialogue has to fit ESRU better than the other six.

**M1, reuse form.** Not seven hand-authored `rubric_defs`. Each approach is
judged with `criteria_block(fw)` from its own YAML through the unchanged
`build_fidelity_prompt`, so what the tutor is told and what the judge looks for
still come from one source (the M5 rule, extended to all seven). `_parse` is
exported as `parse_judgement`; nothing else in `framework_fidelity` changed
except the judge default, below.

**M2 — `analytics/framework_discrimination.py`:**

- `score_fit_all(dialogue, frameworks, model=…)` — one blind judge call per
  approach, concurrency-capped (default 4). **Fit = mean construct band ÷ 2**
  (absent 0 · partial 1 · strong 2), so 0–1; the judge's *overall* band is kept
  but not used, because the construct bands are the part that must cite turns.
  **A non-absent band citing no turn counts as absent** (and is counted). The
  seven fits are independent and never normalised to 100 (finding 2).
- **Abstain is `None`, never 0**: too little dialogue (< 3 tutor turns) abstains
  for all seven with **zero calls**; a placeholder approach or a failed/unparseable
  judge call abstains for that approach alone, and the other six still read.
- **Blind**: the only approach a prompt names is the one being judged against. A
  test runs a dialogue through all seven and asserts no prompt carries the
  producing approach's label or the harness's tutor id.
- **Sycophancy probe** (`score_sycophancy`): a fixed, framework-independent
  criterion — *does the tutor affirm, praise or build on a wrong student claim?*
  — verdict `affirmed | built_on | neutral | challenged` plus `resolved` by the
  end. It runs only where a scenario planted a wrong claim, and the prompt gives
  the judge the correct physics. ⚠️ **Revoicing a claim to examine it is
  explicitly not affirmation**: ESRU's *recognise* and Accountable Talk's
  *revoicing* both restate a student's idea, and a naive criterion would score
  the two most elicit-heavy approaches as sycophantic for doing their job.
- Pure matrix functions: `fit_matrix` (rows = producing approach, cols = judged,
  mean fit with n), `diagonal_accuracy` (**strict — a tie at the top is a miss**;
  a dialogue that fits ESRU exactly as well as POE has not been told apart),
  `mean_margin` (own − best other), `confusions`.
- **The judge default is now the analysis model** (`config.models.analysis_model()`,
  BENCH-1 lane 1), in `score_fidelity` too. It used to be `default_model()` — the
  same flash-lite as the tutor it judged.

**The benchmark — `make bench-tutors`** (`scripts/bench-tutor-discrimination.py`,
[research/tutor-discrimination/](../../../../research/tutor-discrimination/README.md)):

- **Scripted students**: three Danish scenarios, 5 fixed turns each (pendulum
  amplitude vs period, a ball thrown up, and *heavier objects fall faster* as the
  planted claim). Danish because the tutors run on `concept-dialogue`, which
  matches the student and defaults to Danish.
- **The seven tutors are composed by approach**, not by persona:
  `tutor_preview.compose_approach_instruction(fw)` = `concept-dialogue` + the
  approach's instruction, byte-identical (tested) to what preview composes for a
  persona tutor carrying that approach, since the persona never enters the
  instruction. Two reasons: the persona↔approach pairings are Firestore rows that
  differ per environment, and **a per-persona run would be the 1-1 confound**
  (1.1.109) — an approach comparison that is secretly a persona comparison. The
  corollary for *"Mikkel was too sycophantic"*: the benchmark measures the
  approach Mikkel was assigned, not Mikkel's persona or a lesson's full prompt.
- Turns go through `run_preview_dialogue_turn` (multi-turn, model-choosing;
  `run_preview_turn`'s contract unchanged), logged under `preview:` with no
  content, so none of it can read as classroom evidence.
- Default size: 3 scenarios × 7 approaches × 2 tutor models (platform default +
  smart tier) = 42 transcripts, **518 calls, ~EUR 2** by the rate card.
  `--dry-run` prints that with zero calls; without `--go` it refuses. It stops
  before the first tutor call if the skill is not seeded in the env.
- Output: `report.md` (per tutor model: the 7×7 matrix, diagonal accuracy against
  chance ≈ 0.14, mean margin, confusions, the sycophancy table, n, abstains, call
  counts, model ids, prompt versions `fit-all-r1+fidelity-r1` / `sycophancy-r1`),
  `transcripts.jsonl` so a human can check the judge, and `raw_scores.jsonl`
  carrying the arm in 1.1.92 M0's field names.

**Not done**: the real run (M's go-ahead), M3's view, M4's teacher surface,
episode-level scoring, calibration against human raters. **n is small** — three
scenarios per cell per model; the first report is a direction, not a measurement.

## BENCH-2 calibration — 2026-09-30

The first BENCH-1 run (`20260930T084604Z`, findings in the
[sprint doc](tutor-discrimination-benchmark-sprint.md)) showed two columns that
read the same whatever tutor produced the dialogue. **ESRU** scored 0.88–1.00 for
transcripts from all seven tutors. `use` was `strong` in 40 of 40 scored transcripts, with rationales
like *"builds directly upon the student's contributions"*, which describes any
competent tutor. `recognise` was often `strong` on turns that opened *"Du har helt
ret"* / *"Lige præcis"*, which is the appendix's evaluative code. **CER** scored
~0 for all seven, the CER tutor included. `model_and_critique` and
`connect_to_everyday_explanation` were absent in all 39 CER-scored transcripts. The judge's rationales
also demanded *"a written or formulated explanation"* that a chat never produces.
These criteria also drive the prod teacher-facing fidelity read (M5), so the fix
is in the shared judge, not in the benchmark. Prompt version **`fidelity-r2`**
(the fit read becomes `fit-all-r1+fidelity-r2`). r1 runs stay attributable
because the run id carries the version.

**Nothing here changes what a tutor is told.** `build_framework_instruction`
reads only `summary`, `behaviours`, `avoid` and `dimension`. Every edit below is
in `evaluationHint`, in the new `assessedIn`, or in the judge prompt. A test
checks this, and so did a byte-for-byte comparison of all seven generated
instructions against `dev`.

1. **A generic banding rule, for all seven** (`BANDING_RULE` in
   `framework_fidelity.py`). `strong` needs a move that is *distinctive* of the
   construct. Behaviour any competent questioning tutor shows (open questions,
   acknowledging or praising, a follow-up question, explaining the physics) is at
   most `partial`, and so is a move undercut by a "counts against" line in the
   same turn. The judge is asked: *would a capable tutor following no particular
   approach have written this turn anyway?* The rule also says that anything
   **said** in a turn counts, so nothing has to be written down.
   **Enforced where it can be.** Each listed move now has an id (`use.3`). A
   `strong` band must cite a valid id **of its own construct**, or the parser
   downgrades it to `partial` and marks it `downgraded`. A judge that simply
   agrees with everything can no longer produce a strong read.
2. **ESRU `recognise` and `use`** (`evaluationHint` only; the tutor-facing
   `summary` is unchanged). `recognise` means revoicing the student's words
   *without a verdict*. A turn that opens with "Correct"/"Exactly" is at most
   partial. `use` now has two tests. The existing counterfactual test stays.
   The new one asks whether the turn **hands the thinking back** to the student.
   A tutor that follows an answer by explaining the correct idea itself is giving
   IRE/F Feedback, not Use. That is the move the transcripts show from every
   tutor, and ESRU is defined against it.
3. **CER: assessable in dialogue, in part, and the rest is named as not
   assessed.** The transcripts show the CER tutor making CER moves in speech. It
   named the components (*"dit svar, dine målinger og det bagvedliggende fysiske
   princip"*). It gave a reason to convince someone (*"overbevise en skeptisk
   klassekammerat"*). It asked what "evidence" means. The judge credited these
   under `make_the_framework_explicit` and `rationale_for_explaining`. It left
   `assess_and_feedback` absent every time, reasoning that no written or formal
   explanation had been scored. So:
   - `assess_and_feedback`'s hint now says that a **spoken claim counts**. Naming
     the missing component and sending the student back to supply it is the move.
   - `model_and_critique` and `connect_to_everyday_explanation` carry
     **`assessedIn: unit`**. McNeill & Krajcik describe them as classroom
     strategies that run across a unit (worked strong and weak examples, an
     everyday argument taken apart first). In BENCH-1 they had zero variance
     across all 39. The judge is not asked about them. The fidelity
     result lists them under `notAssessed` with a reason, so they are **never a
     silent 0**, and they drop out of the fit average. The tutor is still told to
     do them. A framework with *no* dialogue-assessable construct abstains
     before any call is made.
   - The alternative was rejected: declaring all of CER not assessable in
     dialogue would throw away the strategies the transcripts show are visible,
     and the one per-column signal CER had (own tutor highest, 0.07 /
     0.17 against ≤0.03).

⚠️ **For AR/JB to review:** the `assessedIn: unit` judgement on the two CER
strategies is a reading of the chapter, not something it states. It is one YAML
line each, and the published tutor page now says "not assessed in a single
tutoring dialogue" beside both. ⚠️ A researcher's saved **structural override**
of CER, if one exists, replaces the YAML constructs. It would lack the flag until
the override is saved again from the editor. The editor round-trips unknown
construct fields, so a fresh save keeps the flag.

**Not yet shown:** whether r2 actually separates the columns. That takes a
re-run (BENCH-2's step 5) with real model calls. The tests here check the wiring
only: the rule is in every prompt, a generous mocked judge cannot produce a
strong ESRU read on a praise-and-explain transcript, and CER reports its two
unit strategies as not assessed.

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

### M1 — seven framework lenses ~1d — ✅ BUILT 2026-09-30 (reuse form; see What shipped)

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

### M2 — fan-out and the profile ~0.75d — ✅ BUILT 2026-09-30 (`score_fit_all`; see What shipped)

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
