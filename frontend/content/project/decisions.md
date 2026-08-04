---
title: "Project decisions"
description: "A public record of the product and research-infrastructure choices that shape AIPLA, with their rationale and practical consequences."
eyebrow: "Why the platform works this way"
owner: "AIPLA project team"
reviewed: "2026-08-04"
reviewBy: "2026-09-04"
status: "Current"
order: "75"
nav: "true"
---
# Project decisions

AIPLA is not simply a chatbot with physics content. Its present shape comes from a series of choices about classroom practice, teacher control, privacy, research, and maintainability.

This page records the decisions that materially affect the public experience. It is a readable companion to the detailed engineering records: it explains the choice, why it was made, and what follows from it. Decisions may be revised as classroom evidence and institutional requirements develop.

## May 2026: students join as groups

**Decision:** the classroom path uses a teacher-issued group code rather than asking every student to create a personal AIPLA account.

**Why:** physics work is often collaborative, shared devices are realistic in classrooms, and collecting identities would add friction and privacy obligations without being necessary for the learning activity.

**Consequence:** the group is the working unit. Teachers and researchers review authorised group sessions, not personal student profiles. Research use still depends on the applicable study information, consent, and governance.

## May 2026: tutor and workbench form one activity

**Decision:** conversation and an interactive workbench are designed as connected parts of a learning activity.

**Why:** a generic chatbot beside a silent simulation does not know what the students tested. Conversely, a simulation alone does not prompt prediction, comparison, or explanation.

**Consequence:** relevant workbench actions can be shared with the tutor in a structured way, and the interface shows students what was shared. The tutor can respond to actual activity state without pretending to see more than it has received.

## May 2026: interactive artefacts are isolated and reviewed

**Decision:** simulations and other HTML workbenches run through a versioned, isolated delivery path and are reviewed before use as maintained artefacts.

**Why:** interactive code may come from rapid prototyping or external contributors. Rendering successfully is not evidence that it is safe, pedagogically suitable, accessible, or scientifically correct.

**Consequence:** an artefact can evolve independently of an activity, but publication is a deliberate step. The same open bridge also allows selected artefacts to work in compatible external AI hosts.

## June 2026: teachers approve AI-proposed changes

**Decision:** teacher-facing co-pilots propose changes; the teacher explicitly applies them.

**Why:** activity design is a professional and pedagogical responsibility. AI can accelerate drafting and organisation without silently becoming the author or changing a live class configuration.

**Consequence:** proposed classes, activities, curriculum links, or edits remain visible and reversible until the teacher accepts them.

## June 2026: activities are reusable resources

**Decision:** activities can be previewed, reused across classes, shared, adopted, duplicated, and branched with provenance.

**Why:** a good learning design should not be trapped inside one class record, and adaptation should not erase where it came from.

**Consequence:** teachers can build on each other's work while retaining their own editable copy and a traceable relationship to the source.

## June 2026: authoring uses bounded building blocks

**Decision:** teachers compose activities from maintained elements such as checklists, tables, charts, calculators, notes, documents, solution fields, and reviewed simulations.

**Why:** bounded elements are easier to preview, test, review, make accessible, and interpret during a session than arbitrary generated interface code.

**Consequence:** AI-assisted authoring can arrange and configure known elements. New element types require product and technical work rather than appearing invisibly through a prompt.

## June–July 2026: research review is separate and summary-first

**Decision:** teacher and approved researcher views are distinct, and session review begins with summaries and structured activity evidence rather than only raw transcripts.

**Why:** teachers need a usable view of classroom activity, while cross-class research has different authorisation and analysis needs. Long chat logs alone are difficult to interpret and can hide how the workbench was used.

**Consequence:** role boundaries are enforced in the application, and summaries, workbench events, build versions, and source context can support review. A technical role never replaces study approval or data-governance requirements.

## July–August 2026: releases move through environments

**Decision:** application changes are built and tested before promotion through development, test, and production environments.

**Why:** research-facing software needs a reproducible account of what participants used, while classroom deployments need controlled changes and a recovery path.

**Consequence:** feature availability may differ between environments. Public capability descriptions identify what has shipped but do not imply that every feature has completed classroom evaluation.

## Hosting direction

**Decision:** use managed cloud services for the current phase while keeping replacement seams and institutional hosting requirements explicit.

**Why:** the project needs a reliable pilot platform now, but long-term operation, identity, storage, analytics, and model access must be reviewed with the University of Copenhagen.

**Consequence:** portability is a design goal rather than a promise of effortless migration. The current position is maintained on [Data, privacy, and hosting](/project/data-and-hosting).

## How this record will evolve

The team will add a dated entry when a decision changes the public platform, study experience, or long-term operating model. Routine implementation detail remains in the repository. Decisions that are still exploratory will be labelled provisional rather than written as settled facts.
