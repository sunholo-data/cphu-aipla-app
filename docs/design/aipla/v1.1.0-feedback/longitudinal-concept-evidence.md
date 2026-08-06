# Longitudinal concept evidence — student-authored concepts, confirmation, and the identity problem

**Status:** **Scoping (OPEN)** — research design with platform consequences. Names one hard architectural constraint that must be settled before anything is built.
**Priority:** **P2 to build, P0 to decide.** The build is post-pilot. But **whether the pilot captures data that can later be linked longitudinally is decided by what ships before 2026-08-14** — and it cannot be decided retroactively. If the pilot runs without a linkage mechanism, the first academic year of data is permanently unlinkable.
**Estimated:** Not estimated — the design questions here are AR/JB's and gate any engineering. The pilot-window decision (below) is ~0.5d to implement once made.
**Scope:** Would touch the concept-map element (student-authored nodes), the exit ticket, the chat-log schema (a linkage key), and the consent wording. **ADR-001 (anonymous group IDs) is the constraint everything here runs into.**
**Dependencies:** [living-concept-map](living-concept-map.md) (**IN BUILD** — teacher-authored map + in-session check-off; this asks for the student-authored counterpart); [1.1.8 exit-ticket](exit-ticket.md) (**OPEN, blocked on JB/AR question set** — the natural home for confirmation + motivation items); [1.1.3 student-consent-prompt](student-consent-prompt.md) (**OPEN, blocked on JB consent wording** — any linkage changes what is consented to); [1.2 chat-log-pipeline](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (**SHIPPED** — where a linkage key would live); [2.9 knowledge-graph-and-student-matching](../post-pilot/knowledge-graph-and-student-matching.md) (**the parent vision** — this is its data-capture precondition); ADR-001 (anonymous group IDs — the binding constraint)
**Source:** M's notes, 2026-08-03 — *"cool to have concept network if some evidence the student activities — students create concepts from activity, make connections from the student, do these change over the academic year? after they finish the activity, this is what it was, do you agree."* · *"the exit interview is a good place for this"* · *"questionnaire for motivation"* · *"researchers control the meta assignment"* · *"how do we include the students in the research? how do we make it a negotiation between the student and teacher. does AI move the authority of the teacher, the teacher will give you the final grade."* · *"21st august teacher training to get feedback on paper"*
**Created:** 2026-08-06 (M)
**Last Updated:** 2026-08-06 (M)

## Problem Statement

The notes propose four related things. Three are buildable. One is blocked by a
deliberate architectural decision, and **the block is time-sensitive in a way
the others are not.**

### 1. Student-authored concepts (buildable)

[living-concept-map](living-concept-map.md) gives the **teacher** a prerequisite
graph and the **tutor** a checkpoint contract. The student's role is to be
assessed against it.

The notes ask for the inverse: *"students create concepts from activity, make
connections from the student"*. That is a different instrument. A teacher's map
is a curriculum artefact; a student's map is **evidence of how that student
organises the domain** — which is what concept mapping is used for in physics
education research in the first place, and what the shipped direction currently
does not capture.

### 2. Post-activity confirmation (buildable, and the cheapest real research instrument here)

*"after they finish the activity, this is what it was, do you agree."*

The tutor already forms a read on the student — checkpoint results, rubric
constructs, a narrative summary. All of it is currently **about** the student and
never **shown to** them. Showing it back and asking for agreement does three
things at once:

- **Member checking** — a recognised qualitative-validity move. The AI's read
  becomes a claim the subject can dispute.
- **Metacognitive prompt** — reading a description of your own reasoning is a
  learning act.
- **Disagreement is data.** Where the AI's read and the student's self-read
  diverge is more interesting than where they agree, and nothing currently
  records it.

This is also the sharpest expression of Axiom 2 in the product: the AI's
inferences stop being something done to students behind their backs.

### 3. Motivation questionnaire + exit interview (buildable, already scoped)

[1.1.8 exit-ticket](exit-ticket.md) is designed and **blocked on JB/AR providing
the question set**. Motivation items and the confirmation step both belong
there. This adds requirements to that doc; it does not need a new surface. The
blocker is content, not code.

### 4. "Do these change over the academic year?" — blocked by ADR-001

**This is the hard one.**

ADR-001 makes students **anonymous group IDs**: a custom group JWT, `email=""`,
`domain=""`, a synthetic uid, no Firebase identity. Deliberate, and correct —
it is why the platform can be used with minors in Danish schools without a
per-student data-protection conversation.

The consequence: **there is no student.** There is a group, in a session, with a
code that expires. Two sessions by the same human in October and in March are
not linkable, by construction. So:

| Question | Answerable today? |
|---|---|
| Do this group's concept maps get richer within an activity? | Yes |
| Does this class's aggregate change over the year? | Yes, at class level |
| **Does this student's concept network change over the year?** | **No** |

The third is what the notes ask, and it is the one the anonymity guarantee
forbids. This is not an oversight to be engineered around — it is the guarantee
working. Any longitudinal design must either accept class-level granularity or
**deliberately and consentfully** weaken the guarantee.

### 5. The authority question (not a build at all)

*"does AI move the authority of the teacher, the teacher will give you the final grade."*

This is a research question about the intervention's effect on classroom
relations, not a feature. It is recorded here because it has **one product
consequence worth stating**: if the AI's read of a student ever reaches a
teacher in a form that looks like an assessment, the platform has moved
authority whether or not it intended to. That is already live — the
[rubric surfacing doc](rubric-results-in-product.md) puts a competency
description in a teacher's hands, and [1.1.57](competency-rubrics.md)'s R1 gate
on teacher-facing rubric vocabulary is precisely the guard. **The authority
question is the reason that gate exists**, and it should be argued in those
terms on 21 August rather than as a UI-vocabulary detail.

## The decision that cannot wait

**Everything else here is post-pilot. This is not.**

If the pilot runs 2026-08-14 onward with no linkage mechanism, the data it
generates can *never* be linked longitudinally — not by a later feature, not by
a backfill. The choice is made by what ships before the pilot, by default, and
the default is "no linkage".

Three options, in increasing order of what they give up:

### Option 1 — Class-level longitudinal only (no change)

Track aggregate concept-network change per class across the year. No individual
trajectories. Anonymity fully intact, no consent change, **nothing to build**.

Answers *"do students' concept networks change over the year?"* at population
level. Does not answer it per student.

### Option 2 — Pseudonymous linkage token

Each student is issued a stable, opaque token at the start of the year — held by
the student (or by the teacher on a paper list the researchers never see), entered
when joining. Sessions carrying the same token are linkable to each other but to
**no identity**.

- Longitudinal per-pseudonym analysis becomes possible.
- The platform still stores no identifying data. Re-identification requires the
  teacher's list, which stays outside the system.
- Costs: a token entry step in the join flow, a `linkage_token` column on
  chat-log rows, an explicit consent clause, and a real operational burden on
  teachers (30 students × a token they must not lose, for a year).
- The honest risk: **a pseudonym is not anonymity.** It is a weaker guarantee
  wearing similar language, and the consent wording must not blur that.

### Option 3 — Named accounts for students

Rejected. It would undo ADR-001, and the reason ADR-001 exists — deployability
in Danish schools without per-student data-protection negotiation — has not
changed. Recorded so nobody re-proposes it as a simplification.

**Recommendation:** ship the pilot on **Option 1**, and put **Option 2 to JB and
AR before 14 August as an explicit, dated decision** — including "we choose not
to, and accept that year-one individual trajectories are unavailable". Either
answer is defensible. Drifting into Option 1 by not deciding is not, because it
is indistinguishable from Option 1 chosen, and only one of those can be defended
in a paper.

Option 2's implementation is small (a join-flow field and a log column). **Its
cost is entirely in consent and teacher operations**, which is exactly why it is
JB and AR's call and not engineering's.

## Goals

**Primary (this doc):** Get the linkage decision made before the pilot, and
record the buildable instruments so they can be scoped once AR/JB supply content.

**If Option 2 is chosen — pilot-window requirements:**
- A linkage token on chat-log rows and rubric runs from day one
- Consent wording covering it ([1.1.3](student-consent-prompt.md))
- Teacher-facing token issuance that does not require a spreadsheet

**Post-pilot, either way:**
- Student-authored concept maps as a first-class artefact
- Post-activity confirmation, with agreement/disagreement recorded
- Motivation items in the exit ticket

**Non-goals:**
- Building the longitudinal analysis. Capture first; analysis is Year 2 / [2.9](../post-pilot/knowledge-graph-and-student-matching.md).
- Answering the authority question. That is a paper.

## Axiom Alignment (post-activity confirmation, the buildable slice)

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | End-of-session; the read is already computed. |
| 2 | EARNED TRUST | **+1** | The strongest expression of this axiom in the product: the AI's inference is shown to its subject and can be disputed. Currently every AI read of a student is invisible to that student. |
| 3 | SKILLS, NOT FEATURES | 0 | Session-end surface. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Reuses the narrative/rubric output; no new judge call. |
| 5 | GRACEFUL DEGRADATION | +1 | Unscored session → no confirmation step, session ends as today. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Rides the exit-ticket surface rather than adding a second end-of-session flow. |
| 7 | API FIRST | 0 | Exit-ticket contract. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Agreement/disagreement is a first-class logged field — the research signal, not a UI event. |
| 9 | SECURE BY CONSTRUCTION | 0 | Group-scoped; adds no identity. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Server composes the read; client renders and captures a response. |
| 11 | USABLE BY DESIGN | +1 | Ends a session with something *for* the student rather than only about them. |
| | **Net Score** | **+5** | Threshold: >= +4 |

*Option 2 is not scored — the trade it makes is a governance decision, and an
axiom table would give a reader false confidence that engineering had settled it.*

## Design sketches (not commitments)

### Student-authored concept map

The shipped `conceptMap` element is teacher-authored config. The student version
is **session state** — the student adds nodes and edges during or after an
activity, in their own words. A student's map is not scored against the
teacher's; the *comparison* between them is the finding.

Reuses the shipped graph rendering. The store is per-group session state, the
same shape as `concept_progress`. The open question is whether the tutor may
suggest nodes — attractive for scaffolding, contaminating for evidence. Probably
a per-activity teacher setting, and probably off in research conditions.

### Post-activity confirmation

At session end, the student sees a short, plain-language version of the AI's
read (from the same source as [`competencyNotes`](rubric-results-in-product.md) —
no rubric vocabulary, no scores) and answers:

> *Does this sound like your session?* — Yes / Partly / No, plus a free-text box.

The response is logged beside the rubric run. Disagreement is a research finding
and should be visible to researchers alongside the score it disputes.

**Register matters.** A student being shown a summary of their own thinking is a
vulnerable moment. It must read as "here's what I noticed — did I get it right?"
and never as a verdict. This is the wording the 21 August session should test.

### Motivation items

Belong in [1.1.8 exit-ticket](exit-ticket.md), which is blocked on the question
set. If motivation is to be measured across the year, the instrument must be
**stable from the first session** — changing items mid-year makes the series
uninterpretable. That makes the question set a pre-pilot dependency, not a
post-pilot one, and it should be flagged to JB/AR as such.

### "Researchers control the meta assignment"

Reads as: the researchers, not the teacher, own the framing that sits above
individual activities. The platform equivalent already exists in two places —
[authoring-teaching-framework.md](authoring-teaching-framework.md) (researcher-owned
rules over the authoring co-pilot) and [1.1.47](prompt-transparency-and-config.md)
(role-gated prompt layers). If there is a *student-facing* meta-assignment as
well ("your task across this year is…"), that is a new surface and needs
articulating before it can be scoped. **Ask AR what was meant.**

## Open Questions

**For JB and AR, before 14 August:**

1. **Option 1 or Option 2?** Pseudonymous linkage, or class-level only for year
   one? A dated decision either way. This is the whole point of this document.
2. If Option 2: who holds the token list, and what does the consent say?
3. What are the motivation items? They must be stable from session one.

**For the 21 August teacher training:**

4. Would teachers use a student-authored concept map, or is it another thing to
   administer?
5. Does the post-activity confirmation wording land as respectful or as a verdict?
   Test the actual sentence on actual teachers.
6. **The authority question**, asked directly: does an AI that reads a student's
   competence change what the teacher's grade means? Teachers will have views,
   and the [rubric surfacing](rubric-results-in-product.md) R1 gate is the live
   product decision that hangs on the answer.

**For AR:**

7. What is "the meta assignment" concretely — a researcher-owned prompt layer
   (already exists) or a student-facing framing (does not)?

## Related Documents

- [living-concept-map.md](living-concept-map.md) — teacher-authored map; the student-authored counterpart is asked for here
- [exit-ticket.md](exit-ticket.md) — 1.1.8, the home for confirmation + motivation items; blocked on the question set
- [student-consent-prompt.md](student-consent-prompt.md) — 1.1.3, what changes under Option 2
- [rubric-results-in-product.md](rubric-results-in-product.md) — 1.1.65, the source of the confirmation text, and where the authority question is already live
- [knowledge-graph-and-student-matching.md](../post-pilot/knowledge-graph-and-student-matching.md) — 2.9, the parent vision this is the data-capture precondition for
- [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) — 1.2, where a linkage token would live
- ADR-001 (anonymous group IDs) — scoping site `architecture.qmd`; the binding constraint
- [docs/notes-2026-08-03.md](../../../notes-2026-08-03.md) — M's raw notes
