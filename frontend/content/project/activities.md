---
title: "Activities and examples"
description: "Detailed examples of paired tutors, simulations, virtual labs, and critical AI use."
eyebrow: "In the classroom"
owner: "AIPLA project team"
reviewed: "2026-08-04"
reviewBy: "2026-10-04"
status: "Current"
order: "40"
nav: "true"
---
# Activities and examples

AIPLA combines guided tutors with prepared learning material. The material may be a problem, document, simulation, experimental procedure, graph, data table, image, or concept map. The tutor can refer to what the student is doing rather than treating the conversation as an isolated chat.

## The paired tutor and workbench pattern

A central AIPLA pattern is to design the tutor and the interactive activity together. A tutor can ask about a particular graph, slider, piece of equipment, or stage in an experiment because those elements are part of its teaching context.

A typical sequence is:

1. **Predict** what will happen and explain why.
2. **Explore** by changing a parameter, inspecting evidence, or carrying out a procedure.
3. **Observe** the result in a graph, diagram, measurement, simulation, or document.
4. **Reflect** through questions from the tutor and discussion within the group.
5. **Summarise** the physics in the students' own words or representations.

This is not a fixed recipe for every lesson. Some activities need no simulation, while others may emphasise experimental decisions, conceptual dialogue, or critique of an AI-generated explanation.

## Three developed case studies

### Boldkast: projectile motion

Boldkast pairs a Danish Socratic tutor with a projectile-motion workbench. Students vary launch conditions, compare trajectories and representations, and work through a structured physics problem.

The activity established the platform's core feedback loop: student interaction with the workbench becomes visible context for the tutor, and the tutor can use that context in its next question.

[Read the Boldkast case study](/project/activities/boldkast).

### LED Planck: procedural virtual laboratory

LED Planck explores a different form of interaction. Students rehearse and interpret a simplified experiment involving an LED circuit, threshold voltage, wavelength, and an estimate of Planck's constant.

The case study helps distinguish what a virtual laboratory can support from what must remain grounded in real equipment, measurement uncertainty, and classroom laboratory practice.

[Read the LED Planck case study](/project/activities/led-planck).

### KineBot: migrating an existing teaching artefact

KineBot brings together kinematics simulations, graphs, conceptual prompts, and structured activities. Its migration into AIPLA established a reusable intake process for externally created teaching artefacts.

The original standalone prototype included its own browser-side AI integration. The maintained AIPLA version uses the platform's central services and reviewed interaction bridge; students do not enter API keys.

[Read the KineBot case study](/project/activities/kinebot).

## Different activity forms

The examples represent three useful classes:

| Form | Primary student action | Typical pedagogical role |
| --- | --- | --- |
| Phenomenon simulation | Vary parameters and compare outcomes | Prediction, model exploration, connecting representations |
| Procedural virtual lab | Follow, troubleshoot, and interpret a sequence | Experimental preparation and data reasoning |
| Hybrid workbench | Move between simulations, graphs, notes, documents, or questions | Coordinating several forms of physics knowledge |

Other AIPLA activities may use a conceptual dialogue, problem set, document, image submission, table, calculator, chart, checklist, or concept map without an embedded simulation.

## Learning from AI mistakes

AI-generated explanations and illustrations can be convincing while still being physically wrong. AIPLA treats some failures as possible teaching material.

For example, image generators often depict a dust particle in front of a loudspeaker travelling away along a transverse sine-wave path. The plausible picture encodes a misconception: sound in air is longitudinal, and a nearby particle oscillates around its position rather than riding a drawn wave away from the speaker.

A teacher can ask students to compare the plausible image with a physical account, identify what the representation gets wrong, and explain how particle motion differs from the graph used to represent a wave. The value lies in the critique, not in presenting incorrect output without guidance.

## What AIPLA adds to standalone artefacts

Compared with a standalone generated simulation or chatbot, the platform adds:

- a teacher-prepared learning context;
- a paired tutor that refers to the activity's actual representations;
- group-based student access without personal student accounts;
- central AI service configuration rather than browser-entered keys;
- reviewed and versioned interactive artefacts;
- visible sharing of relevant workbench interactions with the tutor;
- teacher review of activity use; and
- a path for approved research analysis.

## Trying an activity

The development environment contains activities for demonstration and teacher review. Students participating in a class should use the group code and instructions supplied by their teacher.

[Join a group](/group) or browse the [teacher and student guides](/guides).
