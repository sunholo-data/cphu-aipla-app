---
title: "KineBot: kinematics workbench"
description: "A case study in migrating an externally created, multi-part teaching artefact into AIPLA."
eyebrow: "Activity case study"
owner: "AIPLA project team"
reviewed: "2026-08-04"
reviewBy: "2026-11-04"
status: "Current"
order: "43"
nav: "false"
---
# KineBot: kinematics workbench

![Illustration for the KineBot kinematics activity](/lesson-images/kinebot-kinematics-tutor.svg)

KineBot is a broad kinematics teaching artefact that combines interactive simulations, motion graphs, conceptual prompts, reference material, and guided activity. It was originally developed outside AIPLA and then used to define a repeatable migration process for existing educational tools.

## Coverage

The artefact includes representations related to:

- one-dimensional motion;
- velocity and acceleration;
- free fall;
- projectile motion;
- vector components;
- position, velocity, and acceleration graphs; and
- relationships between equations and graphical motion descriptions.

Its breadth makes it different from a single-purpose activity such as Boldkast. That creates useful opportunities, but also makes teacher framing important: students need a clear task rather than an undirected collection of features.

## Why migrate an existing artefact

Teachers and collaborators will not always begin inside the AIPLA authoring interface. They may already have a simulation, HTML activity, document set, prompt, or prototype built with another tool.

Migration asks a consistent set of questions:

1. What is the intended learning activity?
2. Which parts are content, interaction, or AI behaviour?
3. What external services or browser permissions does the artefact use?
4. What information can it send to the tutor?
5. What information can the tutor send back?
6. How is the artefact reviewed, versioned, and sandboxed?
7. What changes are needed for group use, teacher control, and research review?

## Changes made for AIPLA

The original standalone form included browser-side AI integration and instructions for entering a service key. That pattern is not appropriate for student deployment.

The AIPLA form separates the interactive artefact from centrally managed tutor services. It uses the platform's reviewed bridge for communication, runs within the dedicated artefact origin, and can be selected as part of a teacher-prepared activity.

This means:

- students do not enter API credentials;
- the artefact has an explicit version;
- communication with the host application is bounded;
- teacher configuration determines how it is used; and
- the same artefact can be delivered through supported AIPLA surfaces.

## Pedagogical questions

KineBot raises questions about breadth and sequencing. A feature-rich environment may support comparison across representations, but it can also increase cognitive load or encourage superficial exploration.

Useful study questions include:

- Which representations do students choose when several are available?
- Can a tutor help students translate between a motion, graph, equation, and verbal account?
- How should a teacher constrain the environment for a particular lesson?
- Does an adaptive sequence respond to evidence of understanding or merely to completion?
- Which parts of the artefact are reusable across Danish and international curriculum contexts?

## A reusable intake pattern

The lasting contribution of this case study is the migration checklist, not a claim that every large standalone tool should be imported unchanged. Existing artefacts should be decomposed, reviewed, and situated within a specific activity before classroom use.
