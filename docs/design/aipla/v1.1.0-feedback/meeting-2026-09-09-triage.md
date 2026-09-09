# 9 September 2026 meeting — repo-side disposition map

**Status:** Triaged 2026-09-09. Source record: [notes-2026-09-09.md](../../../notes-2026-09-09.md).
**Nature:** A **working meeting**, unlike the [1 September](meeting-2026-09-01-triage.md) direction-setting one. Three defect reports, one strategic answer, one calendar, and the arrival of the pedagogical content the 1 September batch was designed to accept.
**Decisions taken by M, 2026-09-09:** D5–D8 below, continuing D1–D4.
**No transcript yet.** The 1 September pass learned that the dictated notes lose the legal and scheduling half of a meeting; if a transcript lands, re-read this against it before trusting the [dates](#dates-and-what-they-gate).

## Summary

**The meeting answered the biggest open question in the extension plan and
nobody flagged it as a decision.** Workstream D — the discipline layer, ~25 of
75 days, the strategic bet — was written as *four candidates, choose in
November*. *"Go on doing tutors now"* chooses. **D7** records it, because a
choice made in passing is the kind that gets re-litigated in January.

**The content arrived the same morning.** Seven teaching-practice frameworks
with their primary literature are now at
[`docs/literature/tp-framework/`](../../../literature/tp-framework/README.md).
That closes two of the three items the 1 September triage left in *Still to
verify*: **ESRU is Ruiz-Primo 2006** and **Dysthe is the 1996 *Multivoiced
Classroom***, both with a PDF. Only the reports-route ACL remains open from
that list.

**Three defects. One was fixed before the notes were written up** (`ae2fcb3`,
the table the tutor could not see). One is a **suspected regression on a fix
that shipped a month ago** ([opening-knows-the-lesson](opening-knows-the-lesson.md),
SHIPPED 2026-08-10 against the identical complaint from the same reporter).
One is genuinely new — a persona that will not stop talking.

**The sharpest finding is that a bug report and a feature request are the same
item.** *"No chat history persisted, `busy-garden-11` with 4 activities"* and
*"we will add a feature to let chat history across activities be shared"* are
the two ends of `db/group_sessions.py` keying a conversation per
`{group_id}:{activity_id}`. Triaging them separately would produce an
investigation into behaviour that is working exactly as designed, and a feature
built without noticing it reverses a deliberate decision. → **[1.1.103](cross-activity-conversation-continuity.md)**, **D5**.

**Three new docs, not ten.** Most of what was raised extends something already
written — and the extensions matter more than the new docs. 1.1.91 gains a
library, a calibration corpus and an audience it did not have; 1.1.82 gets its
second independent request and a citation.

## Decisions taken (M, 2026-09-09)

**D5 — Cross-activity history is a CARRIED DIGEST, not a merged transcript.**
The tutor entering activity B is told what the group established in activity A —
concepts covered, checklist progress, a short summary with provenance — while
each activity keeps its own session and its own transcript. **Rejected: merging
the sessions.** Three reasons, in order of how much they cost:

1. **It reverses ALS-1 on purpose-built ground.** The per-activity key exists
   because a group runs many activities and *"each with its own conversation"*.
   The first-wins write in `set_active_session_for_group` was added to close a
   real clobber bug that orphaned a conversation with all its history.
2. **It breaks attribution, which is the discipline layer's whole product.**
   [1.1.92](session-benchmark-tutor-activity.md) grades *tutor × activity*. A
   transcript spanning four activities has no cell in that matrix, and
   rubric-scored logs as assessment evidence is the named strategic bet.
3. **The context budget cannot hold it.** `MAX_INSTRUCTIONS_CHARS = 25_000` and
   every character is re-sent every turn ([1.1.98](teaching-prompt-standardisation.md)).
   Four activities of transcript is not a prompt, it is a corpus.

The digest is also the honest answer to the *report*: a student who did not see
their history was seeing correct behaviour with no explanation. Continuity the
student can **see** is half the fix and costs almost nothing.

**D6 — A sim import is a REVIEWED PIPELINE, not an upload button.** The
artefact arrives as a file, the ADR-013 gates run **mechanically** (size cap, no
external fetches, sandbox flags, CSP), and a human approves before it is
served. **Rejected: self-serve publish**, because an artefact runs in an iframe
in front of a classroom and ADR-013's gates were written for exactly the
material this path now invites. **Also rejected: doing nothing** — the current
path is a git clone and a PR, and the evidence it does not work is that a
researcher was handed a repo zip in this meeting. → **[1.1.104](simulation-import-pipeline.md)**

**D7 — Workstream D is the tutors. Chosen 2026-09-09, not deferred to November.**
[1.1.91](researcher-configurable-tutors.md) plus its consumer
[1.1.92](session-benchmark-tutor-activity.md), seeded from the seven TP-framework
folders. What makes this safe to decide early rather than premature: the
extension plan's stated reason for waiting was *"decide in November, once B has
established whether AD can carry part of it"* — and that reasoning applies to
**C3 concept-map student models**, the speculative candidate, not to the tutors.
The tutors have their literature, a named requester, and no legal gate. The
[extension plan](../v2.1.0-extension/plan-2026-09-to-2027-04.md) is updated to
match rather than left to disagree quietly.

**D8 — Student-authored activities get NO design doc yet.** Same discipline as
D4. The ask — *can students make their own activity where they design their own
experiments* — is a **third** audience on top of the two
[1.1.97](in-system-code-authoring.md) already cannot choose between, and it runs
straight into ADR-001: an anonymous group has no identity to own an authored
artefact with, no way to be credited, and its work is erased with the group code.
That is the **ADR-001 individual-mode revision** already scoped as August items
24 + 27, and it should be answered once rather than three times. Recorded as an
open question against 1.1.97, not a doc.

## Disposition map

| # | Item | Type | Disposition |
|---|---|---|---|
| 1 | Gave Aswin the GitHub repo so he could download the zip for his document materials | **Process — and evidence** | Fine as a one-off. It is also the clearest available evidence for D6: the supported route for getting material in and out of the platform ran through a repo zip |
| 2 | AI does not see the table entries by a student | **FIXED SAME DAY** | `ae2fcb3` — the tutor read `mcp_app_context.table.state` (the client's pushed mirror) rather than the `table_progress/{group}:{activity}` store [1.1.88](group-shared-table.md) made authoritative on 08-31. Three failure modes closed: the blur commit race, the never-opened workbench tab (empty mirror renders EMPTY, which `mark_checklist_item` then refuses against), and counts-without-values. `None` (unreadable) and `{}` (read, empty) kept distinct — the reassuring answer is the one a broken read produces. **Confirm with Aswin on a fresh session**; do not close on the commit alone |
| 3 | No chat history persisted — `busy-garden-11`, 4 activities | **Not a defect — the design, reported as one** | → **[1.1.103](cross-activity-conversation-continuity.md)** with item 10, per **D5**. `_doc_key` is `{group_id}:{activity_id}`, so four activities is four conversations and each is intact in its own session. ⚠️ **Verify before accepting this explanation** — the same group's logs produced three real defects this week, and "working as designed" is exactly the conclusion a second bug would hide behind. The check is one read of `group_sessions` for the four `busy-garden-11:*` docs: four active mappings means the design; fewer, or archived ones, means something else |
| 4 | Request for more simulations; Aswin has a kettle sim built on claude.ai he wants imported | **New build** | → **[1.1.104](simulation-import-pipeline.md)**, **D6**. The missing middle rung between [sim-catalogue-admin](sim-catalogue-admin.md) (metadata for already-deployed code) and [2.4 teacher-artefact-authoring](../post-pilot/teacher-artefact-authoring.md) (write the code in-product). Everything downstream exists — artefact layout, ADR-013 gates, `aiplatform sim scaffold`, the deploy trigger |
| 5 | Can students make their own activity where they design their own experiments? | **D8 — open question, no doc** | Recorded against [1.1.97](in-system-code-authoring.md). Blocked on the same ADR-001 revision as August items 24 + 27, not on engineering |
| 6 | How much do we give to students — Claude Code | **Open question** | Two questions in one: *capability* (D8 / 1.1.97) and *cost per seat* (item 8). Neither is answerable today |
| 7 | 100,000 DKK on cloud costs | **✅ ANSWERED same day → analysed** | M: *"We have 100,000 for cloud costs for the project."* A **project budget** — ≈ **€13,400** at the DKK/EUR peg (7.46, reliable in a way a USD conversion is not). → **[1.1.106](cloud-cost-envelope.md)**. **The analysis matters less than what it found:** the envelope is comfortable — at the platform's default Flash tier a turn costs ~$0.004, the whole 08-21 pilot cost ~$1.50, and the entire envelope is on the order of three million turns — so **inference is not what will consume it; the always-on infrastructure across three environments is, and nothing has ever measured that.** ⚠️ **Three of the four spend controls are sized above the budget** (the Vertex daily ceiling permits ~€2,500/mo by its own comment; the programme daily-budget ceiling permits ~€14,000/mo), which was the right posture against *abuse* and was never compared with this number. And **the billing budget is committed in `spend_ceiling.tf` but enabled in none of `dev/test/prod.tfvars`** — so the only control that would report spend against the envelope is off. ⚠️ **Period still unstated**; it changes the monthly rate 4.5× but not the conclusion |
| 8 | Costs for a Claude-Code-lite per student vs teachers | **Analysis — DONE for the platform half** | → **[1.1.106](cloud-cost-envelope.md)** M1. The platform half is answered: **a student seat at the default tier rounds to nothing** against €13,400. ⚠️ **The agentic-coding half must not be estimated from these numbers** — it is a per-seat licence on a different vendor's rate card, i.e. a *procurement* question, and conflating the two would make an affordable platform look like it settles an unrelated purchase. Recorded so they stay separate |
| 9 | Self-hosting models — Morten follow-up | **Ops + decision A5** | Continues 1 September's *Erda platform — M to ask Morten*. Feeds [self-hosting-and-terraform-handover](../v2.0.0-handover/self-hosting-and-terraform-handover.md), whose *"do not execute the migration"* non-goal is under review, and **decision 5** of the extension plan, due October |
| 10 | Share chat history across activities | **New build** | → **[1.1.103](cross-activity-conversation-continuity.md)**, **D5** — carried digest, not merged sessions. Same item as 3 |
| 11 | Tutor always opens with *"what do you want to learn today"* despite learning goals in the prompt | **⚠️ SUSPECTED REGRESSION on a shipped fix** | [opening-knows-the-lesson](opening-knows-the-lesson.md) is SHIPPED 2026-08-10 (PILOT-1) against this **exact complaint from this exact reporter** — its Source line quotes it. So this is not a new ask and must not be re-designed. Two candidate causes, both cheap to distinguish: no `ActivityConfig` resolved at greet time, or a greet path that bypasses `inject_opening_guidance`. **A shipped fix silently reverting is the [footgun class](../../../../CLAUDE.md) this repo keeps a table for** — whatever the cause, it ships with an eval, since the unit tests evidently pass |
| 12 | Sophia persona keeps talking when the conversation is over | **New build — small** | → **[1.1.105](tutor-turn-taking-and-closure.md)**. "Sophia" is a teacher-authored persona name — no `sophia` string exists in the repo — so this is a **prompt-contract gap on every tutor**, not one persona's bug. `interaction_style`'s four options govern *how much* is said, and nothing governs *when to stop*. It is also the first item in the dialogue cluster (items 13–16) that is actionable today with no research input |
| 13 | In-house dialogue session — Jens, Line, Bob; bot style and turn-taking; Bloom higher vs lower order; Dysthe invitation/uptake/focus; structured assessment dialogue; *Transforming Assessment* table 5.6 | **Research input — feeds 1.1.91** | Not engineering. **The output to ask for is the one 1.1.91 M0 consumes**: framework → constructs → *observable behaviours*. A code set for describing dialogue (table 5.6) is precisely that shape, which makes it the most directly usable thing named in this meeting. ⚠️ Table 5.6 is **unverified** — see Terms I inferred |
| 14 | ESRU / Ruiz-Primo — elicit, student response, recognise, use — *"be good to have a tutor like this"* | **✅ CITATION CONFIRMED → 1.1.91 M5** | Ruiz-Primo & Furtak 2006, J Res Sci Teach, **PDF on disk**. Retires the 1 September *"medium confidence"* flag. Note the notes say *"revoicing"* where the framework says *"recognise"* — revoicing is the classroom move, and the distinction is the kind of thing M0's structured form has to preserve rather than flatten |
| 15 | Self-Determination Theory tutor from Aswin's material | **→ 1.1.91 M5** | ⚠️ **SDT is deliberately NOT in the TP-framework working set** — the literature README puts SDT and embodied cognition in the *conceptual framework* (research perspective), not the teaching-practice cycle. So this is a tutor built on a different layer of theory, and 1.1.91's structured form must be able to say which layer a tutor sits on. Consistent with 1 September item 32 (embodied cognition as umbrella, SDT inside) |
| 16 | What is a Socratic bot actually? Definition | **Research question — and a live product problem** | The sharpest possible statement of 1.1.91's premise. `interaction_style` ships `socratic` as **one of four tone adjectives**, alongside `concise`, `rigorous` and `warm` — so the product already claims to do Socratic teaching, with no definition behind the claim and nothing that could check it. Answering the question is AR's/JB's; **making the answer expressible** is M0 |
| 17 | TP Framework — POE; *"a tutor for each of these folders"*; they have **examples of conversations** | **→ 1.1.91 M5 + 1.1.92 M3** | **The size of M5 is now known: seven.** 5E, Accountable Talk, Authentic Dialogue, CER, ESRU, POE, Toulmin. And the **example conversations are the more valuable half** — [1.1.92](session-benchmark-tutor-activity.md) M3 calibration has no ground truth, which is where *"LLM as a judge — models rate highly"* bites. Worked dialogues in a framework's own terms are calibration data. **Ask Aswin for the conversations explicitly**; they are not in the Drive folder that was copied |
| 18 | Student makes a claim, the warrant is given, data found via the experiment sim | **ALREADY DESIGNED — un-defer** | **[1.1.82 argumentation-element-toulmin](argumentation-element-toulmin.md)**, written 2026-08-25 from M's own 17 August notes and unscheduled since. **Second independent request**, now with a citation (Erduran, Simon & Osborne 2004, on disk) and a named data source — the sim. Do not redesign; re-rank |
| 19 | Teachers can use the tutors as teaching training | **New audience — no new build** | A genuinely new use with almost no new engineering: it is [1.1.91](researcher-configurable-tutors.md) M3 (preview/compare) pointed at a **teacher studying how a tutor teaches** rather than at a configuration screen. Recorded in 1.1.91. It also makes the seven-tutor library valuable before a single student uses it, which matters while both legal gates are shut |
| 20 | **Go on doing tutors now** | **⭐ STRATEGIC DECISION — D7** | Answers the extension plan's largest open allocation. Recorded in the plan, not just here |
| 21 | Ask the teachers to contribute and activate them; examples of teaching in different areas at work | **Process → JB** | Continues 1 September items 17/19. The repo-side enabler is [1.1.95 safe-to-publish-vetting](safe-to-publish-vetting.md) — *"flood with examples"* scales through teachers publishing to each other, and the blocker is confidence, not capability |
| 22 | If we move away from Google login then we @gmail.com | **Product decision — not yet firm** | 1 September item 34. Still *"if"*. Touches teacher auth and the email-keyed access register (the register matches on the exact sign-in address, with no dot or plus folding — an address that is not the Google identity matches nobody and looks fine in `users list-access`). Wants a decision doc **if** it firms up, not before |
| 23 | kunet.ku.dk — Serviceportal Sal — create ticket | **Ops — actionable now** | The concrete action missing from 1 September items 27/34. → **M** |
| 24 | Atharva sending an approach for avoiding Firebase emails going to spam | **Awaiting input** | Unblocks `users invite-password` for teachers with no Google identity — the flow ships, deliverability was always the blocker |
| 25 | Went over the competitor analysis — Khan Academy | **DONE SAME DAY** | [aswin-paper-materials.md](../v2.0.0-handover/aswin-paper-materials.md) closes 1 September item 35; `3a2585c` split Khan Academy's base platform from Khanmigo after this discussion — two different comparisons, and AIPLA competes with neither on its own axis |
| 26 | Oct 6 Aswin presentation · Oct 5 Daniel presentation · JB away Oct 7–15 · teacher review 25/27 Nov or 2/4 Dec | **Calendar — see below** | → [Dates and what they gate](#dates-and-what-they-gate) |

## Dates, and what they gate

| Date | What | Consequence |
|---|---|---|
| **2026-10-05** | Daniel presentation [?] | ⚠️ **Unresolved whether "Daniel" is AD**, who starts ~1 Oct. Resolve before scheduling against it |
| **2026-10-06** | Aswin presentation on teachers | — |
| **2026-10-07 → 10-15** | **JB away** | ⚠️ **Overlaps AD's first fortnight.** Workstream B (AD onboarding, ~8 days, *"the highest-leverage workstream in the plan"*) assumes pairing on real work; a week without the project lead is a poor first week. Book around it |
| **2026-11-25 / 27 or 12-02 / 04** | **Teacher review** — pencilled | **This is the date [1.1.78](question-set-element.md) was gated on.** The extension plan: *"if there is no classroom date by end of October, it does not earn 5 of 75 days."* It is a **teacher** date, so **neither legal gate touches it** — the question-set element's exit ticket, self-assessment and AI-performance survey can all be exercised by teachers before a student ever sees them |
| **Nov–Dec 2026** | Google data agreement targeted (JB) | Unchanged. Now shares a calendar window with the teacher review |

**The scheduling consequence worth stating plainly:** a pencilled teacher date
in late November un-defers 1.1.78, and 1.1.78 is ~4–5 days. Workstream D was
just committed at ~25 days by D7. The plan's unallocated slack was already
*"thin, ~11 days — the first thing to protect if anything slips."* **Confirm the
teacher date before treating 1.1.78 as scheduled**; pencilled is not booked.

## The new docs — three

| # | Doc | Priority | Est | Gate |
|---|---|---|---|---|
| **1.1.103** | [cross-activity-conversation-continuity.md](cross-activity-conversation-continuity.md) | **P1** | ~2–3d | None. **D5** taken |
| **1.1.104** | [simulation-import-pipeline.md](simulation-import-pipeline.md) | **P2** | ~3–4d | None. **D6** taken |
| **1.1.105** | [tutor-turn-taking-and-closure.md](tutor-turn-taking-and-closure.md) | **P2** | ~1–1.5d | None to start; the dialogue session (item 13) sharpens M1 |

**Plus one re-rank, no new doc:** [1.1.82 argumentation-element-toulmin](argumentation-element-toulmin.md)
(~3–4d) now has two independent requests and its citation on disk.

**Plus one investigation, not a doc:** item 11, the greeting regression. If it
reproduces it is a fix on a shipped surface, and it ships with an eval.

## What extends an existing doc rather than earning a new one

Recorded explicitly, because "we discussed it and no doc appeared" is
indistinguishable from "we forgot":

| Item | Where it went |
|---|---|
| Seven framework tutors; SDT's different layer; the "what is Socratic" gap; teachers-as-trainees | [1.1.91](researcher-configurable-tutors.md) — M5 sized, M0 given a layer distinction, M3 given a second audience |
| Example conversations as calibration data | [1.1.92](session-benchmark-tutor-activity.md) M3 |
| Claim / data / warrant from the sim | [1.1.82](argumentation-element-toulmin.md) — second request, citation added |
| Per-seat cost forecast | [1.1.94](session-resource-transparency.md) — noted as the sibling question its data serves |
| Student-authored activities | [1.1.97](in-system-code-authoring.md) — open question, per **D8** |
| *"Go on doing tutors now"* | [extension plan](../v2.1.0-extension/plan-2026-09-to-2027-04.md) — workstream D |

## Still to verify

1. **The `busy-garden-11` session mappings** (item 3). The per-activity
   explanation is a hypothesis until someone reads the four
   `group_sessions/busy-garden-11:*` docs. **The reassuring answer is the one a
   real second bug would also produce.**
2. **The greeting regression** (item 11). Not reproduced. It contradicts a fix
   with a passing test suite, which means either the test or the deployment is
   lying.
3. **Whether the table fix satisfies the reporter** (item 2). Shipped this
   afternoon; not confirmed against a live session by Aswin.
4. ***Transforming Assessment* table 5.6** (item 13) and **the Dysthe
   invitation/uptake/focus triple** — phonetic, unverified, and the sort of thing
   that becomes a citation in a journal paper if nobody checks it.
5. ~~What the 100,000 DKK figure is~~ **ANSWERED — a project budget.** What remains is **over what period** ([1.1.106](cloud-cost-envelope.md) open question 1) and — the sharper one — **whether the Vertex quota override is actually applied**: it is set by a script rather than Terraform, and that script exists because a wrong `base_model` dimension applies to nothing and still exits 0. `make check-spend-ceiling ENV=prod`.
6. **Whether "Daniel" is AD** (item 26).

Carried forward, still open from 1 September: **the reports-route ACL**
(`GET /api/reports/{sessions,groups}/…` bind the caller as an unused `_user`).
Seven days old and untouched. It is the only item on either *Still to verify*
list where the failure mode is a data exposure rather than a wrong plan.

## What this triage deliberately does not do

- **Re-open D4.** Nothing commercial appeared today; the discipline held.
- **Design student-authored activities.** D8. It is an ADR-001 question wearing
  a feature's clothes, and answering it three times in three docs is how the
  individual-mode question has already been deferred twice.
- **Treat the teacher review date as booked.** It is pencilled, with two
  alternative weeks.
- **Close item 2 on the strength of the commit.** The reporter has not seen it.
