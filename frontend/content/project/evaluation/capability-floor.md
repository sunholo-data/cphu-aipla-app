---
title: "Capability floor: October 2026 snapshot"
description: "Measured model performance — and time to answer — on Danish upper-secondary physics exam tasks, by deployment tier, with the thresholds and limitations that make the numbers usable."
eyebrow: "Evaluation snapshot"
owner: "AIPLA research team"
reviewed: "2026-10-06"
reviewBy: "2027-01-06"
status: "Provisional"
order: "51"
nav: "false"
---
# Capability floor: October 2026 snapshot

Most public discussion of model choice runs on leaderboards: model X scores 94% on some benchmark, model Y scores 72%, therefore use X. For an institution deciding what to host and what to route where, that framing is close to useless.

The benchmarks measure the wrong thing. They are built to separate frontier models at the top of their range — graduate-level science, competition mathematics — and most real teaching tasks are nowhere near that hard. And a leaderboard has no notion of *enough*. The useful question is not "which model is best" but **what is the cheapest, smallest, most locally hostable model that is still good enough for this particular task?** That is the **capability floor** for a task, and it is the number that determines what you host, what you route to the cloud, and what your energy bill looks like.

This page is the second dated snapshot of that measurement, taken in October 2026. It replaces the [July 2026 snapshot](/project/evaluation/capability-floor-2026-07), which stays published unchanged. Two things are new: a fresh panel of models, and a second measure alongside accuracy — **how long a model takes to answer**, because a model that is right but slow is not usable in a lesson.

## What was measured

**The task.** Solving subquestions from Danish stx *Fysik A* written exams, graded against the official answer keys. This is a real task with a real, defensible ground truth — not a proxy.

**The panel.** Thirteen models, each on both the text task and the figure-reading task:

- the two Gemini models the AIPLA tutor runs on today (3.5 Flash-Lite, its default, and 3.8 Flash), and 3.5 Flash as a link to July;
- open-weight families an institution might host itself: Qwen 3.5, 3.6 and 3.8, Gemma 4, DeepSeek V4.1 and Ministral;
- Qwen 3.7 Flash and Plus and GLM 5.3 Flash, available through a commercial API; whether their weights can be downloaded and hosted has not been checked, so they are not placed in a self-hosted tier.

| Tier | Where it runs | Data leaves the building? |
|---|---|---|
| 1 | Commercial API (EU regions) | Yes — the prompt does |
| 2 | Multi-GPU server or small cluster, self-hosted | No |
| 3 | Single GPU or a well-specified workstation, self-hosted | No |
| 4 | Laptop, tablet or phone | No |

**The method.** Unchanged from July, so the two snapshots can be compared. Each model answers into an enforced value-and-unit schema with an explicit "I don't know" option, so a model that cannot read a figure *declines* rather than inventing a reading. Grading is a deterministic value-and-unit comparison against the key, plus a language-model judge where a numeric compare is insufficient. Every model was run **five times**; means and standard deviations are reported. Text scores count the questions a model attempted; on the figure task a declined question counts as a miss.

**The threshold.** The bar is **80%** — below that, a tutoring system produces enough confident errors to be a liability rather than a help. The bar is a judgement, and a different task class deserves a different one.

**Time to answer.** New in this snapshot: the wall-clock time from sending a question to receiving the complete answer, one timed run per model over every item. The figure reported is the **median**, with the slowest tenth in brackets.

## How the exam items may be used

The items are drawn from **Prøvebanken**, the Danish Ministry of Education's bank of past examination material. The material carries an express reservation against text and data mining, which under section 11 b of the Danish Copyright Act would ordinarily prevent this use.

Section 11 c of the same Act — implementing Article 3 of the EU Digital Single Market Directive — permits a **research organisation** with lawful access to mine the material for the purposes of scientific research, notwithstanding that reservation. The University of Copenhagen is a research organisation for these purposes. The Ministry's agency for education and quality confirmed this reading in writing in September 2026, on the condition that no language model developed from the material is placed on the market.

AIPLA trains and fine-tunes nothing. The evaluation runs existing, commercially available models against the items and scores their answers; no exam material enters the teaching platform, its knowledge base, or its prompts.

Two consequences govern this page:

- **Aggregate results are published; items are not.** The scores, rankings, and per-tier conclusions below are project findings and are freely citable. The exam questions and answer keys are neither reproduced here nor redistributed, and the evaluation set is not published as a dataset.
- **The corpus is retained for verification.** It is held on university-controlled infrastructure so that results can be reproduced and the evaluation re-run, as section 11 c permits.

## Text: solving exam problems

Means over five runs, the same 33 subquestions as July:

| Model | Tier | Score (mean ± sd) | Clears 80% | Time to answer, median (slowest 10%) |
|---|---|---|---|---|
| gemini-3.8-flash | 1 — cloud API | 100 ± 0 | yes | 9 s (28 s) |
| gemini-3.5-flash | 1 — cloud API | 98 ± 2 | yes | 18 s (351 s) |
| qwen3.7-plus | API — weights unverified | 97 ± 2 | yes | 41 s (140 s) |
| qwen3.6-35b-a3b (open) | 3 — single GPU | 96 ± 2 | yes | 107 s (250 s) |
| **qwen3.8-27b** (open) | **3 — single GPU** | **95 ± 2** | **yes** | **29 s (137 s)** |
| **gemma-4-31b** (open) | **3 — single GPU** | **95 ± 2** | **yes** | **11 s (25 s)** |
| **deepseek-v4.1-flash** (open) | **2 — multi-GPU** | **95 ± 2** | **yes** | **10 s (64 s)** |
| glm-5.3-flash | API — weights unverified | 94 ± 3 | yes | 6 s (27 s) |
| **gemini-3.5-flash-lite** | **1 — cloud API** | **87 ± 7** | **yes** | **2 s (3 s)** |
| qwen3.5-9b (open) | 4 — laptop-class | 87 ± 8 | yes, but declines a third | 59 s (199 s) |
| qwen3.7-flash | API — weights unverified | 85 ± 8 | yes | 70 s (97 s) |
| gemma-4-26b-a4b (open) | 3 — single GPU | 85 ± 6 | yes | 9 s (29 s) |
| ministral-8b (open) | 4 — laptop-class | 82 ± 6 | yes, borderline | 5 s (14 s) |

Since July, 11 further subquestions have had their answer keys curated by hand, bringing the text set to 44. On all 44, every model's score is within three points of the figure above.

## Figures: reading graphs and diagrams

Means over five runs, 8 items. A declined question counts as a miss:

| Model | Tier | Score (mean ± sd) | Clears 80% | Time to answer, median (slowest 10%) |
|---|---|---|---|---|
| gemini-3.8-flash | 1 — cloud API | 100 ± 0 | yes | 8 s (15 s) |
| gemini-3.5-flash | 1 — cloud API | 100 ± 0 | yes | 14 s (31 s) |
| glm-5.3-flash | API — weights unverified | 98 ± 5 | yes | 18 s (113 s) |
| **qwen3.8-27b** (open) | **3 — single GPU** | **95 ± 6** | **yes** | **23 s (135 s)** |
| **deepseek-v4.1-flash** (open) | **2 — multi-GPU** | **95 ± 6** | **yes** | **17 s (175 s)** |
| **gemini-3.5-flash-lite** | **1 — cloud API** | **93 ± 10** | **yes** | **2 s (3 s)** |
| **gemma-4-31b** (open) | **3 — single GPU** | **90 ± 5** | **yes** | **13 s (16 s)** |
| qwen3.7-plus | API — weights unverified | 83 ± 10 | yes | 10 s (50 s) |
| gemma-4-26b-a4b (open) | 3 — single GPU | 83 ± 13 | yes, unstable | 11 s (32 s) |
| qwen3.6-35b-a3b (open) | 3 — single GPU | 68 ± 17 | no | 29 s (38 s) |
| qwen3.5-9b (open) | 4 — laptop-class | 50 ± 14 | no | 70 s (127 s) |
| qwen3.7-flash | API — weights unverified | 40 ± 5 | no — declines most | 60 s (68 s) |
| ministral-8b (open) | 4 — laptop-class | 0 | no — declines all | 3 s (12 s) |

## The combined picture

A real deployment must handle both kinds of question, so **a tier is only as capable as its weaker modality** — and, for a lesson, only as usable as it is quick:

| Tier | Best model | Text | Figures | Tier capability | Clears 80% | Time to answer (median) |
|---|---|---|---|---|---|---|
| 1 — cloud API | gemini-3.8-flash | 100 | 100 | **100** | yes | 8–9 s |
| 1 — cloud API, cheapest | gemini-3.5-flash-lite | 87 | 93 | **87** | yes | 2 s |
| 2 — multi-GPU, self-hosted | deepseek-v4.1-flash | 95 | 95 | **95** | yes | 10–17 s |
| 3 — single GPU, self-hosted | qwen3.8-27b / gemma-4-31b | 95 | 95 / 90 | **90–95** | yes | 11–29 s |
| 4 — laptop / phone | qwen3.5-9b | 87 | 50 | **50** | no — vision-limited | ~60 s |

## Findings

### Passing is not the same as usable

This is the finding the July snapshot could not see, and it is the one that matters most for hardware. On accuracy alone, nine models clear the bar on both text and figures. On time, they spread across two orders of magnitude: the fastest returns a complete worked answer in about **2 seconds**, the slowest takes **well over a minute** at the median and several minutes on its slowest tenth.

A student in a lesson will not wait a minute for a reply. So a model is usable for tutoring only if it is both accurate enough *and* quick enough, and the second condition removes several of the most accurate open models from a live-session role. They remain candidates for work nobody waits on — overnight analysis, preparing material, scoring session logs.

Much of the slowness is the models' own *reasoning* mode: several of these models think at length before answering, by default. That is a setting, not a property of the weights, so a reasoning-limited configuration may be much faster — at an accuracy cost that has to be measured, not assumed. Two cautions on the numbers themselves: these times were measured through commercial hosting services, so they describe those providers' hardware, not hardware an institution would buy; and a full worked exam answer is longer than a tutor's turn in a conversation, so the times are an upper bound on a single reply.

### The tutor's default model clears the bar

AIPLA's tutor runs by default on the cheapest Gemini tier. In July its predecessor failed both tasks (73 on text, 40 on figures). Its successor, Gemini 3.5 Flash-Lite, clears both — 87 and 93 — and is the fastest model measured. It is also the least stable at the top of the table (± 7 and ± 10), which is the cost of a small model.

### A single open model can now serve a self-hosted tier

The July snapshot's most actionable finding was that **a self-hosted tier needed two models** — a text model and a vision model — because no open model cleared the bar on both. That no longer holds. **Qwen 3.8 27B** (95 / 95) and **Gemma 4 31B** (95 / 90) each clear both, at a size that fits one GPU. Of the two, Gemma 4 31B answers in well under half the time (11 s against 29 s at the median).

The caveat is the one this method exists to enforce: these open models were measured through a hosting service, not on our own hardware, and a self-hosted build may be quantised differently. Until the same model has been measured on the hardware that would serve it, this is a strong indication, not a procurement result.

### The on-device gap is still figures, not physics

At laptop size, models solve the text at or near the threshold (82–87) but cannot yet read the figures: one declines half of them, another declines all of them. As in July, that gap is bounded by device memory rather than by what the models know.

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

- **Provisional.** Five runs per model for accuracy; one timed run per model for time. Read the bands, not the ranks — especially on the figure axis, where a single item is worth 12.5 points.
- **Open models were measured through a hosting service**, not on self-hosted hardware. Scores may shift slightly with a different build; times will shift substantially with different hardware.
- **Time includes retries.** A rate-limited request that was retried counts its full wait. Several models were measured concurrently, which can inflate the slowest times.
- **Openness was not checked for every model.** Three models listed here are available through an API; whether their weights can be self-hosted has not been verified.
- **Machine-graded, not yet human-audited.** A physics teacher's calibration sample against a subset of items is still the next step.
- **One task class, one subject, one country's curriculum.** Physics exam problems have unusually clean ground truth; other tasks would need their own threshold and items.
- **Models move.** This is an October 2026 snapshot. The next is due in January 2027.

## Re-running this

The evaluation is a versioned item set plus a runner, built to be re-run as new models release. Its machinery is not physics-specific — only its items are. The cadence is quarterly, and each re-run replaces this page while the previous snapshot stays published at its own address, so that a citation of a dated snapshot continues to mean what it meant.

The next measurement to add is the same comparison **on the hardware that would serve it**: one candidate open model on a self-hosted GPU, reporting both accuracy and time per answer, so that a hardware decision can rest on a measurement rather than on a hosting service's numbers.

The framework these numbers instantiate, including the task taxonomy and scoring dimensions, is described under [Evaluation](/project/evaluation).
