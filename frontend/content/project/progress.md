---
title: "Build timeline"
description: "A dated public record of how AIPLA progressed from its first connected physics activity to a teacher-authoring, classroom, and research platform."
eyebrow: "Follow the build"
owner: "AIPLA project team"
reviewed: "2026-10-05"
reviewBy: "2026-11-05"
status: "Current"
order: "80"
nav: "true"
---
# Build timeline

AIPLA's current platform-development phase began in May 2026 and continues to at least April 2027. This timeline connects visible releases to the questions and decisions that shaped them. It records shipped capabilities, not every commit, and distinguishes delivery from research validation.

For the reasoning behind the platform's shape, read [Project decisions](/project/decisions). Detailed sprint plans and unresolved working notes remain in the repository until they are suitable for publication.

## 15–21 May 2026 — the first complete activity

**Shipped:** AIPLA's first end-to-end student path paired a Danish physics tutor with the Boldkast projectile-motion workbench. Students could join with a group code, use rendered equations and diagrams, manipulate the simulation, follow progress steps, and see which workbench actions were shared with the tutor. The layout adapted from a two-column desktop view to chat/workbench tabs on a phone.

**What it established:** the core product is an activity, not a chatbot: a learning goal, teacher-prepared context, tutor behaviour, and a connected workbench designed together.

**Decision:** student groups use anonymous join codes; tutors and workbenches exchange only visible, structured activity state.

## 22–30 May 2026 — from demonstration to a class platform

**Shipped:** teacher authentication, classes, activity selection and preview, early teacher dashboards, persistent group sessions, and two additional artefact forms: the LED Planck virtual laboratory and KineBot kinematics environment. Work also began on research-scale chat-log and session reporting pipelines.

**What changed:** Boldkast stopped being a special-case demonstration. Common simulation and workspace patterns could support several physics activities and screen sizes.

## 1–13 June 2026 — authoring, evidence, and multimodal work

**Shipped:** teacher activity creation, teaching personas and styles, curriculum-library grounding, student image upload, classroom audio capture and transcription paths, teacher analytics, researcher access, cost views, and summary-first session reports. Tutor turns could respond to meaningful simulation events, and voice/read-aloud options broadened how activities could be used.

**What changed:** teachers could begin configuring the learning experience rather than choosing only from fixed examples. Review also expanded beyond raw chat to include activity context and workbench evidence.

**Decision:** teacher and approved researcher access are separate; review begins with usable summaries while preserving traceable evidence where authorised.

## 14–21 June 2026 — documents and controlled assistance

**Shipped:** rich document workbenches, parsed PDF and uploaded-content views, narrative summaries combining available session evidence, and the first teacher co-pilot surfaces.

**What changed:** activities could be grounded in a teacher's own material and give students a document to inspect alongside the tutor.

**Decision:** teacher-facing AI proposes a change and the teacher applies it. It does not silently edit classes or activities.

## 22–30 June 2026 — reusable activity building blocks

**Shipped:** structured elements including tables, charts, calculators, notes, checklists, solution fields, and maintained simulations; activity templates and live preview; image-based solution submission; a reusable simulation catalogue; and a first-class activity library. Teachers could publish, adopt, duplicate, and branch activities with provenance. Research views expanded across classes, and artefacts became portable MCP Apps that can also run in compatible external hosts.

**What changed:** AIPLA became an authoring and sharing environment, not a catalogue of three hand-built lessons.

**Decision:** authoring uses bounded, reviewable elements, while reusable activities retain their origin when another teacher adapts them.

## July 2026 — shared sessions and living classroom tools

**Shipped:** live group-session synchronisation, presence and turn coordination; a common bridge for maintained interactive artefacts; deeper teacher views of group activity; raised-hand and live-class signals; living concept maps; richer curriculum organisation; English and Danish in-app guidance; researcher onboarding; and teacher/researcher evaluation lenses with versioned evidence. The maintained demonstration set also expanded to cover more activity and experiment patterns.

**What changed:** the platform moved closer to real classroom coordination. Several students could share one group session while a teacher followed activity across the class.

**Release milestone:** development, test, and production environments were cut separately, with automated checks and version stamps supporting controlled promotion.

## August 2026 — operational readiness and the project site

**Shipped to the active development line:** a dedicated Materials area, clearer environment labelling, authentication and role hardening, automated release-promotion improvements, infrastructure backup and access controls, and custom-domain/load-balancer preparation for University of Copenhagen hosting. The public project documentation moved into the application repository so product, research, and website changes can be reviewed together.

**Release milestone:** the teacher pilot began in mid-August on the production environment.

**What changed:** the work became easier to operate, hand over, and explain as one maintained system. This in-app site now includes a live Boldkast workbench, an updated platform diagram, this timeline, and a public decision record.

## September 2026 — tutors that carry their teaching approach

**Shipped:** the public project pages moved into the application and are served at the authoritative `aipla.ku.dk` domain, with editorial metadata and review deadlines enforced automatically. Administrative roles were separated from teaching roles, and a programme-level daily usage limit was added that warns before it restricts.

The largest change was to the tutor itself. A tutor now carries a named teaching approach — seven are published, each drafted from its research source and readable at [Teaching frameworks](/project/tutors) — and a teacher chooses one tutor per class. Researchers can edit an approach and compare tutors side by side; free-text tutor instructions and the separate "teaching style" setting were retired so that every tutor's behaviour can be checked against the approach it claims to follow. Later in the month teachers could make their own tutors, write their own approaches, give a tutor a face and a voice, and keep it private or share it. Session reports now judge how closely a tutor stayed with its approach, and every tutor turn records which tutor and approach produced it.

Alongside this: concept maps became on by default, with a class view that shows where groups differ rather than an average; researchers can read each group's work beside its conversation; teachers can try an activity as a student without making a join code, revoke a leaked join code, and keep a class list of names that never leaves their own device; the how-to guides became pages in the application; and the simulation library grew to include heating, wave, Sun–Earth–Moon and a first mathematics simulation. Student and teacher screens were translated so that each speaks Danish or English: students' screens, tutor and voice follow the activity's language unless the student chooses otherwise, and teachers and researchers pick their own language.

**Programme milestone:** 15 September was the contracted mid-programme checkpoint, not an end point. The platform engagement has been extended to at least April 2027. A second developer, AD, joined at the start of October and works alongside the existing team rather than taking over from it.

**What changed:** the project's public explanation and its software are now one maintained artefact, reviewed and deployed together. The project's former website stays reachable until its redirects are enabled.

## October 2026 — tutors that can act on a simulation

**Shipped:** on a simulation that declares which actions a tutor may take — so far the Sun–Earth–Moon simulation — the tutor can change what the student sees, for example jumping to the next eclipse or changing the viewpoint. The student sees a card each time naming what the tutor changed. How much a tutor may change comes from its teaching approach, and by default it can change only the view, which the student can change straight back. On simulations with a defined assessment scale, the tutor's judgement of a student's understanding is recorded for researchers as structured evidence and is never shown to the student.

Teacher reports gained a panel showing each group's final work. Tables, charts and the calculator accept a Danish decimal comma. Model requests now run on Google's EU endpoint rather than a global one, and a failed model request is retried, or handed to a second model, before the student has seen any answer. The project pages link to the University of Copenhagen's official AIPLA pages in Danish and English.

**What changed:** the connection between tutor and workbench now works in both directions, which is the property that most separates a paired activity from a general-purpose chatbot.

## Current capability snapshot

As of this page's review date, the active platform line includes:

- anonymous group-based student access and shared group sessions;
- teacher-created classes, materials, activities, templates, and preview;
- tutors that each carry a published or teacher-written teaching approach, persona and voice, grounded in selected teaching material;
- simulations, documents, images, concept maps, and structured workbench elements, with tutor actions on simulations that support them;
- Danish and English student and teacher screens;
- teacher co-pilots using explicit propose-and-apply actions;
- activity sharing, adoption, duplication, and branching with provenance;
- live-class and session-review views;
- approved cross-class research and evaluation views; and
- separate development, test, and production release paths.

Availability can differ by environment, role, activity configuration, and study phase. “Shipped” means implemented on the active application line; it is not a claim of pedagogical effectiveness or completed classroom evaluation.

## Next checkpoints

The next public updates will follow evidence and operating milestones rather than speculative feature dates:

- a teacher review of the platform later in the autumn;
- teacher workshops and classroom use, with broader student trials depending on the necessary data-processing agreements;
- changes made in response to teacher and student experience;
- dated, reproducible evaluation snapshots;
- privacy, consent, and institutional-hosting decisions for each study phase;
- reusable teacher resources and maintained example activities; and
- the extension's focus on the physics-specific layer: activity authoring, simulations, curriculum grounding on cleared material, and rubric-scored session evidence for assessment research.

The old site's detailed 17-week contract plan is preserved in its source history; the contract it described has since been extended. It is not presented as the current roadmap because tentative dates, named handover assignments, and internal backlog do not all describe the platform as it exists now.

Formal project facts remain on the [University of Copenhagen AIPLA page](https://www.ind.ku.dk/english/projects/artificial-intelligence-in-physics-learning-and-assessment-aipla/).
