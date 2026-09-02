# 1 September 2026 meeting — repo-side disposition map

**Status:** Triaged 2026-09-02. Source record: [notes-2026-09-01.md](../../../notes-2026-09-01.md).
**Nature:** Unlike the [21 August triage](teacher-feedback-2026-08-21-triage.md), which mapped teacher complaints about a product, this one maps a **direction-setting meeting**. Most items are not defects and several are not engineering at all.
**Decisions taken by M, 2026-09-02:** D1–D4 below.
**⚠️ REVISED 2026-09-02 against the meeting transcript** ([09-01 summary](../../../09-01_Weekly_Meeting_AI_Education_Platform_Data_Compliance_and_Teacher_Feedback-Summary.md)), which landed after the first pass. The dictated notes were lossy: **D1 is now answered**, two dispositions were wrong, one guess is confirmed, and **eight items were missed entirely**. See [Transcript revision](#transcript-revision-2026-09-02).

## Summary

**The centre of gravity moved from what to build to what is unblocked.** Two
pieces of missing paperwork gate more than the whole build roadmap: data
protection (5 items) and template licensing (3 items). Neither is engineering.

Of the engineering items, **most already have prior art** — and verifying that
turned up a lesson worth recording separately: **several design-doc `Status:`
headers are stale.** `cost-dashboard.md` says *"Planned (P1)"* and the page
ships. `tutor-personas.md` says *"Planned"* and its `interaction_style`
primitive ships while the persona bundle does not. Dispositions below are
verified **against code**, per the retrospective's rule: *verify "done" against
git + code, never the sprint JSON* — and now, never the doc header either.

**Six new design docs** come out of this meeting, 1.1.90–1.1.95. The largest,
1.1.90, is not any single bullet in the notes: *steering the tutor with the
concept map, bounding it with questions and answer trees* is four separate
remarks describing one piece of work.

## Decisions taken (M, 2026-09-02)

**D1 — Is the Google data agreement in place? ~~UNKNOWN~~ → ANSWERED BY THE
TRANSCRIPT: NO, and it is being chased.** The dictated notes read both ways
within two minutes; the transcript settles it. **JB has contacted the legal
department and needs to follow up, aiming to have it in place by
November–December.** So:

- It is **not** in place. Student trials remain blocked.
- **November was misread.** It is when *most teachers begin teaching Physics C*,
  not a confirmed trial date — and the agreement is targeted at
  *November–December*, i.e. **at or after** the point I had sequenced work
  against. The transcript's own framing is *"small-scale pilots desired in 2026,
  broader trials in 2027, pending the Google agreement."*
- **A second legal gate exists that the notes missed entirely** — Prøvebanken
  (item 30). Two independent legal blockers, not one.

**D2 — Answer trees are TEACHER-AUTHORED, AI-navigated.** The teacher authors
the questions and the expected answer branches; the tutor picks the branch
matching what the student actually said. Deterministic and inspectable, and the
teacher owns the pedagogy. Rejected: AI-generated-at-runtime — generating its
own next question is precisely the behaviour ("goes off on a tangent") the whole
item exists to stop. The authoring burden is real and the co-pilot mitigates it
by drafting trees the teacher edits. → **[1.1.90](bounded-tutoring-answer-trees.md)**

**D3 — The session benchmark ships MECHANISM FIRST, rubric pluggable.** Build
the scoring harness so any rubric drops in — Etkina, the shipped competency
rubrics, or something AR writes later. Explicitly applying the 1.1.78 lesson:
*four instruments waited on four different humans for the same missing widget,
and so none of them built the mechanism, which none of those decisions gate.*
→ **[1.1.92](session-benchmark-tutor-activity.md)**

**D4 — Commercial / other-programme threads get NO design docs in this repo.**
The India channel, the possible spin-off company, and the new-teacher planning
tool stay as notes. This is the KU execution repo and **A4 (template
licensing/ownership) is unsettled** — writing commercial product design into a
KU-contract repo muddies precisely the question A4 must answer cleanly. The
*individual-mode* work the India channel would need is genuine AIPLA work and
stays where it already is: items 24 + 27 of the August triage, a scoped ADR-001
revision.

## Disposition map

| # | Item | Type | Disposition |
|---|---|---|---|
| 1 | Trials blocked pending a Google data management agreement | **⛔ Blocker — not engineering** | **D1: status UNKNOWN.** Distinct from the DPIA (KU's own assessment) — two documents, two owners. "KU already has one" needs a *specific* answer: a Workspace agreement is not a Cloud one, and the question is whether `aipla-*-2026` sit under covered billing. ⚠️ Interacts with the 2026-08-21 pilot data already held. → **M + JB, this week** |
| 2 | Anonymisation of uploaded images | **New build** | → **[1.1.93](uploaded-image-anonymisation.md)**. The one genuinely-new engineering item in the data-protection cluster |
| 3 | Testing with students by November; C level most numerous | **Planning** | Gated on item 1. Partly answers the extension plan's biggest open question and flips **1.1.78** from defer to start. C-weight the content effort |
| 4 | Researcher sees what students did, like a teacher can | **REAL GAP — my first disposition was too confident** | I wrote "mostly ships, not a build". The transcript is explicit: *"Researchers currently cannot view student activity within teacher-created classes. [M] confirmed the data exists and agreed to add a feature to expose it."* Both can be true — the **backend** genuinely permits it (verified: `scope=all` toggle, every class GET on `_load_readable`, writes on `_load_owned`), so the gap is either an ungranted claim or a **missing surface**, not an authorisation wall. **Still check the claim first — it is one command and may save building something that exists** — but treat this as a committed deliverable, not a config check. It is on the transcript's action list with M's name on it |
| 5 | Report routes appear to have no ownership check | **⚠️ Possible defect — UNVERIFIED** | `GET /api/reports/{sessions,groups}/…` bind the caller as an unused `_user`; no test asserts denial. **Needs a deliberate security review before any action** — see [Still to verify](#still-to-verify) |
| 6 | Aswin needs an example of a real teacher session | **Decision, not build** | Two routes with different consequences: *show it in the researcher view* (audited, `auth.researcher_bypass` on the span, data stays in the system) vs *send an extract* (real student data leaves the audited surface). **Prefer granting the claim.** Gated on item 1 |
| 7 | Send Aswin usage data | **Clarified → item 6** | Resolved during the meeting into item 6 |
| 8 | Exit tickets for sessions | **ALREADY DESIGNED** | **[1.1.78 question-set-element](question-set-element.md)** absorbed [1.1.8 exit-ticket](exit-ticket.md) as `placement: "session_end"`. Do not redesign. **Un-defer it** — item 3 supplies the date it was gated on |
| 9 | Steer the AI to only talk around the cognitive map; AI goes off on tangents; bound it with questions; answer trees; the map lives in the activity | **New build — the big one** | → **[1.1.90](bounded-tutoring-answer-trees.md)**. Five bullets, one piece of work. Builds on [living-concept-map](living-concept-map.md) (shipped to dev) |
| 10 | Teaching prompt is short; need reliable conditional RAG for a long one | **New build** | Folded into **1.1.90** as its retrieval half. `adk/curriculum_retrieval.py` ships; the gap is *reliably conditional* rather than model-elected |
| 11 | Tutors from frameworks (ESRU, SDT, Dysthe, authentic questions, student discipline); configurable for researchers; **a co-pilot to help design them**; **teachers making custom tutors**; **researchers seeing what teachers make**; persona workflow with previews | **New build — larger than first triaged** | → **[1.1.91](researcher-configurable-tutors.md)**, **rewritten 2026-09-02**. The first pass captured only the researcher store and a preview; review established that the ask was three things, not one. **The configurable layer that exists is `concise / rigorous / socratic / warm` — tone adjectives, not pedagogical theory**, which is the precise sense in which *"current tutors are placeholders"*. A tutor is today a `SKILL.md` in git (8 of them), so a new one is an edit-commit-deploy-seed and the people who own the pedagogy cannot do it. Now covers: **theory as structured data** (framework → constructs → observable behaviours → evaluation hint, so a prompt is checkable *against* its theory); a **tutor co-pilot** on the shipped shell and propose→Apply pattern; **two authoring tiers** (researchers author frameworks, teachers author *variants* with lineage); and a **researcher cross-view** over teacher-authored tutors. Re-estimated ~3–4d → **~6–8d** |
| 12 | A/B performance of tutors | **HALF SHIPS** | The arm key already exists — `revision` is stamped on every chat-log row and tagged Cloud Run revisions per class are documented in the deploy runbook. What is missing is the *scoring*, which is 1.1.92 |
| 13 | Benchmark for rating a session; grade tutor vs activity; which tutor for which activity; what rubrics | **New build** | → **[1.1.92](session-benchmark-tutor-activity.md)**, **D3: mechanism first**. Consumes 1.1.91's personas and [competency-rubrics](competency-rubrics.md) |
| 14 | Etkina scientific abilities / rubrics; multiple representations | **Content decision for AR** | ✅ **Name CONFIRMED by the transcript**: *"Eugenia Etkina's Scientific Abilities Framework was introduced as a potential source for creating such rubrics."* The phonetic guess was right. Feeds 1.1.92 as *a* rubric, not its precondition (D3). Transcript adds the reason a tight rubric matters: **the "LLM as a judge" problem — models rate highly** — which is exactly what 1.1.92 M3 calibration exists for. **Aswin to share a paper with two rubrics** |
| 15 | How many resources have we used this session; energy units J/W/kWh; awareness for students *and* teachers | **Partly ships / new build** | The cost dashboard **ships** (`/teacher/insights/cost`) despite a "Planned" header, in **USD and teacher-facing**. Energy units and a *student-facing* surface are both new → **[1.1.94](session-resource-transparency.md)** |
| 16 | The dumb model was noticed, we needed a smarter one | **Known** | Model tiering exists (`config/models.py`, `default_model()`/`fast_model()`). Worth a look at *which* surface got the fast tier and whether that choice is right; not a design doc yet |
| 17 | More examples for C-level physics; jitt.dk as a source | **Content — not engineering** | The builder and authoring co-pilot exist. → JB / Aswin, C-weighted per item 3 |
| 18 | Could flood with examples but need a way to make teachers **safe to publish** | **New build** | → **[1.1.95](safe-to-publish-vetting.md)**. Sharing ships (ALS-SHARE: duplicate/branch, publish, adopt, provenance); what is missing is the *confidence* to publish |
| 19 | Generate activities, Jesper and Aswin leading | **Process** | → JB / Aswin |
| 20 | Underlying framework for assessing student logs | **Covered** | [session-analytics-rubric](../post-pilot/session-analytics-rubric.md) + [competency-rubrics](competency-rubrics.md); 1.1.92 is the delivery surface |
| 21 | Jesper sending drawings/text for the exit interview | **Awaiting input** | → JB |
| 22 | Publish an AIPLA overview in *Applied Artificial Intelligence* | **Not engineering** | ⚠️ Makes **A4 (template licensing)** urgent — a published overview invites "can we use this?" from strangers. Consent to use the tool ≠ consent to be published |
| 23 | Research the differences between AIPLA and other tools | **Not engineering** | Desk research. Axes recorded in the notes; nothing in the repo knows what others do and it must not be guessed |
| 24 | Master's physics students tutoring high-school pupils for better transcripts | **Process + ops** | Gated on item 1. Ops half is real: every identity is a `visitor` until granted — N × `users grant-access` with caps, and a tier decision. Could be the one **consent-clean-from-turn-one** dataset |
| 25 | India channel; students barred phones/computers in class; at-home 1:1 with async teacher review; possible spin-off | **D4 — note only** | No design doc here. The AIPLA-side work it needs is the **ADR-001 individual-mode revision** already scoped as August items 24 + 27 |
| 26 | New teacher-planning tool for new teachers, with Pieter | **D4 — note only** | ⚠️ Check overlap first: the authoring co-pilot already composes activities from a description, on a shared shell, with [authoring-teaching-framework](authoring-teaching-framework.md) as the pedagogy layer. *"For **new** teachers"* is an audience shift — plausibly a mode and a prompt set on shipped surfaces, not a product |
| 27 | Email/password anti-spam with IT | **Ops** | `users invite-password` exists for teachers whose school has no Google identity. The anti-spam conversation is IT's |

## Transcript revision (2026-09-02)

The [meeting transcript](../../../09-01_Weekly_Meeting_AI_Education_Platform_Data_Compliance_and_Teacher_Feedback-Summary.md)
landed after this triage was written. **The dictated notes were lossy in ways
worth recording**, because the pattern will repeat: what survived dictation was
the *product* discussion, and what was lost was mostly **legal, process and
scheduling** — the half that turns out to gate everything.

### Corrections

| | First pass | Transcript |
|---|---|---|
| **D1** | "Unknown, find out" | **Answered.** Not in place; JB has contacted legal; target **Nov–Dec** |
| **November** | Read as a trial date | It is when **teachers start teaching Physics C**. Trials: *small-scale 2026, broader 2027, pending the agreement* |
| **Researcher view (item 4)** | "Mostly ships, not a build" | **A committed deliverable with M's name on it.** Backend permits it; the surface is missing |
| **Etkina (item 14)** | "⚠️ name unverified" | ✅ **Confirmed** — Eugenia Etkina's Scientific Abilities Framework |
| **"Julie"** | Unknown helper | **Julia, a student at NBI** — a recruitment route, not a collaborator on the tooling |
| **Dysthe / ESRU** | Guessed | Transcript writes "Dyste (authentic questions)" and ESRU — **still not verified citations**, and now joined by **IBSE** and a **"Bob Evans"** persona |

### Missed entirely — eight items

| # | Item | Type | Disposition |
|---|---|---|---|
| 28 | **Teachers find the UI difficult** — *"could be considered a bug"*. Usage analytics needed to find friction points | **New build** | → **[1.1.96](teacher-ui-friction-telemetry.md)**. The most under-weighted item in the meeting: a usability problem reported by the people who have adopted the tool, with **no instrumentation to locate it**. The AI-suggestions section flags that nobody was assigned to it |
| 29 | **Teachers and students writing code directly in the system** — *"a key request"* | **New build** | → **[1.1.97](in-system-code-authoring.md)**. ⚠️ Prior art is misleading: `backend/tools/code_execution/` exists but it is **the model running code**, not a human writing it. Different feature |
| 30 | **Prøvebanken** — legal approval for scraped exam data pending with the Ministry of Education; concern that AI could learn exam patterns. **We hold model-performance results and have decided not to publish them until approval** | **⛔ Second legal blocker — not engineering** | Independent of the Google agreement. Gates part of the [publication](#) and constrains what the capability-floor work can say. JB following up |
| 31 | **Standardising teaching prompts**; the app's character cap (`MAX_INSTRUCTIONS_CHARS = 25_000`) vs long pedagogical content; *"investigate very long teaching prompts and automated summarization"* | **New build** | → **[1.1.98](teaching-prompt-standardisation.md)**. Overlaps 1.1.90 M4 but is broader — a *structure and guideline* for prompts, not only retrieval |
| 32 | **Embodied Cognition as the umbrella theory**, with SDT incorporated; grounded in literature per curriculum level; JB to start, Aswin to supply literature | **Framework — JB's, not engineering** | **But it re-frames [1.1.91](researcher-configurable-tutors.md)**: the personas are not a flat list, they sit under an umbrella. Recorded there |
| 33 | **Persona × activity clash gatekeeper** — e.g. a Socratic activity under a non-Socratic persona. Discussed, *"not designed"* per the AI-suggestions section | **New build — small** | Folded into **1.1.91** as a milestone rather than its own doc |
| 34 | **Gmail login possibly removed** ("convenient but problematic"); email login **banned — IT must add DNS records**; M may initiate | **Ops + a real product decision** | The DNS half is ops. Removing Google sign-in touches teacher auth and the access register, and wants a decision doc **if** it firms up |
| 35 | **System overview documentation** — how the components fit together, with example student and teacher flows; plus *"document differences from existing tools and hosting requirements; link the GitHub repo"*; and **share architecture diagrams + data with Aswin for the paper** | **Documentation** | Not a design doc. A real deliverable with M's name on it, and it overlaps the differentiation research already noted |

### Smaller transcript items, no doc needed

- **Erda platform** capabilities unclear — M to ask Morten
- **Herd app** — background jobs without an active laptop
- **Activity matrix** organised by *Subject Content* × *Activity Type* — a content-organisation scheme for JB/Aswin, and a natural fit for [1.1.95](safe-to-publish-vetting.md) M1's catalogue metadata
- **Recruitment**: NBI students via Julia, university physics first-years, a **December 2026 physics star lecture**
- **JB is applying for funding** for the teacher planning tool — which strengthens D4 (it is a separate programme, not AIPLA scope)
- **M to create a plan for the next few months prioritising compliance and development** — [already written](../v2.1.0-extension/plan-2026-09-to-2027-04.md), and it now needs re-ordering so compliance leads

### What this changes about the plan

**Compliance is not a side-quest; the transcript makes it the lead item**, and
the [extension plan](../v2.1.0-extension/plan-2026-09-to-2027-04.md) was written
before that was clear. Two legal gates, both owned by JB, both targeted at
Nov–Dec, and **both blocking the pilot work that most of these docs serve**.

The honest consequence: **1.1.90–1.1.98 are largely for a classroom that does
not open until 2027**, with small-scale 2026 pilots as the only earlier outlet.
That argues for spending the intervening months on the things that pay off
*without* students — the researcher-facing instruments (1.1.91, 1.1.92), the
documentation deliverables, and the UI friction work (1.1.96), which needs only
teachers.

## The new docs — six, then nine

| # | Doc | Priority | Est | Gate |
|---|---|---|---|---|
| **1.1.90** | [bounded-tutoring-answer-trees.md](bounded-tutoring-answer-trees.md) | **P1** | ~5–7d phased | None to start (M0/M1). D2 taken |
| **1.1.91** | [researcher-configurable-tutors.md](researcher-configurable-tutors.md) | **P1** | ~6–8d | Framework *content* from JB/AR (M5 only); M0–M4 un-gated |
| **1.1.92** | [session-benchmark-tutor-activity.md](session-benchmark-tutor-activity.md) | **P2** | ~3–4d | Consumes 1.1.91. D3: mechanism first |
| **1.1.93** | [uploaded-image-anonymisation.md](uploaded-image-anonymisation.md) | **P1** | ~2–3d | Policy from JB — *what* counts as identifying |
| **1.1.94** | [session-resource-transparency.md](session-resource-transparency.md) | **P2** | ~1.5–2d | Energy-factor source needs choosing |
| **1.1.95** | [safe-to-publish-vetting.md](safe-to-publish-vetting.md) | **P2** | ~2d | None |
| **1.1.96** | [teacher-ui-friction-telemetry.md](teacher-ui-friction-telemetry.md) | **P1** | ~2–3d | None — needs only teachers |
| **1.1.97** | [in-system-code-authoring.md](in-system-code-authoring.md) | **P2** | ~4–5d | Scope decision: who writes code, and where it runs |
| **1.1.98** | [teaching-prompt-standardisation.md](teaching-prompt-standardisation.md) | **P1** | ~2–3d | Prompt *structure* from JB/AR |

**Plus: un-defer [1.1.78](question-set-element.md)** (~4–5d). Not new — it was
gated on having a student date, and item 3 supplies one.

## Still to verify

Three claims in this triage rest on checks that were not completed:

1. **The reports-route ACL (item 5).** Investigation was cut short deliberately.
   Wants a proper security review, not action on a note.
2. **Whether the researcher claim is granted on the environment Aswin uses
   (item 4).** One command answers it and nobody has run it.
3. **"Etkina" and "Dysthe" (item 14)** are phonetic transcriptions with
   confidence recorded, not established citations.

## What this triage deliberately does not do

- **Re-plan the extension.** [The plan](../v2.1.0-extension/plan-2026-09-to-2027-04.md)
  affords ~75 days and roughly two substantial workstreams. Six new docs is
  more than that window can absorb, and **that is fine** — a design doc is not a
  commitment to build. Ordering is a separate decision.
- **Treat November as a fixture.** Per D1 its precondition is unknown.
- **Resolve the pedagogical questions.** Which framework, which rubric, and what
  counts as a good session are AR's and JB's, and the docs are built to accept
  their answers rather than to wait for them.
