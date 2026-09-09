# Materials for Aswin — AIPLA overview for the paper

**Status**: **Complete, 2026-09-09.** All four pieces from item **35** of the
[2026-09-01 meeting triage](../v1.1.0-feedback/meeting-2026-09-01-triage.md)
are here: the pointers to existing public material, plus the two
previously-missing sections (differences from existing tools, example flows),
both written this pass. **The differentiation section is new desk research —
worth Aswin's own sanity check before it goes in the paper**, since he knows
the field better than a web search does.
**Priority**: P1 — feeds the *Applied Artificial Intelligence* overview
(triage item 22), and A4 (template licensing) is more urgent once that paper
is public.
**Owner**: M compiled this pass; nothing here is gated on Aswin.
**Scope**: What exists and can be handed over now, plus the two pieces that
needed writing. Not the paper itself.
**Created**: 2026-09-09
**Source**: [meeting-2026-09-01-triage.md](../v1.1.0-feedback/meeting-2026-09-01-triage.md)
items 6, 22, 35.

## Ready now

| Material | Where | Covers |
|---|---|---|
| System / architecture overview + diagram | [aipla.ku.dk/project/platform](https://aipla.ku.dk/project/platform) | How the pieces fit — teacher → class → group → activity, and the chat/workbench/sims surfaces around it |
| Design-decisions writeup | [aipla.ku.dk/project/decisions](https://aipla.ku.dk/project/decisions) | Rationale for the choices that make AIPLA different (group-not-student identity, tutor+workbench coupling) — the best available source on "what's different" until the comparison below is written |
| Capability-floor findings | [aipla.ku.dk/project/evaluation/capability-floor](https://aipla.ku.dk/project/evaluation/capability-floor) | Model performance on Danish stx Fysik A physics, self-hosting viability, why a self-host tier needs a text model *and* a vision-language model, not one |
| Repo | [github.com/sunholo-data/cphu-aipla-app](https://github.com/sunholo-data/cphu-aipla-app) | Public. Linkable as-is |

## Differences from existing tools

**Written 2026-09-09 from a web search pass — not exhaustive, and worth Aswin's
own sanity check before it goes in the paper.** No existing AIPLA or
scoping-site document covers this (confirmed absent as of 2026-09-09), so
this is new desk research, not a repo-sourced claim.

### The comparators

Includes two pre-LLM systems deliberately — the honest comparison set for a
"what's novel" claim has to include the systems that already did the
non-LLM version of the same idea, not just other LLM products.

| Tool | What it is | Relevant contrast with AIPLA |
|---|---|---|
| **AutoTutor** (Tilburg/Memphis research, 1990s–2000s) | A pre-LLM intelligent tutoring system built specifically for **Newtonian qualitative physics** (and computer literacy): mixed-initiative dialogue driven by a **curriculum script** of pre-formulated questions, tracking the learner's cognitive state through the transcript, hinting, correcting, summarising | **The direct historical precedent AIPLA has to be read against.** Same subject area, decades before LLMs, already doing curriculum-scripted, non-improvised tutoring dialogue. Anything claiming "teacher-authored, bounded tutoring" as novel has to reckon with this — see the reframed differentiator 3 below |
| **Carnegie Learning (MATHia)** | Descends from Carnegie Mellon's Cognitive Tutor research — production-rule / model-tracing tutors, commercialised in 1998 *(general knowledge, not verified in this search pass — confirm the date/lineage before citing it directly)*; maths-focused | Same ITS lineage as AutoTutor: hand-authored production rules, not LLM-navigated. Individually-identified students, maths only |
| **Squirrel AI** | China-based; **24M+ registered students**, middle-school maths alone decomposed into **10,000+ atomic "knowledge points"** by master teachers, runs a joint research lab with Carnegie Mellon on personalised learning at scale | Far larger scale and much finer-grained *content* decomposition than AIPLA attempts or needs — but that is a different axis from AIPLA's actual constraint, which is *identity* granularity (group vs. individual student, per the Strand C §C3 finding), not content granularity. Not a like-for-like comparison, and the paper should say so rather than imply they compete on the same axis |
| **Khan Academy** (base platform) | Free, non-profit; dedicated high-school and AP physics courses (mechanics through AP Physics C), mastery-based progression through video lessons, "Understand"/"Apply" practice exercises, and unit tests | The actual physics-content competitor, separate from the AI layer below: pre-authored video + exercise curriculum a student works through solo, not a conversational tutor. AIPLA has no video-lesson library and doesn't compete on content breadth — the comparison is on *mode* (self-paced content library vs. tutor-in-the-loop dialogue), not depth |
| **Khanmigo** (Khan Academy's AI layer, sits on top of the base platform above) | Socratic-style AI tutor/teaching assistant across maths, science, history, CS, language arts; free for US K-12 | Broad-subject, chat-first; no workbench/simulation coupling comparable to AIPLA's — the tutor sees what the student *typed*, not a shared workspace state, and it sits alongside Khan Academy's existing content library rather than being built around a teacher-authored activity the way AIPLA is |
| **Synthesis Tutor** | AI-guided small-group maths/critical-thinking, students paired live, ~$150/student/year | Adaptive-maths focus, not physics; group-of-two pairing is a different unit from AIPLA's anonymous class-group model |
| **NewtBot** (published research, CHI 2024) | An LLM-based tutoring chatbot for secondary physics, built on **GPT-3.5** with three separately-prompted model roles (baseline / tutor / feedback) | The closest academic comparator — same subject, same school stage — but it is a **published research prototype**, not a deployed classroom product. AIPLA's honest edge here is "piloted with real teachers and 12+ real classes," not architectural novelty; no workbench/simulation surface, no teacher-authoring layer, no national-syllabus grounding |

### What's actually different about AIPLA

Drawn from the platform's own architecture (ADR-001, ADR-003, ADR-013 — see
[the architecture snapshot](../_scoping-snapshot/architecture.qmd)), not from
the comparators above.

**A framing note worth putting near the top of this section in the paper:**
given AutoTutor and Carnegie Learning, AIPLA's contribution is *not*
inventing curriculum-scripted, teacher-bounded tutoring dialogue — that is
~30-year-old ITS discipline, in physics specifically. The honest claim is
narrower: **combining that older discipline with an LLM doing the navigation
(instead of hand-built NLU/production rules) and a co-pilot doing the
authoring (instead of an ITS engineer), coupled to a live interactive
workbench, deployed anonymously at the group level.** Each piece has
precedent somewhere in the comparator set; the combination, and specifically
the *authoring-cost* reduction, is where the claim should sit.

1. **The unit of identity is the group, not the student.** Students join by
   an anonymous class group code — no account, no login, no persistent
   individual profile (ADR-001). This is a considered trade-off, not an
   oversight: it forecloses individual-level personalisation (see the Strand C
   §C3 finding on granularity) in exchange for a materially lower deployment
   bar in a school setting. It also runs against the current in this specific
   way — student-data-privacy concerns have stopped comparable deployments
   outright (e.g. New York City withdrew a $1.9M AI reading-tutor proposal,
   Amira, over unresolved student-privacy and governance concerns), and
   AIPLA's anonymity is a structural answer to that class of objection, not a
   policy promise layered on top.
2. **The tutor sees the workspace, not just the transcript.** Student actions
   in the workbench — a value entered, a simulation run, a checklist
   ticked — are pushed to the tutor's context as they happen (the
   `useSimSnapshotPush` / trust-card mechanism). None of the comparators above
   couple a live interactive workspace to the conversational model in this
   way; Khanmigo and NewtBot are both chat-only.
3. **The pedagogy is teacher-authored, not model-improvised — an
   authoring-cost claim, not a novelty claim.** Curriculum-scripted,
   non-improvised tutoring dialogue is not new (see AutoTutor and Carnegie
   Learning above); what's different is *who* can author it. Those systems
   needed an ITS engineer to hand-write production rules or a curriculum
   script; AIPLA's answer-tree design (1.1.90) has the **teacher** author the
   question and expected answer branches, drafted by a co-pilot, with an
   **LLM** doing the navigation instead of hand-built NLU — deterministic and
   inspectable, at a materially lower authoring bar than the ITS-engineer
   version, at the cost of the teacher's own time (mitigated, not removed, by
   the co-pilot).
4. **Curriculum grounding is a specific national syllabus, not general
   knowledge.** Retrieval is scoped to cleared Danish stx Fysik A material
   (see [curriculum-library.md](../v1.1.0-feedback/curriculum-library.md);
   RAG via `adk/curriculum_retrieval.py`),
   not a general web-trained answer.
5. **The model layer is tiered and self-host-evaluated, not a single closed
   API.** ADR-003's four tiers (cloud API / self-hosted GPU cluster /
   server-local / on-device) and the `stx-bench` capability-floor work exist
   because GDPR-tractability and cost are first-order constraints, not an
   afterthought — consistent with the broader 2026 finding that an EU-based
   deployment increasingly means self-hosting an open-weight model on EU
   infrastructure rather than relying on a single vendor API.

### Danish/local landscape

No competing *product* was found in the Danish gymnasium space. The closest
things are **research and pedagogy initiatives**, not tools: NEXT Sukkertoppen
Gymnasium is running a 2026–2029 project (28 teachers, 200+ students)
developing AI-integrated teaching practice generally (not physics-specific,
no named platform), and 29 Danish gymnasier have grouped to upskill teachers
on AI pedagogically. AIPLA itself is the top search result for "AI
læringsplatform fysik" in Danish — worth noting as a positioning fact for the
paper, not a comparator.

### Sources

- [Fresh Updates to Khan Academy's Physics Courses Bring More Rigor and Flexibility (Khan Academy Blog)](https://blog.khanacademy.org/fresh-updates-to-khan-academys-physics-courses-bring-more-rigor-and-flexibility/)
- [Khan Academy — Wikipedia](https://en.wikipedia.org/wiki/Khan_Academy)
- [AutoTutor — Wikipedia](https://en.wikipedia.org/wiki/AutoTutor)
- [AutoTutor: a tutor with dialogue in natural language (Behavior Research Methods)](https://link.springer.com/article/10.3758/BF03195563)
- [China has started a grand experiment in AI education (MIT Technology Review, on Squirrel AI's scale and knowledge-point decomposition)](https://www.technologyreview.com/2019/08/02/131198/china-squirrel-has-started-a-grand-experiment-in-ai-education-it-could-reshape-how-the/)
- [CMU, Yixue Education Inc. Announce AI Research Project in Adaptive K-12 Education (Carnegie Mellon)](https://www.cs.cmu.edu/news/2019/cmu-yixue-education-inc-announce-ai-research-project-adaptive-k-12-education)
- [Best AI Tutoring Platforms for Higher Education in 2026](https://ibl.ai/blog/best-ai-tutoring-platforms-for-higher-education-in-2026)
- [6 Squirrel AI Alternatives for Effective Learning Solutions](https://www.apporto.com/squirrel-ai-alternatives)
- [Student Interaction with NewtBot: An LLM-as-tutor Chatbot for Secondary Physics Education (CHI 2024)](https://dl.acm.org/doi/10.1145/3613905.3647957)
- [Schools Race To Write AI Policies. What About Student Data Privacy? (Forbes, on the Amira/NYC withdrawal)](https://www.forbes.com/sites/sarahhernholm/2026/07/24/schools-race-to-write-ai-policies-what-about-student-data-privacy/)
- [GDPR-Approved AI Models for Europe — Which Models Can You Actually Use? (2026)](https://www.aimadetools.com/blog/gdpr-approved-ai-models-europe-2026/)
- [Artificial Intelligence in Physics Learning and Assessment (AIPLA) — Københavns Universitet](https://www.ind.ku.dk/projekter/artificial-intelligence-in-physics-learning-and-assessment-aipla/)
- [Hver tredje elev frygter, at AI svækker læringen — NEXT Uddannelse København](https://via.ritzau.dk/pressemeddelelse/14929089/hver-tredje-elev-frygter-at-ai-svaekker-laeringen-gymnasium-gentaenker-undervisningen?publisherId=13559589&lang=da)

**Not sourced in this pass, flagged rather than asserted:** Carnegie
Learning's 1998 commercialisation date and direct Cognitive Tutor lineage
(general knowledge, wants a citation before it goes in the paper).

## Example flows

**Written 2026-09-09, sourced directly from the shipped, screenshot-backed
guides** ([t1](../../../guides/t1-set-up-a-class.qmd),
[t2](../../../guides/t2-create-your-first-activity.qmd),
[s1](../../../guides/s1-join-and-use-your-tutor.qmd)) — these are real
product flows, not illustrative fiction.

### Teacher flow — set up a class and an activity

1. **Create a class.** The teacher opens *Classes → New class*, names it
   (e.g. *"Physik 2.g, autumn 2026"*). No student roster is entered — a class
   is a container, not a list of named students.
2. **Mint a group code.** *New group* generates a short, memorable code (e.g.
   `bright-fox-42`). A teacher can mint several codes per class — one per lab
   table, say — so reports can distinguish groups without ever identifying an
   individual student.
3. **Build the first activity.** *New activity* opens a builder with a
   template picker and a live preview. The teacher writes a **teaching
   goal** in plain language — e.g. *"Help the student reason about energy
   conservation on a frictionless ramp; do not give the final answer, ask
   guiding questions"* — which becomes the instruction the tutor follows, and
   optionally adds workbench elements (a simulation, a table, a calculator,
   notes). The live preview shows exactly what the student will see as each
   element is added.
4. **Publish.** *Create activity* makes it live for the class immediately —
   no deploy step, no developer involved anywhere in this flow.

### Student flow — join and work

1. **Join with the code, nothing else.** The student opens the class link,
   types the group code, selects *Join*. No account, no password, no personal
   information collected at any point.
2. **Pick the activity.** The student sees the activities the teacher has set
   up for that class and opens the one they're working on.
3. **Work with the tutor and the workspace side by side.** The activity opens
   with the AI tutor on one side and the workbench (simulation / table /
   checklist / notes, depending on the activity) on the other. As the student
   enters a value, runs the simulation, or ticks off a step, that action is
   pushed into the tutor's context — so when the student asks a question, the
   tutor is responding to their *actual* in-progress work, not a description
   of it.
4. **Leave without a trace.** Closing the tab ends the session; there is no
   persistent student identity to sign out of. Re-joining with the same code
   returns to the same group's shared work.

**The contrast worth drawing out for the paper:** both flows are entirely
teacher- and student-facing — no engineering step appears anywhere in either
one, which is itself one of the differentiators from research-prototype tools
like NewtBot (which requires a "modifiable back-end" to configure).

## Explicitly blocked — separate from this deliverable

**A real teacher-session example** (triage item 6) is a different ask from
the paper material above: showing Aswin an actual pilot session, even through
the audited researcher view (`auth.researcher_bypass`), is gated on the
Google data-management agreement (item 1), targeted **Nov–Dec 2026**, chased
by JB with KU legal. Not resolvable by writing anything here.
