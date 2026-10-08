---
title: "Teacher questions"
description: "Short answers to the questions teachers have asked about AIPLA so far: building activities, documents, group codes, language, tutors, data and rights."
eyebrow: "For teachers"
owner: "AIPLA project team"
reviewed: "2026-10-08"
reviewBy: "2026-11-08"
status: "Provisional"
order: "90"
nav: "true"
---
# Teacher questions

These are the questions teachers asked during the pilot, most of them at the seminar on 5 October 2026. Each answer describes what the platform does today and links to the guide or page with the detail.

This page is provisional. The answers on copyright, rights, data protection and rollout describe what the platform does. They are not the university's legal assessment.

A Danish version of this page is at [Spørgsmål fra lærere](/project/teacher-faq.da).

## Building activities

### How easy is it to add activities?

Easy, and no code is needed. The guide puts a first activity at about five minutes. You give it a name and a teaching goal (the instruction the tutor follows), pick the students' language, and can add a workspace: a simulation, checklist, table, chart, calculator or writing area. **Try as student** opens the real student view.

To go faster, start from a template, adopt a colleague's shared activity from the library (you get your own editable copy), or describe the activity in words and let the AI co-pilot draft it. You review the co-pilot's proposal and apply it yourself.

More: [T2 — Create your first activity](/guides/t2-create-your-first-activity), [T4 — Author with the AI co-pilot](/guides/t4-author-with-the-copilot).

### Can we upload documents for the tutor to use?

Yes. Under **Materials** you can upload a PDF, Word file, slides, a spreadsheet, plain text or an image, or cite a document from the shared library. AIPLA shows you the text it extracted, so you can check it was read correctly.

For each document in an activity you choose two things:

- **Students can open it / Tutor only.** New documents start as **Tutor only**: the tutor uses them, but students cannot open them.
- **Reference / In context.** With Reference, the tutor looks the document up when it is relevant. With In context, it has the full text on every turn. Use In context for the task the students are working on.

More: [T3 — Add and organise curriculum materials](/guides/t3-add-curriculum-materials).

### Why can't my students open a document?

Because it has not been shared with them. Documents are **Tutor only** until you click the toggle on the document's row in the activity's materials, so that it reads **Students can open it**. Students see the names of the documents they cannot open, with a note saying the teacher has not shared the content.

Once a document is shared, the first one is already open when students start the activity. The order is the order you added them in, and the builder marks that document **Opens first for students**. If you share several, students switch between them with tabs. When the tutor mentions a shared document, it links to it, and one click opens it. It never links to a document you have not shared.

### What if a document upload fails?

You will see it. Each document says **Ready — the tutor can read it**, **Processing…** or **Failed — the tutor cannot read it**. AIPLA retries a failed document automatically, and you can press **Try again** yourself. An activity whose document has failed shows a warning on its card and in the class view, so you find out before the lesson. If retrying does not help, upload the file again under Materials.

### Can we create our own simulations?

Yes, without writing code, but not inside the activity builder. You draft the simulation in any AI chat (Claude, ChatGPT, Gemini, Copilot) using AIPLA's authoring prompt, try it in a browser, and send the two files it produces to the project team. The team connects it to the tutor and runs the security, size and phone-width checks, and a physics reviewer signs off the physics. After that it is in the library, and any teacher can add it to an activity.

The question that matters most when you propose one: *what does the student measure, and what do they work out from it?*

More: [Build a simulation with an AI chat](/project/build-a-simulation).

### What simulations are there?

Nine: Boldkast, LED Planck, KineBot, Elkedel, Faseovergange, Bølgefart, Interferens, Sol, Jord og Måne, and Sekantbænk. Each opens beside the tutor. The student changes something, reads the instruments and records readings, and the tutor sees those readings and can ask about them. A simulation never shows the value the student is meant to work out.

In Sol, Jord og Måne the tutor can also change what the student sees, and a card in the chat names every change. A simulation reopens at its defaults on another day, so readings that must be kept belong in a table in the activity.

More: [Activities and examples](/project/activities).

### Does the tutor send students to the simulation and the workspace?

It is told to. The tutor is given a list of what is in the activity's workspace and an instruction to point students to it when it would help. If several replies go by without it doing so, it is reminded. Its opening message names the simulation first, if there is one. This was changed after the October seminar, where the tutor stayed in conversation. Whether it now refers students often enough is being measured.

## Group codes and students

### How do group codes work, and can several students share one?

A group code is a short code (two words and a number) that lets students join your class without an account. You make as many as you need on the class page, and give students the **join link**, because a code works only on the site it was made on. Codes are meant for groups: the privacy notice describes groups of at least three. There is no separate mode where each student gets their own conversation.

When several devices use the same code in the same activity, they share **one conversation**:

- Every device shows the whole conversation. A message from a groupmate's device is labelled **Sent from another device in your group**, and students see how many of their group are present.
- One message reaches the tutor at a time. If two students send at once, the second message waits and is sent automatically.
- The tutor reads every message from every device, and it is told that the conversation is shared.

Each activity has its own conversation. A group that moves to another activity starts a new one.

More: [T1 — Set up a class and share it](/guides/t1-set-up-a-class), [S1 — Join and use your tutor](/guides/s1-join-and-use-your-tutor).

### A student's code does not work. What now?

Check that the student used the join link for the right site. If a student mistypes a word in the code, AIPLA may suggest the right code (**Did you mean …?**). It never guesses the numbers. A code that has expired or been revoked gets the same message as an unknown one, and the student needs a new code from you.

### What happens to the work if I revoke a code?

Revoking stops the code working: students using it are signed out at their next message, and the code can never be issued again. **The group's work is kept.** Revoked codes move to a **Revoked codes** list on the class page, where their reports stay open to you and to the research team. Revoking deletes nothing.

Deleting a whole class is different: its activities and reports are no longer available to you. That is not the same as erasing the data. To have data erased, contact the project (see the [privacy notice](/privacy)).

### Can students restart the conversation, or keep what the tutor said?

Only you can restart a group's conversation, with **Reset session** on the class page. If a student asks the tutor for a restart, the tutor says that it is the teacher's decision. It offers to summarise what the group has worked out instead.

Under each tutor reply there is a **Save as notes** button. It adds the reply at the end of the activity's writing area, under the heading "Notes from the tutor", and leaves the student's own text unchanged. If the activity has no writing area, the reply is copied so the student can paste it somewhere else.

The tutor also does not know the class's rules or schedule. If students ask about breaks, leaving or grades, it tells them that the teacher decides.

## Language

### Does it work in English and Danish?

Yes:

- Every activity has a **students' language**, which sets the language students see and the language the tutor replies in. The activity card shows it (**Students: Danish** or **Students: English**), and the builder warns you if, for example, a Danish title sits on an English activity.
- A student can choose DA or EN at the top of the page. Their choice applies to the buttons, the tutor and the read-aloud voice.
- Teachers and researchers choose their own language with the DA | EN switch.
- The how-to guides are in both languages. These project pages are in English.

More: [T2 — Create your first activity](/guides/t2-create-your-first-activity), [S1 — Join and use your tutor](/guides/s1-join-and-use-your-tutor).

## Tutors and assessment

### Who can see the tutors and teaching approaches I make?

Any teacher can write a teaching approach and build a tutor on it. **Private** means hidden from other teachers but visible to the research team. Researchers see who made each tutor and approach, including the author's email, and they can edit them. **Shared** makes it available to other teachers.

More: [T1 — Set up a class and share it](/guides/t1-set-up-a-class), [Teaching frameworks](/project/tutors).

### What does the assessment of a session judge?

It judges **the tutor, not the students**. An AI judge reads a session and asks how far the tutor's moves followed the tutor's teaching approach. Students' messages are context and are not scored.

- **Teachers** see a **Teaching approach** section in a group's report. It describes how the tutor used the approach and where it drifted. It gives no bands or grades.
- **Researchers** see, for each part of the approach, a band (absent, partial or strong), the rules behind the bands, and the turns the judgement rests on, with quotes. They can record a correction beside the AI's judgement, which is kept.

More: [Teaching frameworks](/project/tutors) describes the approaches the judge reads.

## Models, data and rights

### Could local models help with copyright?

Local models are not in use today. The tutor uses Google's Gemini models through Vertex AI in Google's EU region, and Google may not use the data to train its models. The October 2026 evaluation found two open models that would fit on a single GPU and reach the accuracy threshold, but they have not yet been measured on hardware the project would run them on. Moving the model alone would not move everything: document conversion and curriculum search are separate services. On copyright itself, see the next question.

More: [Data, privacy, and hosting](/project/data-and-hosting), [Capability floor](/project/evaluation/capability-floor).

### Copyright: may we upload published material?

There is no published project position yet on which published material may be uploaded. Here is what the platform does with an upload today:

- It is stored in **your own library**. Other teachers cannot see it. The research team can.
- It starts as **Tutor only**. Students can open it only if you share it in an activity.
- The **shared library** holds only material the research team has marked as cleared. Teachers cannot add to it.
- To make it readable for the tutor, the file is converted to text by AILANG Parse (operated by Sunholo) in Belgium. The text is stored and indexed for search in Belgium, and the file itself is stored in Finland. AIPLA also keeps an AI-written summary of each document.
- Google may not use it to train its models.
- You can delete a document from your library with the bin icon.

If you are unsure about a document, ask the project before uploading it.

The university's formal assessment is in progress; contact the project if in doubt.

### Who has rights in what teachers upload and create?

No published AIPLA document sets out ownership or licence terms for teachers' material yet. What the platform does today:

- Activities, tutors, approaches and uploads are **private to you** until you share them. The research team can see private tutors and approaches.
- When you share an activity, other teachers can adopt it. They get their own editable copy, and AIPLA records which activity it came from.
- A simulation you send to the project team is reworked by the team and then offered to every teacher.
- Classes, activities and student work are kept until you delete them or the project ends.

The university's formal assessment is in progress; contact the project if in doubt.

### GDPR: what about the student group codes?

A group code is a key to your class's activities, not an identity. It is not linked to a name, email or device, and students have no AIPLA account. It is also not consent to take part in research. Anyone who has the code can join, so revoke it if it leaks.

What the platform does today:

- **What is stored:** what the group writes, the tutor's replies, and what the group does in the workspace. It is used in the research project. Speech to the tutor becomes text and is not kept as audio. Whole lessons are recorded only if you turn that on, and only with signed consent forms.
- **No names:** students are told, in the privacy notice and in their chat, not to write names or CPR numbers and not to upload pictures of themselves. If you keep a class list of who is behind each code, it stays in your browser and AIPLA never receives it.
- **Who sees a group's sessions:** you, as the class's teacher, and the research team.
- **Where:** in the EU. The application, database, files and research log are in Finland, conversation history and curriculum search are in Belgium, and the AI models run in Google's EU region. Only teacher sign-in uses Google's global service.
- **How long:** technical logs 30 days, and the research log of chats 365 days. Classes, activities and student work are kept until you delete them or the project ends.
- **Who is responsible:** the University of Copenhagen is the data controller, and Google Cloud and Sunholo are processors.

The privacy notice is a draft awaiting review by the university's legal office and data protection officer.

The university's formal assessment is in progress; contact the project if in doubt.

More: [Privacy notice](/privacy), [Data, privacy, and hosting](/project/data-and-hosting).

### When will it be rolled out?

The published timeline is:

- the research project runs from 2026 to 2028;
- the teacher pilot started in mid-August 2026;
- the platform work continues to at least April 2027.

The next checkpoints are published without dates. They are a teacher review of the platform later this autumn, then teacher workshops and classroom use. Broader student trials depend on the necessary data-processing agreements, and privacy, consent and hosting are decided for each study phase.

The university's formal assessment is in progress; contact the project if in doubt.

More: [Build timeline](/project/progress#next-checkpoints).

### Can we use it for other subjects?

AIPLA is a physics research project, and the tutors, simulations and evaluation are built for physics. The first mathematics simulation, Sekantbænk, is in the library, and documents can be filed by subject. Whether teachers of other subjects can join the pilot has not been decided. Ask the project.

More: [About AIPLA](/project/about).
