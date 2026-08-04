---
title: "Data, privacy, and hosting"
description: "The project's public data-protection principles, present hosting posture, and institutional transition direction."
eyebrow: "Responsible operation"
owner: "AIPLA project team"
reviewed: "2026-08-04"
reviewBy: "2026-09-04"
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

Teachers authenticate to manage classes, activities, materials, and the session information available to them. Research access is a distinct permission level intended for approved project work.

Technical access control is only one layer. Researchers must also follow the applicable study protocol, institutional approvals, retention rules, and participant information.

## Transparency within an activity

Students should be able to understand the role of the tutor and what information is being shared with it. When a workbench sends relevant state to the conversation, the interface provides a visible indication.

The system should not imply that an AI is a person, that its output is guaranteed correct, or that it has access to work it has not received.

## AI-generated and interactive content

AI-generated text, diagrams, and interactive artefacts can contain errors. Maintained artefacts are reviewed and versioned, and interactive HTML is delivered through an isolated origin with a bounded communication bridge.

Teacher review remains important even when an artefact has passed technical checks. Content safety, physical correctness, accessibility, and suitability for a particular class are separate questions.

## Present deployment posture

The application currently operates in separate development, test, and production environments hosted in Google Cloud in European regions. Promotion between environments is gated by automated tests and smoke checks.

Public project pages contain no student research data. Access-controlled application features and research data paths are governed separately.

The project is preparing the authoritative `aipla.ku.dk` domain. Until its DNS and managed certificates are fully active, environment-specific service addresses remain part of technical operation rather than the intended public identity.

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

The principles above describe the current project direction. Specific privacy notices, retention periods, institutional hosting decisions, and study procedures will be published or linked only after the relevant University of Copenhagen review.

For formal institutional information, consult the [official AIPLA project page](https://www.ind.ku.dk/projekter/artificial-intelligence-in-physics-learning-and-assessment-aipla/) and the privacy information supplied for the relevant activity or study.
