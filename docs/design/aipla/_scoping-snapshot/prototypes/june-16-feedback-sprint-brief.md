# Sprint brief: 16 June demo feedback — UX bug-fixes + summary sharing + analytics amendments

**Status:** Part 1 build-ready · Part 2 = amendments to roadmap design docs · Part 3 = captured/not-app
**Source:** 16 June 2026 KUPER demo (processed in `notes/2026-06-16-demo-feedback.md`; raw in
`sources/feedback-2026-06-16.md`)
**Target repo:** `sunholo-data/cphu-aipla-app`
**Companion public docs:** `strands.qmd` (updated 16 June), `june-15-feedback-sprint-brief.md` (prior
brief — this extends its Part 2 design docs)

This is the handoff for the app agent. The 16 June demo was a live run with a research-group audience,
so it's mostly **bug/UX polish** (Part 1) plus a teacher-summary cluster that splits between a distinct
v1.1 sharing feature and R1-gated analytics (Part 2). Three ambiguities were resolved with M and are
tagged inline. **Part 3** is captured but not an app task.

Fixed posts: **23 June bidirectional-voice target** · mid-point review 26 June · holiday freeze
29 June – 5 July.

**JB follow-up (16 June, later):** (1) **demo workbench *breadth*, not Boldkast** — the next demo should
show a *range* of workbench feature types (platform flexibility) over depth on the single projectile
sim; prioritise getting several workbench types demo-ready (item D is a good flexibility piece).
(2) **the "third entity" / permission problem** — students read the AI as an unfamiliar third entity
(not a home chatbot, not their teacher) and are unsure they're *allowed* to ask it; **no one reads the
intro text** (a student Googled a question the bot could answer). New design item **E**.
(3) **calculator → code-execution** for maths (item D broadened).

---

# Part 1 — Build-ready

## 1. SVG flicker during generation

Refines the 3 June SVG-flickering item with a concrete repro: **no flicker when static; flickers *while
generating*** — almost certainly re-renders on the streaming/partial SVG.

**Action:** commit/throttle the SVG render — paint once on completion (or debounce partials) rather than
re-rendering each streamed chunk.

**Acceptance:** an SVG generated inline renders smoothly (single paint on completion or throttled), no
visible flicker during generation.

**Effort:** small.

## 2. Image upload on the workbench surface, not chat

[M, 16 June] The student image/doc upload **affordance and the uploaded image live on the workbench
surface**, not inline in the chat. Rides the existing ADR-008 multimodal upload.

**Acceptance:** a student uploads an image; it appears on the workbench surface; the tutor references it
in chat. The chat surface no longer hosts the upload control/preview.

**Effort:** small–medium.

## 3. Report load latency + summary generation visibility

Two demo observations on the teacher report: it's **slow to load**, and the **summary's generation
timing is opaque** ("working, but *when* is it generating?").

**Action:** add a loading state on the BigQuery-backed report read path; show a **"last generated
<time>"** stamp on the teacher summary plus what triggers a refresh.

**Acceptance:** the report shows a loading state while fetching; the summary shows when it was last
generated and the refresh trigger.

## 4. Demo-code mint/display check

A wrong/stale group code was given out and a new one minted. Likely live-demo human error — **verify**
there's no stale-code bug in `manage-class` mint/display, and that codes are easy to copy/read aloud.

**Acceptance:** minting a group code always yields a fresh, correct, copyable code; no stale code is
surfaced.

## 5. Document the Boldkast deliberate mistake in teacher notes

[M, 16 June] "Simulation has errors and confusing teachers" = the **deliberate** pedagogical mistake
being misread as a bug — **not a code fix.** Add the deliberate mistake (and its pedagogical intent) to
the Boldkast activity's **teacher-facing notes / metadata** so teachers know it's intentional.

**Acceptance:** the Boldkast activity's teacher notes state the deliberate mistake and why it's there.
**Closes the 3 June Boldkast-angle item** ("bug or deliberate?").

---

# Part 2 — Amend / add roadmap design docs

## A. `teacher-analytics-framework.md` (R1) — add: frustration signal + concept-discussion scaffold

[M, 16 June] Fold **both** in as R1-gated signals:

- **Frustration / affect monitoring** in the teacher summary ("no framework for the teacher summary yet
  but put in frustration monitoring"). **GDPR flag:** affect/emotion inference on minors is plausibly
  **special-category processing** — gate on the IP/GDPR review before any instrumentation.
- **Concept-discussion scaffold** — capture/structure the concept-discussion as a teacher-valuable
  signal ("we have no scaffolding … teacher would find this data very valuable"), with a path to
  surface it back to the *student* for **metacognition** ("make them aware of their own thinking").

**Do not instrument before the R1 framework decision** (ICAP+FCI vs CPS+DRA, due before the 29 June
freeze).

## B. New: student-facing summary share (v1.1, teacher-gated)

[M, 16 June — **break out** as a distinct v1.1 feature, not folded into R1.] The teacher can **choose to
share a session summary back to the student** as formative feedback (e.g. the trigonometry-discussion
example). **Teacher-gated, opt-in, not automatic.** Builds on the 3 June "session report with opt-in
student share."

**Where:** extends the session-report surface with a "share with student" action; the student sees the
shared summary in their session view. This is a **sharing/permission** feature, not an analytics
signal — keep it separate from the R1 work so it isn't blocked by the framework decision.

## C. `bidirectional-voice-brief.md` — add: TTS opt-in default

[M, 16 June] "No audio out was used" + "voice output gets annoying quickly" → **TTS should be opt-in**
(or per-persona), not pushed. Fold into the 23 June voice brief alongside the latency budget (added
15 June). Voice on/off and voice choice live naturally in the **selectable-personas** set.

## D. `workbench-types.md` — add: computational tool (calculator + code execution)

[JB follow-up] More than a four-function calculator: a **computational tool** for maths. JB: "a
calculator, or we add **code-execution tools to help with maths**." **Scope: both** [M, 16 June] —
1. **AI-side** — the tutor calls a **sandboxed code/maths-execution tool** to compute or check a
   student's working. Also strengthens the "tutor knows when the answer is correct" signal seen in the
   demo.
2. **Student-facing** — a calculator / compute surface on the workbench.

Add both to the workbench-type catalogue. **Sandboxed execution is a new security surface** — sits under
the [ADR-013](../../architecture.qmd) content-review / sandbox posture and likely warrants an
architecture note (the AI-side tool is an MCP tool; the student surface is a workbench artefact). Also a
strong **flexibility demo** piece (see the breadth steer).

## E. Role / permission framing & in-flow onboarding (new design item)

[JB follow-up] Students treat the tutor as an unfamiliar **third entity** — neither a casual home
chatbot nor their teacher — and are **unsure they have permission to ask it**. Intro text goes unread.
Design onboarding so the bot's role and an explicit **"you can ask me anything"** permission land
**in-flow**, not as text to read:

- the **teacher frames it** at session start (a one-line script / on-screen prompt);
- the **bot invites** early and low-stakes ("ask me anything about this — I'm here to help you think,
  not to grade you");
- **example prompts / the ask affordance are discoverable at the point of need** — the Google reach is
  the failure case.

Pairs with the **call-teacher** button (escalation to the *authority* entity) and the **not-a-sycophant
persona**. Not a heavy build — copy + placement + a first-run nudge. Research angle: does explicit
permission framing change uptake?

---

# Part 3 — Captured, not an app task

- **Research-recording quality** — "~183 min recorded — recordings to be improved" is the research
  *recording* (input) quality, a **research-ops item for JB/AR** (couples to the audio-capture path if
  that's the source), not an app build task.
- **Research observations** (design/research threads, captured in the note, not sprint items): the
  bot-vs-teacher relationship and *permission* framing; students reaching for Google instead of the
  tutor (**discoverability**); Danish/English onboarding friction; the deliberately under-framed task;
  home use + less-confident students. The discoverability and onboarding-friction points may later
  become small UX tweaks (make the tutor's role visible at the point of need; consistent first-run
  language) — flagged, not committed.

---

## Suggested sequence

1. **Part 1 #1 (SVG flicker) + #2 (image on workbench)** — small, visible, build-ready now.
2. **Part 1 #3 (report loading + summary stamp) + #4 (demo-code check)** — UX polish.
3. **Part 1 #5 (Boldkast teacher-note)** — doc-only; closes a long-open item.
4. **Part 2 C (TTS opt-in)** in the 23 June voice push — the date forces it.
5. **Part 2 B (student-facing summary share)** — distinct v1.1, *not* R1-blocked.
6. **Part 2 A (frustration + concept-discussion)** waits on R1 (29 June) **and** the GDPR review.
7. **Part 2 D (computational tool — both AI-side + student-facing)** — scope confirmed (both); bumped by
   JB's flexibility-demo steer.
8. **Part 2 E (permission framing / in-flow onboarding)** — light (copy + placement); high leverage on
   the third-entity problem.
