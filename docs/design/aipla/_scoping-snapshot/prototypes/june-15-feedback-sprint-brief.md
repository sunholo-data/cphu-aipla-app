# Sprint brief: 15 June feedback — call-teacher + roadmap design-doc amendments

**Status:** Part 1 build-ready · Part 2 = amendments to existing/planned roadmap design docs
**Source:** 15 June 2026 meeting (processed in `notes/2026-06-15-teacher-feedback.md`; raw in
`sources/feedback-2026-06-15.md`)
**Target repo:** `sunholo-data/cphu-aipla-app`
**Companion public docs:** `strands.qmd` (updated 15 June), `june-09-feedback-sprint-brief.md` (prior
brief — this extends its Part 2 design docs), `architecture.qmd` (new ADR-016)

This is the handoff for the app agent. 15 June was mostly downstream of the 9 June framing, so most of
it **amends design docs already on the roadmap** rather than opening new ones. **Part 1** is the one
genuinely new build-ready item. **Part 2** lists the precise amendments to make to each roadmap design
doc. **Part 3** is captured but not an app task.

Fixed posts: demo 16 June · **23 June bidirectional-voice target** · mid-point review 26 June · holiday
freeze 29 June – 5 July.

---

# Part 1 — Build-ready (new)

## 1. "Call teacher" button

A student can **escalate to a human teacher mid-session**. New v1.1 ask, confirmed near-term [M, 15
June].

**Student side:** a control in the chat surface ("Call teacher" / raise hand) the student taps when
stuck or wants a human. Sends a signal, not a message thread.

**Teacher side:** a **"raised hand" signal in the live class view** — the teacher needs somewhere to
see the call land. This couples to the live class-summary dashboard (Part 2, doc D): the same
teacher-facing live surface hosts both the rolling summary and incoming calls. If the live dashboard
isn't built yet, ship a minimal raised-hand list first; don't block the button on the full dashboard.

**Where:** chat-surface control (student-role); a signal on the teacher live view (teacher-role).
Rides the existing role model ([ADR-015](../../architecture.qmd) / [ADR-016 researcher tier]).

**Acceptance:** a student taps "Call teacher"; a teacher viewing that class sees the group's raised
hand appear in near-real-time with the group code and activity.

**Effort:** ~1d for the minimal raised-hand version (button + signal + teacher list). Full dashboard
integration follows doc D.

## 2. Mobile performance pass

Teachers flagged **mobile performance** (distinct from the mobile *layout* already shipped). Students
share a single phone, so load/response time on mobile is a usability gate.

**Action:** profile the student app on a representative low-mid Android phone; identify the worst
offenders (bundle size, first-load, time-to-first-token render, workbench iframe load). This is an
**investigation → targeted fixes**, not a feature. Report findings before committing fixes.

**Acceptance:** a profiling note with the top 3 mobile bottlenecks and a fix proposal for each.

---

# Part 2 — Amend these roadmap design docs

These extend the Part 2 design docs from the 9 June brief. **Amend in place** when writing/revising
each doc:

## A. `teacher-activity-authoring.md` — add: teacher chooses RAG inputs

15 June sharpened this with an explicit teacher control: when authoring an activity, the teacher
**selects which sources feed it** (the activity's RAG inputs) — from the A/B/C curriculum library and
their own uploads. **Amend** the doc to make source-selection a first-class part of the authoring
flow: which curriculum PDFs / uploads are in scope for *this* activity, surfaced as a selectable set,
not a global corpus. Resolve how per-activity RAG scoping maps onto the pgvector store ([ADR-010]).

## B. `bidirectional-voice-brief.md` — add: audio-latency budget

15 June raised **audio latency** as a concrete concern. **Amend** the voice brief (still 23 June
target) to add an explicit **latency budget** (target p50/p95 for round-trip voice) as an acceptance
criterion, and make the STT+TTS-vs-streaming-Live-API decision partly *on latency grounds*. Mobile is
the worst case — coordinate with Part 1 #2.

## C. `teacher-analytics-framework.md` (R1) — add: live 5-min class summary + call-teacher surface

Teachers **want a rolling class-level summary during the lesson** (~every 5 min) — confirmed wanted,
not a stressor [M, 15 June]. This is the live teacher dashboard. **Amend** the analytics-framework doc
to spec it as an R1-gated deliverable: the rolling-summary cadence, what it summarises (engagement /
DRA coverage / who's stuck), and that the **same live teacher surface hosts the "raised hand" calls**
from Part 1 #1. **Do not instrument before the R1 framework decision** (ICAP+FCI vs CPS+DRA, due
before the 29 June freeze).

> Note: the **researcher role** that kept recurring is now closed in architecture, not a design-doc
> task — see `architecture.qmd` **ADR-016** (researcher = permission tier above teacher; cross-class,
> cross-teacher; no PII consequence under anonymous group IDs). Implement against that ADR when the
> teacher-permission sprint lands.

---

# Part 3 — Captured, not an app task

- **Scenario-didaktik bot** (teacher uploads a teaching plan/PDF → bot gives feedback): a **separate,
  non-AIPLA engagement** [M, 15 June]. Tracked in the note as a spin-off; **no AIPLA build or spec**.
- **"Most teachers use AI via CoPilot through school IT":** a distribution/positioning reality for JB,
  not an app change. Captured in the note for the strategy thread.
- **Research observation** (weaker students use AI worse, but active learning lifts some): evidence for
  the deliberate-friction bet; pilot research angle, not a sprint item.

---

## Suggested sequence

1. **Part 1 #1 (Call-teacher, minimal raised-hand)** — small, new, build-ready now; demo-friendly.
2. **Part 2 B (voice latency)** in the 23 June voice push — the date forces it.
3. **Part 1 #2 (mobile-perf profiling)** — investigate before/around the demo feedback.
4. **Part 2 A (RAG-source selection)** folds into the teacher-authoring doc next.
5. **Part 2 C (live summary)** waits on the R1 decision (29 June); build the call-teacher surface it
   shares first.
