---
title: "Data, privacy, and hosting"
description: "The project's public data-protection principles, present hosting posture, and institutional transition direction."
eyebrow: "Responsible operation"
owner: "AIPLA project team"
reviewed: "2026-11-09"
reviewBy: "2026-12-09"
status: "Provisional"
order: "70"
nav: "true"
---
# Data, privacy, and hosting

Data protection and institutional operation are part of the research design, not a final technical check added after an activity has been built.

This page explains the public principles and current direction. It does not replace participant information, consent material, data-processing agreements, the University of Copenhagen's policies, or the documentation for a specific study.

## Data minimisation

The student activity path uses group-based access rather than requiring individual student accounts. The project aims to collect only the material needed for the teaching activity, operation of the service, or an approved research purpose.

Different material has different sensitivity. A parameter changed in a simulation is not equivalent to a photograph of student work, an audio recording, or an inferred account of student understanding. Features therefore require purpose-specific review rather than one blanket approval.

## Teacher and researcher access

Teachers authenticate to manage classes, activities, materials, and the session information available to them. Research access is a distinct permission level intended for approved project work. A small number of administrative roles exist for operating the service itself — granting access and setting programme-level usage limits — and are held by named project staff rather than being a general capability.

Technical access control is only one layer. Researchers must also follow the applicable study protocol, institutional approvals, retention rules, and participant information.

## Transparency within an activity

Students should be able to understand the role of the tutor and what information is being shared with it. When a workbench sends relevant state to the conversation, the interface provides a visible indication. When the tutor changes a simulation, a note in the conversation says what it changed. Students are told, in the conversation and in the privacy notice, not to write names or identity numbers and not to upload pictures showing themselves, and teachers are shown a privacy notice they acknowledge before they first use the platform.

The system should not imply that an AI is a person, that its output is guaranteed correct, or that it has access to work it has not received.

## AI-generated and interactive content

AI-generated text, diagrams, and interactive artefacts can contain errors. Maintained artefacts are reviewed and versioned, and interactive HTML is delivered through an isolated origin with a bounded communication bridge. The tutor's diagrams are rendered and checked before a student sees them, with the geometry of mechanics diagrams computed from the physics, and when the tutor shows a calculation the number is worked out by the platform rather than by the model. Neither makes the tutor's explanation correct.

Teachers who have been given access can build simulations in the application. Every version is checked automatically and runs with no network access; the teacher who publishes it to their own classes is its reviewer for those classes. A teacher-built simulation reaches other teachers only after a researcher has signed off its physics.

Teacher review remains important even when an artefact has passed technical checks. Content safety, physical correctness, accessibility, and suitability for a particular class are separate questions.

## Present deployment posture

The application currently operates in separate development, test, and production environments hosted in Google Cloud in European regions. Promotion between environments is gated by automated tests and smoke checks.

The tutor currently uses Google's Gemini models through Vertex AI. Since October 2026 model requests are sent to Vertex AI's EU multi-region endpoint, so inference is served within the EU rather than from a global endpoint that may route a request to any region. Since the same month, application logs are kept in an EU region, read-aloud speech is generated at Google's EU endpoint, and conversation text is not written into performance traces. Teacher sign-in is the one part that uses a Google service run globally.

Public project pages contain no student research data. Access-controlled application features and research data paths are governed separately.

These public pages are served at the authoritative `aipla.ku.dk` domain, which is now the project's public identity. Environment-specific service addresses remain part of technical operation rather than something to cite or share. The project's former website stays reachable until its redirects are enabled, so older external links may still resolve to the previous address.

## Institutional hosting direction

The platform has been designed so that major services can be replaced or moved as institutional requirements and capability evolve. Areas considered in a transition include:

- teacher identity and University of Copenhagen sign-in;
- model inference and multimodal processing;
- document retrieval and curriculum material;
- research analytics and approved interaction records;
- file and artefact storage;
- operational logging and tracing; and
- deployment, monitoring, and incident response.

The appropriate target may differ by data type and task. Moving model inference does not automatically resolve identity, analytics, storage, or operational responsibilities.

The model provider for the tutor and, since October 2026, for the platform's other text tasks is set in configuration, task by task, so it can be changed without rewriting the application. A connection to UCloud AI, model inference on the Danish national research platform UCloud, run by the University of Southern Denmark, has been built this way. It is not in use in any environment.

## Conditions for a hosting transition

A responsible transition requires:

1. confirmed institutional services, ownership, and support arrangements;
2. capability evidence for the physics tasks the service must handle;
3. a reviewed data-flow and security model;
4. migration and rollback procedures;
5. end-to-end testing with the same activity configurations;
6. clear responsibility for ongoing operation; and
7. updated participant and teacher information where the change affects data use.

Detailed component mappings, credentials, infrastructure identifiers, and operational commands remain in internal engineering documentation.

## Consent and research participation

Participation in an AIPLA research study is governed by the information and consent process for that study. A group code grants technical access to an activity; it is not by itself research consent.

Features involving audio, images, uploaded documents, or longitudinal models of student understanding require particular attention because they can contain or produce more sensitive information.

## Current status of this page

The principles above describe the current project direction. The application's [privacy notice](/privacy), which lists where data is stored and how long it is kept, is a draft awaiting review by the University of Copenhagen's legal office and data protection officer. Institutional hosting decisions and study procedures will be published or linked only after the relevant University of Copenhagen review.

For formal institutional information, consult the [official AIPLA project page](https://www.ind.ku.dk/english/projects/artificial-intelligence-in-physics-learning-and-assessment-aipla/) and the privacy information supplied for the relevant activity or study.
