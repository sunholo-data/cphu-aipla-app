---
title: "Capability floor: July 2026 snapshot"
description: "Measured model performance on Danish upper-secondary physics exam tasks, by deployment tier, with the thresholds and limitations that make the numbers usable."
eyebrow: "Evaluation snapshot"
owner: "AIPLA research team"
reviewed: "2026-09-03"
reviewBy: "2026-12-03"
status: "Provisional"
order: "51"
nav: "false"
---
# Capability floor: July 2026 snapshot

Most public discussion of model choice runs on leaderboards: model X scores 94% on some benchmark, model Y scores 72%, therefore use X. For an institution deciding what to host and what to route where, that framing is close to useless.

The benchmarks measure the wrong thing. They are built to separate frontier models at the top of their range — graduate-level science, competition mathematics — and most real teaching tasks are nowhere near that hard. Helping a first-year student through a mechanics problem does not need a model that can do graduate chemistry.

And a leaderboard has no notion of *enough*. The useful question is not "which model is best" but **what is the cheapest, smallest, most locally hostable model that is still good enough for this particular task?** That is the **capability floor** for a task, and it is the number that determines what you host, what you route to the cloud, and what your energy bill looks like.

This page is a dated snapshot of that measurement for one subject, taken in July 2026. The physics numbers will not generalise. The method, and three of the findings, probably will.

## What was measured

**The task.** Solving subquestions from Danish stx *Fysik A* written exams, graded against the official answer keys. This is a real task with a real, defensible ground truth — not a proxy.

**The panel.** Eleven models on the text task and nine on the figure-reading task, spanning four deployment tiers:

| Tier | Where it runs | Data leaves the building? |
|---|---|---|
| 1 | Commercial API (EU regions) | Yes — the prompt does |
| 2 | Multi-GPU server or small cluster, self-hosted | No |
| 3 | Single GPU or a well-specified workstation, self-hosted | No |
| 4 | Laptop, tablet or phone | No |

**The method.** Each model answers into an enforced value-and-unit schema with an explicit "I don't know" option, so a text-only model *declines* a question that needs a graph rather than inventing a reading. Grading is a deterministic value-and-unit comparison against the key, plus a language-model judge for cases where a numeric compare is insufficient. Every model was run **five times**; means and standard deviations are reported.

**The threshold.** The bar is set at **80%** — below that, a tutoring system produces enough confident errors to be a liability rather than a help. The bar is a judgement, and a different task class deserves a different one. Setting it explicitly is the point.

## How the exam items may be used

The items are drawn from **Prøvebanken**, the Danish Ministry of Education's bank of past examination material. The material carries an express reservation against text and data mining, which under section 11 b of the Danish Copyright Act would ordinarily prevent this use.

Section 11 c of the same Act — implementing Article 3 of the EU Digital Single Market Directive — permits a **research organisation** with lawful access to mine the material for the purposes of scientific research, notwithstanding that reservation. The University of Copenhagen is a research organisation for these purposes. The Ministry's agency for education and quality confirmed this reading in writing in September 2026, on the condition that no language model developed from the material is placed on the market.

AIPLA trains and fine-tunes nothing. The evaluation runs existing, commercially available models against the items and scores their answers; no exam material enters the teaching platform, its knowledge base, or its prompts.

Two consequences govern this page:

- **Aggregate results are published; items are not.** The scores, rankings, and per-tier conclusions below are project findings and are freely citable. The exam questions and answer keys are neither reproduced here nor redistributed, and the evaluation set is not published as a dataset.
- **The corpus is retained for verification.** It is held on university-controlled infrastructure so that results can be reproduced and the evaluation re-run, as section 11 c permits.

## Text: solving exam problems

Means over five runs, 33 text-solvable subquestions from the 2023–24 gold sets:

| Model | Tier | Score (mean ± sd) | Clears 80% |
|---|---|---|---|
| Claude (sonnet / opus / haiku) | 1 — cloud API | 93–96 ± ≤2 | yes |
| gemini-3.5-flash | 1 — cloud API | 95 ± 2 | yes |
| **deepseek-v4-flash** (open) | **2 — multi-GPU, self-hosted** | **91 ± 2** | **yes** |
| **qwen3-32b** (open) | **3 — single GPU, self-hosted** | **88 ± 6** | **yes** |
| gemini-2.5-flash | 1 — cloud API | 87 ± 3 | yes |
| **qwen3-8b** (open) | **4 — laptop-class** | **83 ± 3** | **yes, borderline** |
| qwen3-next-80b-a3b (open) | 2 | 75 ± 6 | no |
| gemini-2.5-flash-lite | 1 — cloud API | 73 ± 4 | no |
| qwen3-30b-a3b (open) | 3 | 68 ± 9 | no |
| mistral-small-24b (open) | 3 | 67 ± 6 | no |
| gemma-3-27b (open) | 3 | 64 ± 3 | no |

## Figures: reading graphs and diagrams

The questions a text-only model has to decline. Means over five runs, 8 items, vision-capable models only:

| Model | Tier | Score (mean ± sd) | Clears 80% |
|---|---|---|---|
| gemini-3.5-flash | 1 — cloud API | 98 ± 5 | yes |
| **qwen3-vl-235b-a22b** (open) | **2 — multi-GPU, self-hosted** | **95 ± 6** | **yes** |
| gemini-2.5-flash | 1 — cloud API | 93 ± 6 | yes |
| **qwen3-vl-32b** (open) | **3 — single GPU, self-hosted** | **88 ± 0** | **yes** |
| glm-4.6v (open) | 3 | 83 ± 6 | yes |
| gpt-5-mini | 1 — cloud API | 75 ± 0 | no |
| qwen3-vl-8b (open) | 4 — laptop-class | 63 ± 8 | no |
| gemma-3-27b (open, general-purpose) | 3 | 60 ± 18 | no |
| gemini-2.5-flash-lite | 1 — cloud API | 40 ± 9 | no |

## The combined picture

A real deployment must handle both kinds of question, so **a tier is only as capable as its weaker modality**:

| Tier | Text | Figures | Tier capability | Clears 80% |
|---|---|---|---|---|
| 1 — cloud API | 93–96 | 98 | **93** | yes |
| 2 — multi-GPU, self-hosted | 91 | 95 | **91** | yes |
| 3 — single GPU, self-hosted | 88 | 88 | **88** | yes |
| 4 — laptop / phone | 83 | 63 | **63** | no — vision-limited |

## Three findings beyond physics

### For this task class, self-hosting is already viable

All three server-class tiers clear the bar on both modalities. A **single GPU** running open-weight models scores 88 on both text and figures — comfortably useful, with no data leaving the building and no per-query cost. This is not a projection about 2027; it is a measurement from July 2026.

The corollary matters as much: **the cloud frontier is not required for this task.** Well-posed upper-secondary physics is not frontier-hard. Where a task turns out not to be frontier-hard, paying frontier prices for it is a choice, not a necessity — and the only way to know which tasks those are is to measure them.

The remaining gap is on-device, and it is **figure-reading, not physics**. A laptop-class model already solves the text at the threshold (83); its vision counterpart trails at 63. That gap is bounded by device memory rather than by model quality, so it will close on hardware refresh cycles rather than on model releases.

### A self-hosted tier needs two models, not one

This is the most immediately actionable finding for a model catalogue. The strongest open text models are **architecturally text-only** — they cannot accept an image at all. The strongest open vision-language models *can* do text, but score **12 to 36 points worse** than the text specialist at the same tier, every one of them falling below the threshold. Multimodal training trades away reasoning quality.

**So a self-hosted tier serves a text model *and* a vision-language model behind one endpoint, routed by whether the question carries a figure.** Provisioning for one model per tier will under-serve one modality or the other, and which one fails will not be obvious from a leaderboard.

Note also that a *general-purpose* open model given an image performs badly and erratically (60 ± 18, with hard failures) where a dedicated vision-language model of the same size is stable at 88 ± 0. "Our model handles images" and "our model handles images well" are different claims.

### Published benchmarks will mis-rank your candidates

This work began as an attempt to shortcut the measurement using public benchmark scores, and that did not survive contact with the task. Three specific failures, each of which would have led to a wrong procurement decision:

- **Some widely-cited figures do not exist.** Scores repeated across technical blogs for one major open model turned out to have no basis in its technical report, and appeared in mutually inconsistent versions across sources. They were removed.
- **Vendor self-reported scores implied implausible generational jumps** — up to 42 points over the previous generation's independently verified figure — with no independent confirmation. On this task, the models concerned landed far below their published claims.
- **Even honest benchmarks rank the cheap candidates wrongly.** These scores correlate with the closest public benchmark at roughly r = 0.73 — enough to confirm the same underlying capability is being measured, not enough to substitute for measuring it. The clearest case: the model with the *lowest* public benchmark score of all the open models scored **83** here, because the public benchmark is graduate-level and this task is not. A benchmark-based shortlist would have eliminated the cheapest viable self-hosting candidate.

The general form: **public benchmarks are calibrated for the top of the range, and most institutional tasks are not at the top of the range.** For any task where the choice actually matters, a small task-specific evaluation beats a large general one.

There is a methodological point attached. The first version of this table used single runs. Repeating each model five times moved individual scores by up to 15 points and reshuffled the middle of the field, and **open-weight models are markedly noisier than commercial ones**. Any single-run comparison at this resolution — including most of what is published in blog posts — should be treated as unreliable.

## What this does and does not say about energy

This measures capability, not energy. But capability per tier is the *precondition* for an energy policy, because it converts a values question into an engineering one.

Once you know that a task class clears its bar on a single self-hosted GPU, routing that task to a frontier cloud model is a measurable, avoidable cost — and the argument for right-sizing stops being an appeal to restraint and becomes a straightforward efficiency claim. Once you know that a task genuinely needs the frontier, you can pay for it without apology.

What this snapshot does not supply is the energy measurement itself. That would need per-query energy figures for the deployed hardware.

## Limitations — please read before citing

- **Provisional.** Five runs per model, 33 text items and 8 figure items. The rank order and the "tiers 1–3 clear the bar" conclusion are robust to the noise. Individual gaps of less than one standard deviation are not. Read the bands, not the ranks — especially on the figure axis, where a single item is worth 12.5 points.
- **Machine-graded, not yet human-audited.** A physics teacher's calibration sample against a subset of items is the next step, and would also pin down how much of the variance is the grader's own.
- **One task class, one subject, one country's curriculum.** Physics exam problems have unusually clean ground truth. Essay feedback, literature synthesis, or code review would each need their own threshold and their own items, and would very likely place the floor at a different tier.
- **Models move.** This is a July 2026 snapshot. The evaluation is versioned and re-runnable precisely because the answer has a shelf life of months.

## Re-running this

The evaluation is a versioned item set plus a runner, built to be re-run as new models release. Its machinery is not physics-specific — only its items are. The intended cadence is quarterly, and each re-run replaces this snapshot rather than amending it, so that a citation of "the July 2026 snapshot" continues to mean what it meant.

The expensive part of extending the method to another subject is not the software. It is deciding what "good enough" means for a given task and assembling thirty or so items with defensible ground truth — roughly a week of a domain expert's attention per task class.

The framework these numbers instantiate, including the task taxonomy and scoring dimensions, is described under [Evaluation](/project/evaluation).
