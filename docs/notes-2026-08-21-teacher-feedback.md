# Teacher feedback — meeting of 21 August 2026

Feedback from the pilot teachers at the 21 August 2026 session, together with the
points JB put to them in the same meeting. SCP gathered it into a spreadsheet, one row
per point, with each teacher's original Danish wording kept alongside an English
rendering. Reformatted here so it is readable, quotable and diffable in the repo — this
is a faithful re-presentation of that spreadsheet, not a triage of it.

| | |
|---|---|
| Source | `docs/Feedback meeting 21-8-2026.xlsx` |
| Compiled by | SCP |
| Parsed with | `docparse` (AILANG Parse v0.34.0) — deterministic XLSX extraction, no AI pass |
| Rendered by | `scripts/render-feedback-xlsx.py`, straight from the parser JSON, so every quote is verbatim |
| Items | 28, numbered 1–28 in the spreadsheet's own order |

Names appear as initials, per the repo convention.

## At a glance

| Theme | Problems | Feature requests | Questions / other | Total |
|---|---:|---:|---:|---:|
| User Interface & Functionality | 7 | 8 | 0 | 15 |
| Academic Content | 2 | 1 | 0 | 3 |
| Evaluation & Teacher Overview | 0 | 2 | 1 | 3 |
| Project & Implementation | 0 | 0 | 2 | 2 |
| Collaboration & Organization | 1 | 2 | 1 | 4 |
| Pedagogical discussion | 0 | 0 | 1 | 1 |
| **All** | **10** | **13** | **5** | **28** |

## Index

**User Interface & Functionality**

1. [Unclear if tutor uses uploaded assignment files; asks for re-upload or misinterprets the prompt](#1-unclear-if-tutor-uses-uploaded-assignment-files-asks-for-re-upload-or-misinterprets-the-prompt) — `Problem` · Files & Upload
2. [AI tutor does not respond correctly to screenshot uploads and replies off-topic](#2-ai-tutor-does-not-respond-correctly-to-screenshot-uploads-and-replies-off-topic) — `Problem` · Files & Upload
3. [Long response time/latency in chat](#3-long-response-timelatency-in-chat) — `Problem` · Performance & Speed
4. [Missing numbers and axis labels on graphs/diagrams](#4-missing-numbers-and-axis-labels-on-graphsdiagrams) — `Problem` · Graphs & Data visualisation
5. [Poor initial graph display/zoom; requires scrolling to see starting point](#5-poor-initial-graph-displayzoom-requires-scrolling-to-see-starting-point) — `Problem` · Graphs & Data visualisation
6. [Option for regression (linear, exp., etc.) and reading peak points on graphs](#6-option-for-regression-linear-exp-etc-and-reading-peak-points-on-graphs) — `Feature Request` · Graphs & Data visualisation
7. [Missing axis division in point plot when entering data](#7-missing-axis-division-in-point-plot-when-entering-data) — `Problem` · Graphs & Data visualisation
8. [Consolidate uploads in one field and allow pasting screenshots directly from clipboard](#8-consolidate-uploads-in-one-field-and-allow-pasting-screenshots-directly-from-clipboard) — `Feature Request` · Files & Upload
9. [Resize co-builder area so full chat history can be read at once](#9-resize-co-builder-area-so-full-chat-history-can-be-read-at-once) — `Feature Request` · Visual Layout & UI
10. [Automatic saving (autosave) in browser to prevent data loss](#10-automatic-saving-autosave-in-browser-to-prevent-data-loss) — `Feature Request` · Autosave
11. [Equation editor in note field for proper formula formatting](#11-equation-editor-in-note-field-for-proper-formula-formatting) — `Feature Request` · Formatting & Equations
12. [Allow custom ordering and re-arranging of workspace elements](#12-allow-custom-ordering-and-re-arranging-of-workspace-elements) — `Feature Request` · Layout Flexibility
13. [Allow creating multiple instances of the same element (e.g., multiple tables)](#13-allow-creating-multiple-instances-of-the-same-element-eg-multiple-tables) — `Feature Request` · Tables
14. [Allow dragging columns to rearrange variables in a table](#14-allow-dragging-columns-to-rearrange-variables-in-a-table) — `Feature Request` · Tables
15. [Errors and limitations during file upload for feedback (screenshots/PDFs)](#15-errors-and-limitations-during-file-upload-for-feedback-screenshotspdfs) — `Problem` · Files & Upload

**Academic Content**

16. [Missing activities covering the rest of the Physics C curriculum (astronomy, waves, light)](#16-missing-activities-covering-the-rest-of-the-physics-c-curriculum-astronomy-waves-light) — `Feature Request` · Curriculum Content
17. [Avoid using asterisks (*) as multiplication signs in mathematical expressions](#17-avoid-using-asterisks--as-multiplication-signs-in-mathematical-expressions) — `Problem` · Academic Accuracy & Notation
18. [Missing units and physical symbols on numerical values and formulas](#18-missing-units-and-physical-symbols-on-numerical-values-and-formulas) — `Problem` · Academic Accuracy & Notation

**Evaluation & Teacher Overview**

19. [Bot should detect shared student struggles and encourage peer collaboration](#19-bot-should-detect-shared-student-struggles-and-encourage-peer-collaboration) — `Feature Request` · Peer Collaboration
20. [Dashboard/page for teachers to track class progress (optionally anonymous)](#20-dashboardpage-for-teachers-to-track-class-progress-optionally-anonymous) — `Feature Request` · Teacher Overview
21. [Reporting at group and class levels alongside student privacy concerns](#21-reporting-at-group-and-class-levels-alongside-student-privacy-concerns) — `Question/Uncertainty` · Reporting & Privacy

**Project & Implementation**

22. [Post-lesson teacher surveys for project data collection](#22-post-lesson-teacher-surveys-for-project-data-collection) — `Process` · Data Collection
23. [UI limitations, usage limits, and data privacy guidelines](#23-ui-limitations-usage-limits-and-data-privacy-guidelines) — `Information` · Implementation & Logistics

**Collaboration & Organization**

24. [Option for individual "group" mode where students cannot see each other's answers](#24-option-for-individual-group-mode-where-students-cannot-see-each-others-answers) — `Feature Request` · Individual Work
25. [Minor recurring glitches cause teacher uncertainty and need for manual verification](#25-minor-recurring-glitches-cause-teacher-uncertainty-and-need-for-manual-verification) — `Question/Uncertainty` · System Stability
26. [Students in same group overwrite each other's table data; AI only reads latest entry](#26-students-in-same-group-overwrite-each-others-table-data-ai-only-reads-latest-entry) — `Problem` · Group Data Syncing
27. [Group codes are inflexible; request for individual codes that can be paired](#27-group-codes-are-inflexible-request-for-individual-codes-that-can-be-paired) — `Feature Request` · Group Management & Codes

**Pedagogical discussion**

28. [Discussion on bot authority and explaining assignment pedagogical reasoning](#28-discussion-on-bot-authority-and-explaining-assignment-pedagogical-reasoning) — `Question/Uncertainty` · Bot Authority & Guidance

---

## User Interface & Functionality

### 1. Unclear if tutor uses uploaded assignment files; asks for re-upload or misinterprets the prompt

`Problem` · Files & Upload

> I attempted an activity where students were to use the tutor while solving previous Physics A exam questions. I had uploaded PDF printouts of the various tasks as files accessible to the tutor, hoping students could ask directly about specific tasks without uploading and explaining them themselves. However, the tutor did not seem to use these files by default. It still asked students to upload the assignment text... One group experienced it talking about a completely different Question 5 when made aware it had the file. It was also tedious having to PDF-print and upload individual exam papers. Is there an easy way to provide the tutor with the tasks, or should students copy the text in themselves?

> **Original (DA)**
>
> Jeg forsøgte mig med en aktivitet hvor eleverne skulle bruge tutoren under løsning af tidligere fysik A eksamensopgaver. Jeg havde derfor uploadet pdf-udskrifter af de forskellige opgaver som filer tutoren havde adgang til i håbet om at eleverne så kunne spørge direkte til de specifikke opgaver uden selv at skulle uploade og forklare opgaven. Det virkede dog ikke som om at tutoren som udgangspunkt brugte disse filer. Den bad stadig eleverne om at uploade opgaveteksten. En af grupperne oplevede at det var en helt anden opgave 5 den begyndte at tale om når de så gjorde den opmærksom på at den havde fået opgaven. Det var også lidt besværligt at skulle pdf-printe og uploade de forskellige eksamensopgaver. Så er der en nem og god måde at give tutoren de opgaverne, som eleverne skal arbejde med? Eller skal eleverne selv kopiere opgaveteksten ind?

### 2. AI tutor does not respond correctly to screenshot uploads and replies off-topic

`Problem` · Files & Upload

> Some students tried uploading a screenshot of an answer they wanted feedback on directly in the tutor chat. The tutor didn't seem to react to this, but instead started answering something completely unrelated to the task.

> **Original (DA)**
>
> Nogle elever prøvede at uploade skærmklip af en besvarelse som de ønskede feedback på direkte i tutorsamtalen. Det virkede til at tutoren ikke reagerede på dette men begyndte at svare noget helt andet som intet havde med opgaven at gøre.

### 3. Long response time/latency in chat

`Problem` · Performance & Speed

> Long latency in the chat.

> **Original (DA)**
>
> Lang betænkningstid i chatten.

### 4. Missing numbers and axis labels on graphs/diagrams

`Problem` · Graphs & Data visualisation

> We miss numbers and divisions on the axes.

> **Original (DA)**
>
> Vi savner tal og inddelinger på akserne

### 5. Poor initial graph display/zoom; requires scrolling to see starting point

`Problem` · Graphs & Data visualisation

> We wish the starting point was visible in the window from the beginning; we have to scroll to see the graph. The graph could comfortably fill the window (zoom).

> **Original (DA)**
>
> Vi savner at startpunktet ligger i vinduet til at begynde med, vi skal scrolle for at se grafen. grafen må gerne fylde vinduet ud (zoom)

### 6. Option for regression (linear, exp., etc.) and reading peak points on graphs

`Feature Request` · Graphs & Data visualisation

> It would be great if regression could be performed on data points in a graph (linear, exponential, power, logistic). Additionally, it would be cool to read peak points and other graph metrics.

> **Original (DA)**
>
> Det kunne være godt, hvis man kan lave regression af datapunkterne i en graf. Lineær, eksponentiel, potens, logistisk. Derudover vil det være fedt, hvis man kan aflæse fx toppunkter og andet på graferne

### 7. Missing axis division in point plot when entering data

`Problem` · Graphs & Data visualisation

> We miss axis division in the point plot that appears when entering data (looking at the oscillation time activity).

> **Original (DA)**
>
> vi savner akseinddeling i det punktplot der kommer ved indtastning af data (vi kigger her på svingningstidsaktiviteten)

### 8. Consolidate uploads in one field and allow pasting screenshots directly from clipboard

`Feature Request` · Files & Upload

> In the workspace, a distinction is made between uploading files like PDF, Word, and spreadsheets in the feedback area versus image uploads in the drawing area. This division is inconvenient and confusing. Could there be a single field for PDF, Word, spreadsheets, and image files? Furthermore, pasting a screenshot directly from the clipboard without saving it as a file first would be much easier. Is direct file/content upload into the tutor possible? Separate windows for upload feel cumbersome. I imagine students start by uploading a screenshot of the task, chat with the tutor, and then upload a screenshot/file of their solution. Doing all of this in one field would be far easier.

> **Original (DA)**
>
> I arbejdsområdet skelnes der mellem upload af filer som pdf, word og regneark i feedback-feltet og så muligheden for upload af billedfil ved tegneområdet. Den opdeling synes jeg er uhensigtsmæssig og lidt forvirrende. Kan man ikke lave et felt hvor man både kan uploade pdf, word og regneark samt billedfilerne? Derudover ville det være nemmere hvis man kunne kopiere et skærmklip direkte ind fra udklipsholderen og ikke behøver gemme skærmklip som fil på computeren for at kunne uploade den. Kan man ikke få mulighed for at kunne uploade filer og lignende direkte i tutoren? Det virker besværligt at der skal bruges særskilte "vinduer" til upload af filer.
> Jeg kunne forestille mig, at eleverne starter med at uploade skærmklip af opgaveformuleringen for derefter at chatte med tutoren og derefter uploade skærmklip eller fil med deres besvarelse. Det vil være nemmere hvis de kan gøre alt det i det samme felt og ikke i forskellige.

### 9. Resize co-builder area so full chat history can be read at once

`Feature Request` · Visual Layout & UI

> It would be great if the co-builder window could be larger so you can read the entire conversation at once.

> **Original (DA)**
>
> Det kunne være fedt hvis medbyggerfeltet kunne være større så man kan læse hele "samtalen" på én gang

### 10. Automatic saving (autosave) in browser to prevent data loss

`Feature Request` · Autosave

> It would be nice if your work saved automatically in the browser, allowing you to continue if you accidentally navigate away.

> **Original (DA)**
>
> Det kunne være fint hvis ens arbejde automatisk gemte i browseren, så man kan arbejde videre, hvis nu man kommer til at klikke væk

### 11. Equation editor in note field for proper formula formatting

`Feature Request` · Formatting & Equations

> I would like an equation editor in the note field, for instance, so formulas look neat.

> **Original (DA)**
>
> Jeg kunne godt tænke mig en ligningseditor i f.eks. notefeltet, så formler kommer til at fremstå flot.

### 12. Allow custom ordering and re-arranging of workspace elements

`Feature Request` · Layout Flexibility

> I would like to decide the sequence of elements in the workspace myself, so the table doesn't necessarily have to precede the graph.

> **Original (DA)**
>
> Jeg ville gerne selv kunne bestemme rækkefølgen af elementerne i workspace, så tabellen ikke nødvendigvis behøver komme før grafen.

### 13. Allow creating multiple instances of the same element (e.g., multiple tables)

`Feature Request` · Tables

> I would like to create multiple instances of the same element for an activity — for example, one table for data processing and another for results.

> **Original (DA)**
>
> Jeg ville gerne kunne oprette flere af samme element til en aktivitet - f.eks. en tabel til databehandling og en tabel til resultatbehandling.

### 14. Allow dragging columns to rearrange variables in a table

`Feature Request` · Tables

> When creating a table, it would be helpful to drag and rearrange columns so the first variable entered isn't automatically the first column.

> **Original (DA)**
>
> Det kunne også være rart hvis, når jeg laver en tabel, at jeg kunne trække for at om arrangere kolonnerne, sådan så den variable jeg skrev først ikke nødvendigvis er den variable der står først i tabellen.

### 15. Errors and limitations during file upload for feedback (screenshots/PDFs)

`Problem` · Files & Upload

> We also experienced issues with the feedback upload module. First, it initially only allowed selection among 'Custom files', excluding screenshots (image files). When changed to 'All files', students found the files, but uploading triggered an error. This happened with both screenshots and an attempt to upload a full solution (likely PDF).

> **Original (DA)**
>
> Modulet hvis man burde kunne uploade filer til feedback havde vi også problemer med. For det første kunne man som udgangspunkt kun vælge blandt "Tilpassede filer" hvilket ikke inkluderede skærmklip (billedfiler). Når de så ændrede til "Alle filer" kunne eleverne finde filerne men ved forsøg på uploade meldte det fejl. Det skete både ved skærmklip og ved en elev som prøvede at uploade hel besvarelse (vist nok i pdf).

---

## Academic Content

### 16. Missing activities covering the rest of the Physics C curriculum (astronomy, waves, light)

`Feature Request` · Curriculum Content

> You have an activity on energy conservation, but activities for the rest of the Physics C curriculum are missing (e.g., near and distant astronomy, waves, atoms, and light). Is it possible to create demo activities for these topics?

> **Original (DA)**
>
> I har en aktivitet om energibevarelse, men der mangler aktiviteter til resten af c-niveau pensummet. Dvs.: Den nære og fjerne astronomi, Bølger og atomer og lys. Er det muligt at lave demo aktiviteter om disse emnet?

### 17. Avoid using asterisks (*) as multiplication signs in mathematical expressions

`Problem` · Academic Accuracy & Notation

> We do not like asterisks used as multiplication signs.

> **Original (DA)**
>
> stjerner som gangetegn bryder vi os ikke om

### 18. Missing units and physical symbols on numerical values and formulas

`Problem` · Academic Accuracy & Notation

> We think there should be units and preferably symbols — writing 'position = 0.2*time' is not acceptable. At minimum, a unit must be attached to 0.2.

> **Original (DA)**
>
> Vi synes der skal være enheder og helst også symboler - det duer ikke at der står  position = 0,2*tid. Som minimum skal der enhed på 0,2

---

## Evaluation & Teacher Overview

### 19. Bot should detect shared student struggles and encourage peer collaboration

`Feature Request` · Peer Collaboration

> Because students share a virtual space, JB's aspiration is for the bot to notice when different students are struggling with the same thing (or when one has a good idea another lacks) and nudge them to collaborate — something a human teacher struggles to track.

### 20. Dashboard/page for teachers to track class progress (optionally anonymous)

`Feature Request` · Teacher Overview

> Could a page be created where you can follow student progress at the class level? Perhaps as a form of internal class competition, possibly anonymous.

> **Original (DA)**
>
> Kunne man lave en side, hvor man på klassen kan følge elevernes udvikling. Måske som en form for intern konkurrence i klassen. Evt. anonymt.

### 21. Reporting at group and class levels alongside student privacy concerns

`Question/Uncertainty` · Reporting & Privacy

> The tool can generate reports at group or class level — a narrative of how a group worked, concepts discussed, plus a transcript. JB flagged a privacy concern: some students felt this could be too much surveillance, so the level of monitoring (group vs. class) is still open for discussion.

---

## Project & Implementation

### 22. Post-lesson teacher surveys for project data collection

`Process` · Data Collection

> JB introduced a consent-based survey/questionnaire for teachers to fill in after lessons — covering school, class, level, number of students, time spent, which AI tool was used, its purpose, planning challenges, how students reacted, academic benefits, problems, and reflections. More detail helps improve the tool.

### 23. UI limitations, usage limits, and data privacy guidelines

`Information` · Implementation & Logistics

> The tool is intentionally lightweight (no polished UI, given project resources); JB will pass feedback to a developer ('M') for improvements. Teachers can start using it with students once they feel comfortable, with a usage cap, but regular use should wait for a better solution. He advised keeping sensitive/personal information out of it. Future check-ins would mostly be short online sessions since gathering everyone in person is hard.

---

## Collaboration & Organization

### 24. Option for individual "group" mode where students cannot see each other's answers

`Feature Request` · Individual Work

> I would like a toggleable feature where students in the same 'group' cannot see each other's answers — allowing each to have an isolated AI chat without peers following along.

> **Original (DA)**
>
> Jeg kunne godt tænke mig en funktion, hvor man kunne slå til, at elever der arbejde i samme "gruppe" ikke kan se hinandens svar - så de hver sidder med deres egen AIchat, uden at de andre kan følge med i hvad de skriver.

### 25. Minor recurring glitches cause teacher uncertainty and need for manual verification

`Question/Uncertainty` · System Stability

> Many minor glitches, which make you feel like you constantly need to double-check it.

> **Original (DA)**
>
> Mange småfejl, som gør at man føler man skal tjekke den.

### 26. Students in same group overwrite each other's table data; AI only reads latest entry

`Problem` · Group Data Syncing

> Two of us worked in a group on the same activity filling out a table. We each saw the numbers we typed, but the AI only 'saw' the most recently entered values. As students, we couldn't accurately see what each other was doing.

> **Original (DA)**
>
> Vi sad to i en gruppe og arbejdede i samme aktivitet hvor vi skulle udfylde en tabel.
> Vi så hver især de tal vi selv havde tastet ind, men AI-en "så" kun de tal der senest var tastet ind.Vi kunne altså som elever ikke korrekt se hvad hinanden lavede.

### 27. Group codes are inflexible; request for individual codes that can be paired

`Feature Request` · Group Management & Codes

> As I understand group usage, a group code is created for each group, which all students in the group use to collaborate with the tutor and each other. That feels quite inflexible regarding changing groups and individual work. I miss individual codes that can subsequently be combined into various pairs, groups, or individual activities.

> **Original (DA)**
>
> Så vidt jeg forstår brugen af grupper i systemet opretter man en gruppekode til hver gruppe som alle eleverne i gruppen kan bruge til at samarbejde med tutoren og hinanden i systemet.
> Det synes jeg umiddelbart virker ret ufleksibelt i forhold til skiftende grupper og individuelt arbejde.
> Jeg savner individuelle koder, som så efterfølgende kan sættes sammen i forskellige par, grupper eller individuelle aktiviteter.

---

## Pedagogical discussion

### 28. Discussion on bot authority and explaining assignment pedagogical reasoning

`Question/Uncertainty` · Bot Authority & Guidance

> They debated how much authority the chatbot should have with students. One teacher noted feeling it lacks a clear directive quality — it doesn't firmly tell students what to do. JB framed this as a deeper pedagogical question, suggesting the tool could explain why a task matters rather than just issue instructions, since it can't enforce anything (that stays with the teacher). There was agreement that motivated students will engage regardless, so the real challenge is designing the 'flow' so it's useful for everyone.

---

## Appendix A — the meeting's own agenda

- Feature ideas.
- Evaluation and reporting.
- Data collection for the project.
- Logistics and caveats.

## Appendix B — notes on the source spreadsheet

Fidelity flags found while parsing. None of them change the substance; they
matter only if the spreadsheet is re-read as the authoritative record.

- Item 19 (Afdække fælles udfordringer blandt elever): the Danish sheet carries the English text — that entry was never translated back, so there is no teacher-voice original for it.
- Item 21 (Rapportering og privatliv): the Danish sheet carries the English text — that entry was never translated back, so there is no teacher-voice original for it.
- Item 22 (Dataindsamling): the Danish sheet carries the English text — that entry was never translated back, so there is no teacher-voice original for it.
- Item 23 (Implementering og logistik): the Danish sheet carries the English text — that entry was never translated back, so there is no teacher-voice original for it.
- Item 28 (Autoritet og brugbarhed): the Danish sheet carries the English text — that entry was never translated back, so there is no teacher-voice original for it.
- Item 22: Type is blank in the Danish sheet, `Process` in the English one.
- Item 23: Type is blank in the Danish sheet, `Information` in the English one.
- Item 19: the main theme is `Monitorering` in the Danish sheet but `Evaluation & Teacher Overview` in the English one — the Danish sheet carries a sixth theme that the English one folds away.
- Item 28 on top of that: its Danish cell stops mid-sentence ("...suggesting the tool could explain"), so the English cell is the only complete version of the point.
- The Danish sheet has a sixth column that is empty in every row.

