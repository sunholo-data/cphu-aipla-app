# Sprint brief: 9 June teacher feedback — v1.1 refinements + new design docs

**Status:** Ready for sprint planning (Part 1) / design-doc kickoff (Part 2)
**Source:** 9 June 2026 teacher session (processed in `notes/2026-06-09-teacher-feedback.md`)
**Target repo:** `sunholo-data/cphu-aipla-app`
**Companion public docs:** `strands.qmd` (scope, updated 9 June), `june-03-feedback-sprint-brief.md` (prior brief — several items here extend it)

This is the handoff for the app agent. **Part 1** is build-ready and extends the 3 June brief.
**Part 2** lists the larger items that need their own design doc *before* they're sprintable — these
are the new roadmap design docs to write next. **Part 3** is captured but belongs elsewhere (Strand C
scoping / analytics framework / Year-2), not an app sprint.

Framing from the session: **teachers barely use AI today and are anxious about written-assessment
integrity.** Most asks below are downstream of those two facts — especially the deliberate-friction
thread. **Formative is the explicit focus** (what to do *next*), summative secondary.

---

# Part 1 — Build-ready (extends the 3 June brief)

## 1. Multimodal upload: no-person-in-frame guardrail + units loop

Extends 3 June brief **#7 (student image/document upload)**. Two additions confirmed 9 June.

**Guardrail — uploads are for no-person-in-frame material.** The privacy concern is *only* when a
person is in frame; physics diagrams, graphs, and notes are low-risk. This keeps the upload feature's
consent profile low.
- Pre-upload notice on the upload control: "Photograph your work — diagrams, graphs, notes. Don't
  include people in the picture."
- Guardrail check: run a lightweight person/face detection on upload; if a person is detected, block
  the send and prompt a retake ("Looks like there's a person in this photo — please reframe to just
  your work"). Confirm the detection approach with M (GDPR) — a Gemini vision pre-check vs an on-device
  check have different data postures.

**Units loop (tutor behaviour).** When a student uploads a graph/figure, the tutor asks for the
missing rigor rather than accepting it — canonical example: **"What are the units?"** → student
re-uploads corrected. Prompt-level; add to the upload-handling instructions in the skill prompts.

**Where:** frontend upload control + a guardrail hook in the multimodal message path; skill prompt
preambles for the units-loop behaviour.

**Acceptance:** uploading a photo containing a person is blocked with a retake prompt; uploading a
hand-drawn graph with no axis units triggers a tutor question about units before any other feedback.

**Effort:** ~1d (guardrail) + ~2h (prompt). Depends on 3 June brief #7 landing first.

---

## 2. No-laptop end-of-class notes summary

Extends upload (**#7**) + exit ticket (**3 June brief #8**). Reflects the reality that many classes
run with **no laptops** — students take handwritten notes.

**Flow:** at the end of class, the student photographs their handwritten notes → AI ingests them
(multimodal) → returns a **summary measured against the activity's learning goals** (what they
captured, what they missed, one thing to revisit). Works on a single shared phone.

**Where:** triggered from the exit-ticket / session-end flow; reuses the multimodal upload path and
the activity's DRA/learning-goal set.

**Acceptance:** at session end, a student can upload a photo of notes and receive a summary that
explicitly references which of the activity's learning goals are/aren't evidenced in the notes.

**Effort:** ~1d on top of #1 and the exit ticket.

---

## 3. Selectable tutor personas

The interaction style is **one of several presets a teacher (and optionally a student) chooses per
activity** — *not* a base-prompt change. The Socratic-questioning default stays; these are additional
options. (This resolves the apparent conflict with the "every message ends with a question" rule from
the 3 June brief — that rule is the Socratic preset, not a global law.)

**Preset set (AR signs off on each persona's prompt):**
- **Socratic** (default) — current behaviour: short, question-ending, leaves room to notice.
- **Concise / directive** — chummy but **not a sycophant**, very concise, **no follow-up questions**,
  prescriptive: "just try this."
- **Rigorous / exam-level** ("hardcore") — does **not** soften or over-scaffold; holds the student to
  exam-level expectations. Pairs with the deliberate-friction principle.
- **Warm** — encouraging, more scaffolding (for lower-confidence students).

**Where:** a `persona` field in the activity/skill config (teacher activity config UI); the field
selects which preamble variant is composed into the system prompt. Stretch: expose the picker to the
student in-session.

**Acceptance:** a teacher sets `persona: concise` on an activity; a test session produces terse,
directive, no-follow-up responses. Switching to `socratic` restores question-ending behaviour. AR has
signed off on each preset's prompt.

**Effort:** ~1d (config field + prompt variants + picker). Prompts gated on AR sign-off.

---

# Part 2 — Needs a design doc first (new roadmap docs to write)

These are bigger or have open decisions; sprinting them without a design doc will churn. Each is a
design doc to write next — listed with what it must resolve.

## A. Teacher activity authoring + curriculum library (extends an already-flagged doc)

The 3 June brief already flagged "teacher activity creation from scratch" as needing a separate design
doc. 9 June adds two concrete requirements:
- **Referenceable curriculum-PDF library**, organised by **stx level (A / B / C)** — sourced from
  common curriculum material (uvm.dk) — that teachers can cite when authoring, plus their own uploads.
- **AI co-designs the missing workbench elements** around the equipment a teacher already has ("we have
  X in the lab but are missing Y").

→ **Design doc:** `teacher-activity-authoring.md` — must resolve: the authoring flow, how the curriculum
library is stored/indexed/referenced (RAG over the A/B/C corpus), the co-design interaction, and how
this relates to the Parameters tab (which must expand well beyond "bounded knobs").

**Source material in hand (AR, 9 June):** the A/B/C læreplan + vejledning corpus AR supplied
(`sources/Re__AIPLA_check-in/`). A-level is already translated (`sources/curriculum/`); **B and C
still need parsing/translation**. This is the curriculum library's RAG source. See
`notes/2026-06-09-AR-followup-curriculum-experiments.md`.

## B. Offline-lab workbench (new activity type)

The lab experiments teachers actually use today (Haka Fysik / matematikfysik.dk) are PDFs, not
interactive. The wanted pattern: **teacher sets up the experiment, students run it offline and enter
their measurements, the AI checks the entered data for mistakes in chat** — keeping the experiment
hands-on while the AI catches errors.

→ **Design doc:** `offline-lab-workbench.md` — must resolve: the data-entry workbench surface, how the
AI knows the expected values/ranges (per-experiment ground truth, anti-hallucination), and the
error-flagging chat behaviour. Adjacent to `lab-troubleshoot-config` and the workbench-type expansion.

**Source material in hand (AR, 9 June):** Erik Vestergaard's experiment catalogue
([matematikfysik.dk](https://www.matematikfysik.dk/fys/fysik_oevelser.html)) — `.docx` procedure
guides by level C/B/A; the LED Planck lab came from here. docparse a starter set (one per level) to
extract procedure + expected values as the AI's ground truth. **Usage rights/attribution to confirm
with AR/JB.** See `notes/2026-06-09-AR-followup-curriculum-experiments.md`.

## C. Bidirectional voice — **time-boxed: 23 June target**

Sound in **and** out was stressed by teachers. This was "not in this brief" on 3 June; it now has a
**hard near-term target of 23 June** (ahead of the wk-27 holiday). This is the one urgent new date.

→ **Design doc / brief:** `bidirectional-voice-brief.md` — must resolve: STT+TTS vs a streaming
Live-API approach, the GDPR posture for audio in/out (M), the UX mode, and **who owns the build**.
**Open: confirm scope and owner with JB and the app agent immediately** — the date is tight.

## D. Personas/friction analytics — gated on R1

**Formative-first + deliberate friction + entry-timing (typed vs pasted) signal + an engagement-signal
metric** are analytics-framework concerns, not app sprints yet. They depend on the **R1 analytics
framework decision (ICAP+FCI vs CPS+DRA), due before the 29 June freeze.**

→ Folds into `teacher-analytics-framework.md` once R1 is decided. Do not sprint the metric/friction
instrumentation before R1.

---

# Part 3 — Captured, belongs elsewhere (not an app sprint)

- **2010 national-exam archive** — open Strand C scoping fork (standards/concept extraction vs
  exam-training tool); copyright/IP + GDPR clearance required first. Captured in `strands.qmd` (Strand C)
  and the note. Not an app sprint until the fork is decided.
- **Convert-to-cartoon** — nice-to-have; `illustration-builder` territory (Year-2).
- **Cost dashboard / exit ticket** — already in the 3 June brief (#9, #8); 9 June reinforced their
  priority (exit ticket = high). No new spec; build per the 3 June brief.
- **Representations / "physics forms of symbolism"** — multiple representational forms (diagrams,
  concepts, visualisations, maths) all building intuition; the representational-competence thread
  (`notes/2026-05-26-representational-competence-framework.md`). Framework-level, not a discrete sprint.

---

## Suggested sequence

1. Part 1 items (1–3) — small, extend existing work, no blocking decisions (personas gated only on AR
   prompt sign-off).
2. **Bidirectional voice (C)** in parallel — the 23 June date forces it; settle scope/owner now.
3. Design docs **A** and **B** — write next so the teacher-authoring and offline-lab sprints can start
   after the mid-July review.
4. **D** waits on the R1 decision (29 June).
