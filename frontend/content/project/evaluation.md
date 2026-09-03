---
title: "Evaluation"
description: "How AIPLA evaluates task-specific AI capability and pedagogical use without treating rankings as permanent."
eyebrow: "Evidence and limitations"
owner: "AIPLA research team"
reviewed: "2026-09-03"
reviewBy: "2026-12-03"
status: "Provisional"
order: "50"
nav: "true"
---
# Evaluation

AIPLA needs evidence about two different questions:

1. **Technical capability:** can a model or system perform the physics-related operation an activity requires?
2. **Pedagogical value:** does using that capability in a particular classroom design support the intended learning or assessment process?

Technical success is necessary for some activities, but it is never sufficient evidence of educational value.

## A capability floor, not a permanent leaderboard

The evaluation approach asks whether a candidate system reaches a defined level of reliability for a task class. The purpose is to support decisions about routing, safeguards, and deployment — not to declare one model universally best.

Model names, versions, access conditions, prices, and benchmark scores change quickly. Public results should therefore be published as dated snapshots with a frozen dataset, configuration, scoring method, and interpretation. An old snapshot remains historical evidence rather than silently becoming a statement about the current market.

## Task taxonomy

Evaluation is organised around operations relevant to physics activities, for example:

- solve or scaffold a quantitative problem;
- interpret a graph or diagram;
- connect verbal, mathematical, graphical, and pictorial representations;
- identify an assumption or misconception;
- interpret experimental data and uncertainty;
- respond to an image of student work;
- produce a useful question without revealing the solution;
- ground a response in teacher-supplied material; and
- interact correctly with structured workbench state.

A model that performs well on text-only questions may not perform equally well on figures, diagrams, or experimental evidence. Results are therefore separated by modality and task rather than collapsed into one score.

## Public benchmarks and local tasks

Public benchmarks can provide context about broad reasoning, mathematics, multimodal understanding, or code generation. They do not directly measure whether a tutor supports a Danish upper-secondary physics activity appropriately.

AIPLA therefore combines external evidence with project-specific tasks. Local evaluation material can include curriculum-relevant physics questions, graph-reading items, tutor-behaviour checks, and interaction tests tied to actual activities.

Rights, provenance, answer-key quality, and expert validation must be recorded for every evaluation collection.

## Scoring dimensions

Depending on the task, useful dimensions include:

- correctness of the physics;
- completeness and relevance;
- consistency across repeated runs;
- correct use of a supplied source or representation;
- recognition of uncertainty or missing information;
- adherence to tutor constraints;
- latency and operational reliability;
- cost for the intended scale; and
- safe behaviour when the system cannot complete the task.

For small datasets, uncertainty must be made visible. A difference of one item can create a large apparent percentage change and should not be presented as a precise ranking.

## Reproducibility requirements

A publishable evaluation snapshot should record:

- evaluation version and date;
- dataset version and inclusion criteria;
- item count by task and modality;
- model identifier and provider configuration;
- prompt or agent configuration;
- number of repeated runs;
- scoring rules and reviewer process;
- mean, variation, and relevant confidence information;
- known errors, exclusions, and limitations; and
- the code or procedure needed to reproduce the result where release is permitted.

## Evaluation of tutor behaviour

Correct answers alone do not establish that a tutor behaves productively. A tutor can be physically correct while being too directive, too verbose, insensitive to a student's current work, or willing to complete the task it is meant to scaffold.

Tutor evaluation can therefore examine whether it:

- asks a question appropriate to the current activity stage;
- uses workbench state accurately;
- avoids claiming access it does not have;
- leaves the central reasoning step to the student;
- handles incorrect student reasoning constructively;
- stays within the teacher-prepared context; and
- communicates limitations clearly.

Classroom evidence is still required to understand how those behaviours are experienced and used by students.

## Published snapshots

Results are published as **dated snapshots** rather than as a running leaderboard, so that an older result stays readable as historical evidence instead of silently becoming a claim about the current market.

- **[Capability floor: July 2026 snapshot](/project/evaluation/capability-floor)** — eleven models on text and nine on figure-reading, measured against Danish stx *Fysik A* exam tasks and separated by deployment tier. Reports where the 80% threshold is cleared, why a self-hosted tier needs two models rather than one, and why public benchmarks mis-rank the cheapest viable candidates.

The exam items underlying that snapshot are used under the research-organisation exception for text and data mining in section 11 c of the Danish Copyright Act. Aggregate results are published; the items and answer keys are not reproduced or redistributed. The rights position is set out in full on the snapshot page.

Evaluation of tutor behaviour and the classroom evidence that must accompany it are still in development, and no snapshot of either is published yet. Claims about tutor quality should be treated as provisional engineering evidence rather than project findings.
