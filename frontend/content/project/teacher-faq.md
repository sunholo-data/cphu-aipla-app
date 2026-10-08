---
title: "Teacher questions"
description: "Short answers to the questions teachers asked at the October 2026 seminar, each pointing to the page it comes from — with the open questions marked as open."
eyebrow: "For teachers"
owner: "AIPLA project team"
reviewed: "2026-10-08"
reviewBy: "2026-11-08"
status: "Provisional"
order: "90"
nav: "false"
---
# Teacher questions

These are the questions teachers asked at the AIPLA seminar on 5 October 2026. Each answer is taken from a page that already exists, and links to it.

Four questions do not have an answer yet: copyright for uploaded documents, rights in the work teachers upload, data protection for student group codes, and the rollout schedule. They are marked **Awaiting an answer**, with the facts already on record listed underneath. Those answers will come from the project lead and the University of Copenhagen, not from this page.

A Danish version of this page is at [Spørgsmål fra lærere](/project/teacher-faq.da).

## Building activities

### How easy is it to add activities?

An activity is set up in the browser, with no code and no developer. The guide puts a first activity at about five minutes. You give it a name and a teaching goal (the instruction the tutor follows), pick the students' language, and optionally add a workspace: a simulation, checklist, table, chart, calculator or notes. A live preview shows what students will see, and **Try as student** opens the real student view.

There are three shortcuts:

- **Start from a template** at the top of the builder.
- **Adopt from the library** copies a colleague's shared activity into your class in one click.
- The AI **co-pilot** drafts the goal and workspace from a plain description. You review its proposal and apply it yourself.

Sources: [T2 — Create your first activity](/guides/t2-create-your-first-activity), [T4 — Author with the AI co-pilot](/guides/t4-author-with-the-copilot), [Project decisions](/project/decisions#june-2026-teachers-approve-ai-proposed-changes).

### Can we upload documents for the tutor to use?

Yes. In an activity's **Materials** section, or under **Materials** in the teacher menu, you can upload a PDF, Word file, slides, a spreadsheet, plain text or an image. AIPLA shows you the text it extracted, so you can check it was read correctly. You can also cite documents from the shared library.

For each document you choose:

- **Visible / Hidden.** A hidden document only grounds the tutor's answers, while a visible one is also shown to students. **New documents start hidden.**
- **Reference / In context.** With Reference, the tutor looks the document up when it is relevant. With In context, it gets the full text on every turn.

Your own uploads stay in your own library. Only researchers can add a document to the shared library.

Source: [T3 — Add and organise curriculum materials](/guides/t3-add-curriculum-materials).

### Can we create our own simulations?

Yes, without writing code, but not directly in the activity builder. A teacher or physics staff member drafts the simulation in any AI chat (Claude, ChatGPT, Gemini, Copilot) using AIPLA's authoring prompt, tries it in a browser, and sends the two files it produces to the project team. The team wires it to the tutor and runs the security, size and phone-width checks. A physics reviewer signs off the physics before it ships. After that it is in the library, and any teacher can attach it to an activity.

The question that matters most when proposing one is: *what does the student measure, and what do they work out from it?*

Sources: [Build a simulation with an AI chat](/project/build-a-simulation), [T2 — Create your first activity](/guides/t2-create-your-first-activity).

### What simulations are there, and what do they do?

Nine are live: Boldkast, LED Planck, KineBot, Elkedel, Faseovergange, Bølgefart, Interferens, Sol, Jord og Måne, and Sekantbænk. Each opens beside the tutor. The student changes something, reads the instruments and captures readings, and the tutor sees those readings and can ask about them. A simulation never shows the value the student is meant to work out.

On Sol, Jord og Måne, the tutor can also change what the student sees, for example by jumping to the next eclipse. A card in the chat names every change it makes. The other simulations are watched by the tutor but not changed by it.

Limits worth knowing: a simulation reopens at its defaults on another day, so readings that must persist belong in an activity table. A simulation also cannot reach the internet.

Sources: [Build a simulation with an AI chat](/project/build-a-simulation), [Activities and examples](/project/activities), [Build timeline](/project/progress#october-2026-tutors-that-can-act-on-a-simulation).

### Can we use it for other subjects?

AIPLA is a physics research project, and everything published so far is about physics. Some facts on record:

- The first mathematics simulation, Sekantbænk, is in the library.
- Documents in the materials library can be filed by subject.
- The model evaluation covers one subject (physics exam tasks) and says other tasks would need their own measurements.

**Not yet answered:** none of the existing pages says whether teachers of other subjects can take part in the pilot. That needs a decision from the project.

Sources: [About AIPLA](/project/about), [Build a simulation with an AI chat](/project/build-a-simulation), [T3 — Add and organise curriculum materials](/guides/t3-add-curriculum-materials), [Capability floor](/project/evaluation/capability-floor).

## Language and models

### Does it work in English and Danish?

Yes, for the screens:

- Student and teacher screens are available in both Danish and English.
- Each activity has a **Students' language**, which sets the language students see and the language the tutor replies in. A student can still switch DA | EN for themselves.
- Teachers and researchers choose their own language with the DA | EN switch.
- The how-to guides exist in both languages.

These project pages are in English, and they link to the University of Copenhagen's official AIPLA pages in Danish and English.

Sources: [Build timeline](/project/progress#september-2026-tutors-that-carry-their-teaching-approach), [T2 — Create your first activity](/guides/t2-create-your-first-activity), [Platform](/project/platform).

### Could local models help with copyright?

Here is what is on record about where the AI runs:

- **Today** the tutor uses Google's Gemini models through Vertex AI, and requests go to the EU endpoint. Under Google Cloud's terms, Google may not use the data to train its models.
- **Local models are not in use.** The platform is designed so that model inference could be moved. The October 2026 evaluation found that two open models that fit on a single GPU (Qwen 3.8 27B and Gemma 4 31B) reach the accuracy threshold. They were measured through a hosting service, not on the project's own hardware. The next step is to measure one of them on the hardware that would serve it.
- **Moving the model alone does not move everything.** The privacy notice lists document conversion and curriculum search as separate services, and so does the hosting page. Moving inference does not by itself change where uploads are stored or processed.

**Not yet answered:** whether running models locally changes the copyright position for uploaded material. That belongs with the copyright question below.

Sources: [Data, privacy, and hosting](/project/data-and-hosting), [Capability floor](/project/evaluation/capability-floor), [Privacy notice](/privacy).

## Awaiting an answer

### Copyright: may we upload published material?

**Awaiting an answer from the project lead and UCPH.**

Facts on record:

- Teachers can upload PDFs, Word files, slides, spreadsheets, plain text and images. ([T3](/guides/t3-add-curriculum-materials))
- Every document in the materials library records a rights status (`copyrightStatus`): `teacher_owned`, `cleared` or `pending`. A teacher's own upload is recorded as `teacher_owned`. Only a researcher can add a document to the shared library, and only one marked `cleared`. (Product behaviour.)
- Newly cited documents start **Hidden**: they ground the tutor's answers without being shown to students. ([T3](/guides/t3-add-curriculum-materials))
- An upload is converted to text by AILANG Parse, operated by Sunholo, in Belgium. The text is stored and indexed for curriculum search in Belgium, and files and uploads are stored in Finland. ([Privacy notice](/privacy))
- AIPLA also stores an AI-written summary of each uploaded document, which the co-pilot uses to judge relevance. (Product behaviour.)
- Google may not use the data to train its models. ([Privacy notice](/privacy))
- A teacher can delete a document from their library. ([T3](/guides/t3-add-curriculum-materials))
- The extension's stated focus is "curriculum grounding on **cleared** material". ([Workstreams](/project/workstreams))
- The only rights position published so far covers the exam items used in the model evaluation, under the research exception in section 11 c of the Danish Copyright Act. ([Evaluation](/project/evaluation), [Capability floor](/project/evaluation/capability-floor))

### Who has rights in the work teachers upload and create?

**Awaiting an answer from the project lead and UCPH.**

Facts on record:

- A teacher's uploads stay in their own library unless a researcher adds them to the shared library. ([T3](/guides/t3-add-curriculum-materials))
- Activities can be shared, adopted, duplicated and branched, with provenance kept. A teacher who adopts one gets their own editable copy. ([Project decisions](/project/decisions#june-2026-activities-are-reusable-resources))
- Teachers can make their own tutors and teaching approaches and keep them private or share them. ([Workstreams](/project/workstreams))
- A simulation drafted by staff is sent to the project team, reworked, and then added to the library for any teacher to attach. ([Build a simulation with an AI chat](/project/build-a-simulation))
- Classes, activities and student work are kept until the teacher deletes them or the project ends. ([Privacy notice](/privacy))
- The terms-of-use page is still the v0.1 draft placeholder and says nothing about ownership. ([Terms](/terms))

### GDPR: what about the student group IDs?

**Awaiting an answer from the project lead and UCPH.**

Facts on record:

- Students join with a group code issued by the teacher and have no personal AIPLA account. Teachers and researchers review group sessions, not personal student profiles. ([Project decisions](/project/decisions#may-2026-students-join-as-groups))
- The privacy notice says students are anonymous, sign in in groups of at least three, and that no names, emails or other identifiers are collected. ([Privacy notice](/privacy))
- AIPLA stores what the group writes, the tutor's replies, and what the group does in the workspace. This is used in the research project. ([Privacy notice](/privacy))
- Students are told, in the notice and in their chat, not to write names or CPR numbers, and not to upload documents or pictures showing names, CPR numbers or themselves. ([Privacy notice](/privacy))
- Speech to the tutor is turned into text and not kept as audio. A whole lesson is recorded only if the teacher turns that on, and only with signed consent forms. ([Privacy notice](/privacy))
- Where data is held: the application, database, files, uploads, logs and the research log are in Finland. Conversation history and curriculum search are in Belgium. The AI models run in Google's EU multi-region. Teacher sign-in uses Google's global service. ([Privacy notice](/privacy))
- How long data is kept: technical logs for 30 days and the research chat log for 365 days. Classes, activities and student work are kept until the teacher deletes them or the project ends. ([Privacy notice](/privacy))
- The University of Copenhagen is the data controller. Google Cloud and Sunholo are processors. ([Privacy notice](/privacy))
- A group code grants technical access to an activity. It is not research consent on its own. ([Data, privacy, and hosting](/project/data-and-hosting#consent-and-research-participation))
- Teachers can keep a class list of names that never leaves their own device. ([Build timeline](/project/progress#september-2026-tutors-that-carry-their-teaching-approach))
- The privacy notice is itself marked as a draft, awaiting review by the University of Copenhagen's legal office and data protection officer. ([Privacy notice](/privacy))

### When will it be rolled out?

**Awaiting an answer from the project lead and UCPH.**

Facts on record:

- The research project runs from 2026 to 2028. ([About AIPLA](/project/about))
- The teacher pilot began in mid-August 2026 on the production environment. ([Build timeline](/project/progress#august-2026-operational-readiness-and-the-project-site))
- The platform work has been extended to at least April 2027. ([Build timeline](/project/progress))
- The next published checkpoints have no dates. They are a teacher review of the platform later in the autumn, then teacher workshops and classroom use, with broader student trials depending on the necessary data-processing agreements. ([Build timeline](/project/progress#next-checkpoints))
- Privacy, consent and institutional-hosting decisions are made for each study phase. ([Build timeline](/project/progress#next-checkpoints), [Data, privacy, and hosting](/project/data-and-hosting))
