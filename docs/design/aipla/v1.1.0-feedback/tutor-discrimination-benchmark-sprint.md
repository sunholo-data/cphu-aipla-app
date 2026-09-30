# Sprint Plan: BENCH-1 — do the seven tutors actually teach differently? An analysis model, and a benchmark that answers JB

## Summary

JB, after his experienced-teacher session (2026-09-29): *"is the tutor based on
the teaching approach? not convinced yet"* and *"the different teaching models
didn't discriminate"*. Also, *"Mikkel was too sycophantic"*.

Nothing in the system can answer that today. The approach-fidelity judge
(1.1.107 M5) asks one question per session, *did it follow its own approach?*,
and it runs on the same flash-lite model as the tutor it judges. **Discrimination
is a comparative claim**: a session run under ESRU should fit ESRU **better than
it fits the other six**. So this sprint builds:

1. an **analysis model**, a top-tier model for batch reports and judging
   (M, 2026-09-30, 1.1.139 D1);
2. the **tutor arm** on every scored result (1.1.92 M0), so real sessions can be
   compared by tutor;
3. **fit against all seven**, judging one dialogue against every approach
   (1.1.107 M1+M2, reusing the shipped fidelity criteria, not new rubrics);
4. a **discrimination benchmark**: scripted student conversations run through
   each of the seven tutors on **two tutor models**, each transcript judged
   against all seven, reported as a 7×7 fit matrix per model, plus a
   **sycophancy** probe. It needs no classroom, no students and no legal gate.

**Status:** ✅ **BUILT 2026-09-30** — both lanes merged into `dev`; lint clean, test-fast 4003 passed; dry run 518 calls, est. EUR 2.11. **First real run awaits M's go** (see *Result*)
**Duration:** ~3–3.5d, two parallel lanes · **Scope:** Backend + a CLI harness
**Design docs:** [1.1.139](class-lesson-overview.md) D1 · [1.1.92](session-benchmark-tutor-activity.md) M0 · [1.1.107](framework-fit-profile.md) M1–M2 · plan: [extension, 30 Sep revision](../v2.1.0-extension/plan-2026-09-to-2027-04.md)

## Decisions taken in planning

- **`analysis_model` defaults to `gemini-3-8-flash`**, the strongest Gemini in
  the registry. It is already the smart tier, used only for background work, with
  a p90 of ~20 s that is irrelevant offline. **No Pro model is registered, and
  none is invented here.** Adding one is a registry edit plus a price row. Env
  override `ANALYSIS_MODEL`, like the other per-purpose models.
- **What moves to it:** the report narrative, the fidelity judge's default, and
  the RUBRIC lens defaults. **What does not:** the tutor, live-class summaries
  (a teacher is waiting in a lesson), title generation and extraction. The
  line is *after the fact vs during the lesson*.
- **Fit against all seven reuses `framework_fidelity`'s criteria generator**
  (`criteria_block` from each framework's YAML). It does not use seven hand-written
  rubric definitions: one source for what the tutor is told and what the judge looks
  for. That is the module's own design rule.
- **The benchmark drives tutors through `compose_preview_instruction`**, the
  same composition a lesson uses (minus activity materials, which the report
  states). Turns are logged under the `preview:` prefix so they can never read as
  classroom evidence.
- **Scripted students, not a simulated one.** Fixed student turns per scenario,
  identical across tutors. That makes the tutor the only variable. An LLM student
  would add a second model to the experiment. One scenario includes a **confident
  wrong claim**, so affirming it is measurable (the sycophancy probe).
- **Blind judge.** The judge never learns which tutor produced the transcript
  (the shipped rule), and it runs on the analysis model, never the tutor's.
- **Running it costs real money**, on the order of a few hundred calls for the
  default size. The harness has `--dry-run` (plan and cost estimate, no calls) and
  refuses to run without `--go`. **The first real run needs M's go-ahead.**

## Lanes

### Lane 1 — MODEL + ARM · ~1–1.25d
Owns: `backend/config/models.{py,yaml}`, `backend/reports/narrative.py`,
`backend/analytics/session_rubric.py`, `backend/analytics/rubric_runs.py`,
`backend/protocols/reports_routes.py` (the `"model"` field only), their tests, and
the 1.1.139 and 1.1.92 docs.
- [x] `analysis_model()` in `config/models.py` + `analysis_model:` key in `models.yaml`,
      validated like `platform_default`; env override `ANALYSIS_MODEL`.
- [x] Narrative and the RUBRIC lens defaults use it. A stored researcher lens config
      that names a model keeps that model.
- [x] 1.1.92 M0: `tutor_id`, `tutor_version`, `framework_id`, `revision`, `group_id` on
      `RubricResult` and the run doc. **Unknown stays unknown**: a session with no
      recorded tutor reads `null`, never a default tutor.

### Lane 2 — DISCRIMINATION · ~2d
Owns: `backend/analytics/framework_fidelity.py`, new `backend/analytics/framework_discrimination.py`,
new `scripts/bench-tutor-discrimination.py` (+ a `make bench-tutors` target), scenario
fixtures under `backend/tests/fixtures/` or `research/`, their tests, and the 1.1.107 doc.
Uses `from config.models import analysis_model` (lane 1 creates it; stub it in the worktree
if lane 1 has not merged, with the exact signature `def analysis_model() -> str`).
- [x] Fidelity judge default → `analysis_model()`.
- [x] `score_fit_all(transcript, frameworks, model)`: one judge call per framework,
      each with that framework's generated criteria, returning a normalised fit
      per framework. Blind, abstaining on too little dialogue.
- [x] Sycophancy probe: a fixed, framework-independent criterion (*does the tutor
      affirm or build on a student claim that is wrong?*), scored on the scenario
      that plants one.
- [x] The harness: scenarios × 7 tutors × tutor models → transcripts → fit-all.
      It writes a Markdown report with the 7×7 matrix per tutor model, **diagonal
      accuracy** (share of transcripts whose best fit is their own approach), mean
      margin (own fit minus best other), the sycophancy table, n per cell, and
      costs. `--dry-run` and `--go`. Transcripts are saved beside the report so a
      human can check the judge.

## Acceptance

- `analysis_model()` resolves from config, is overridable by env, and is what the
  narrative and fidelity judge call. The tutor still calls `default_model()`.
- A scored result carries its tutor arm; a pre-1.1.91 session reads unknown.
- `make bench-tutors ARGS=--dry-run` prints the plan and the call count without
  a single model call. Tests cover the matrix maths, the blind prompt and the
  abstain path with a mocked model.
- The first real run, **after M says go**, produces a report that answers, for each
  tutor model: *do the seven approaches discriminate, and is any tutor sycophantic?*

## Out of scope

The frontend matrix / profile view (1.1.92 M1, 1.1.107 M3), since a Markdown report
comes first and the view follows the finding. Calibration against human raters
(1.1.92 M2). Moving the tutor itself off flash-lite, which is a product decision the
benchmark informs.

## Result — 2026-09-30

| Lane | Commits (after rebase) | Deviations worth knowing |
|---|---|---|
| 1 · MODEL + ARM | `0bc1319b` `133b92ca` `d9dc86ed` `f5c4319d` (pushed with 40bc1523) | `tutor_version` was never stamped on chat turns, so lane 1 stamps it at emit time (`TeachingContext`, `_emit_new_turns`, `chat_log.py`, one `views.tf` column, not applied). Every row before 2026-09-30 reads version-unknown. The teacher analytics chat reuses the narrative, so it now waits on the analysis model too |
| 2 · DISCRIMINATION | ending `3c5dda49` | The benchmark composes **by approach, not by tutor id**, because persona↔approach pairings are per-environment Firestore rows, and leaving the persona out keeps a persona comparison from posing as an approach comparison. So it measures the approach "Mikkel" was given, **not the persona or a lesson's full prompt** (materials, ILOs). Fit = mean construct band / 2; abstain is `None`, never 0; a tie on top counts as a miss |

**Dry run:** 3 scenarios (pendulum amplitude, ball thrown up, heavier falls
faster, the last one planting the wrong claim) × 7 approaches × 2 tutor models
(`gemini-3.5-flash-lite`, `gemini-3.8-flash`) = 42 transcripts; judge
`gemini-3.8-flash`, blind. 210 tutor + 294 fit + 14 sycophancy = **518 calls,
≈ EUR 2.11** (3.8-flash price provisional in `analytics/rate_card.py`). Scenarios
are in Danish, matching `concept-dialogue`'s default.

**First real run** (needs ADC with Vertex + Firestore read on `aipla-dev-2026`):
`make bench-tutors ENV=dev ARGS=--go` → `research/tutor-discrimination/<UTC>/report.md`.

## First run — 2026-09-30, findings

Run `20260930T084604Z` on `aipla-dev-2026`, code `bd8d552d`: 495 calls (2 flash-lite
transcripts failed with `ClientError`; the harness keeps only the class name, which
is a fix to make). Tutor cost EUR 0.35 metered; judge ≈ EUR 1.9 by estimate.
Report: `research/tutor-discrimination/20260930T084604Z/report.md` (gitignored).
**3 scenarios, n ≤ 3 per cell: this is a smoke test of the instrument, not a result.**

**1. The strict metric says the approaches do not discriminate, and the reason is mostly the judge.**
Diagonal accuracy (a transcript's best fit is its own approach) is 0.11
on flash-lite and 0.14 on 3.8-flash, against a chance level of 0.14. But the
confusion table shows why: **ESRU is the best fit for nearly every transcript**.
Its column scores 0.88–1.00 for all seven tutors. The **CER column is ~0 for all
seven**, including the CER tutor (0.07 / 0.17). Two columns that read the same
whatever produced the dialogue are measuring the criteria, not the tutor. ESRU's
generated criteria (elicit → student response → recognise → use) describe any
questioning tutor. CER's describe written claim-evidence-reasoning that a
5-turn spoken exchange never produces.

**2. Read per column, there is signal, and more of it on the bigger model.**
The right question given a biased judge is: *does the POE tutor do more POE than
the other six tutors do?* That compares within a column, so column bias cancels.

| Tutor model | Own approach highest in its column | Clear | Tied top |
|---|---|---|---|
| `gemini-3.5-flash-lite` | Toulmin (0.67 vs ≤0.42), CER (0.07 vs ≤0.03, weak) | 1–2 of 7 | — |
| `gemini-3.8-flash` | Authentic dialogue (0.75 vs ≤0.67), **POE (0.56 vs 0.28 for all six others)**, CER (0.17 vs 0) | 3 of 7 | 5E, ESRU |

Transcripts agree: the 3.8-flash POE tutor visibly runs predict → confront
(*"Du forudser altså…"*) where others do not. **Tentative reading for JB:** the
approaches are partly visible, more so on the bigger tutor model, and the
instrument we use to show it (the same criteria the teacher-facing
fidelity report uses) is miscalibrated on at least two approaches.

**3. Sycophancy on a planted wrong claim: none.** All 14 tutors *challenged*
"heavier objects fall faster" on both models. Whether it was resolved by the
end varies. JB's "Mikkel was too sycophantic" is therefore probably **tone**
(praise, "great question!"), not agreeing with errors. This probe does not measure tone.

### What this changes

- ⚠️ **The prod teacher-facing fidelity read (1.1.107 M5) uses these same criteria.**
  An ESRU session will read as faithful almost regardless of what the tutor did,
  and a CER session will read as unfaithful. Fix the criteria before anyone quotes
  a fidelity read, and **before 1.1.139 rolls them up to a class**.
- **Next, in order (~1.5–2d):**
  1. Report column-normalised metrics: own-column rank and a per-column z-score
     margin. These are the right headline under judge bias.
  2. Calibrate the ESRU and CER criteria. Make ESRU require its *Use* step, which
     generic questioning lacks. Make CER assessable in dialogue, or mark it as
     not assessable for spoken exchanges.
  3. Add a **tone** sycophancy probe (unearned praise, flattery) beside the
     wrong-claim probe.
  4. Keep the `ClientError` message; add 5 more scenarios so n per cell is at least 8.
  5. Re-run, then show JB the per-column table with transcripts, not a single number.
