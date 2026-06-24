# Student-submission surfaces — image-based solutions + element reconciliation

**Status**: Design (OPEN)
**Priority**: P1 — corrects two 1.1.45 design mistakes before the pilot
**Estimated**: ~3–5d phased (reconcile ~1d · photo solution ~1d · whiteboard ~1.5–2d · TipTap removal + migrate ~0.5d)
**Scope**: Fullstack
**Dependencies**: [1.1.45 rich-document-workbench](rich-document-workbench.md) (**amends it** — this supersedes M3b's `workbenchType` mode + M4's TipTap editor); [1.1.38 activity-elements-palette](activity-elements-palette.md) (the element registry document-upload + solution become elements of); [1.1.7 student-multimodal-upload](student-multimodal-upload.md) (**the proven image→tutor path both reuse**); [1.1.44 activity-image-materials](activity-image-materials.md) ("tutor sees the pixels"); [1.1.32 teacher-ux-refinement](teacher-ux-refinement.md) (the "make `workbenchType` honest" thread this continues)
**Created**: 2026-06-24
**Last Updated**: 2026-06-24

> **This amends 1.1.45.** Two of its choices were wrong and surfaced in the
> 2026-06-24 review: (1) document-feedback shipped as a `workbenchType` **mode**
> that pre-empts the standard workspace — inconsistent with the solution editor,
> which is a composable **element**; (2) the solution editor is a **TipTap
> rich-text editor** expecting LaTeX / URLs / image-URLs — wrong for students.
> This doc fixes both with one idea.

## Problem Statement

A student gives the AI an **artifact to react to** — a file they have, a photo of
their pen-and-paper work, a sketch. Physics is hand-written (equations, free-body
diagrams, vector sketches, graphs), and the tutor is **multimodal** (1.1.7/1.1.44
prove "the tutor sees the pixels"). 1.1.45 built two student-submission surfaces
that fight this reality:

**Current State:**
- **Document-feedback is a `workbenchType="document"` mode**, not an element. The
  chat page special-cases it (`isDocumentActivity`) and mounts **only** the upload
  workbench, **pre-empting** the standard workspace (checklist, table, note, …).
  - It's inconsistent: the **solution editor is an element** (composes freely);
    document-upload is a mode (excludes everything).
  - The pre-emption already caused a **shipped bug** — teacher materials vanished
    from document activities until special-cased back in (2026-06-24 fix).
  - A document-feedback activity **can't** also have a checklist or note.
  - It's a second, overlapping mechanism for "which student surface is present" —
    exactly the `workbenchType` dishonesty [1.1.32](teacher-ux-refinement.md)
    started removing.
- **The solution editor is a TipTap rich-text editor.** It expects the student to
  write their solution as **typed text + LaTeX (`fx`) + image-URLs + links**.
  - Students don't type LaTeX. They don't paste image URLs. Physics solutions are
    **hand-written** — equations, diagrams, units, crossings-out.
  - It scores **USABLE BY DESIGN = −1** for a **student-facing** surface, which is
    a **hard-fail** per the product axioms. It should not have shipped that way.
  - It dragged in `@tiptap/*` (a rich-text + ProseMirror + a hand-rolled markdown
    serialiser) — a custom path where a multimodal image submission was the
    natural fit.

**Impact:** the two surfaces a student uses to *give the tutor something to grade*
are the wrong shape — one excludes everything else, the other asks 16-year-olds to
type LaTeX. Both ship into the 2026-08-14 pilot if not corrected.

## Goals

**Primary Goal:** make every student-submission surface a **composable element**
whose output is an **image (or file) the multimodal tutor sees** — via the path
that already works (1.1.7) — and retire the `workbenchType` mode + the TipTap
editor.

**Success Metrics:**
- A teacher adds **"Document upload"** and **"Solution"** like any other element
  (1.1.38 recipe); they compose with checklist/note/each other. No activity *mode*.
- A student submits a solution as a **photo of their pen-and-paper work** OR a
  **freehand drawing made in-app** — never by typing LaTeX.
- The submitted image reaches the tutor through the **proven 1.1.7 multimodal
  path** and triggers feedback (the 1.1.45 M4 feedback prompt still applies).
- `workbenchType` no longer encodes "which student widget" — only the runtime
  surface (`app` = sim iframe, `none` = standard workspace). `"document"` retired.
- `@tiptap/*` + the markdown serialiser are **removed** (smaller bundle + dep/
  security surface).

**Non-Goals:**
- Not OCR/transcription of the handwriting — the tutor reads the **image** (1.1.44
  posture: "stored as an artifact the AI can recall and use", not OCR'd text).
- Not a full diagramming tool (no shapes/equation-objects) — freehand + photo
  cover the pedagogy; richer canvases are a later probe.
- Not removing typed chat — the student still *chats*; this is only the
  *solution-submission* surface.

## Axiom Alignment

Score each axiom per [Product Axioms](../../../product-axioms.md). Net must be >= +4.

| # | Axiom | Score | Notes |
|---|---|---|---|
| 1 | INSTANT FEEL | 0 | Canvas is local; photo upload reuses the existing client-resize path. |
| 2 | EARNED TRUST | **+1** | The tutor reacts to the student's *actual work* (handwriting + diagram), not a lossy typed approximation. |
| 3 | SKILLS, NOT FEATURES | **+1** | Both surfaces become **elements** on the 1.1.38 registry — one mechanism, composable, the breadth multiplier; retires a bespoke mode + a bespoke editor. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Orthogonal (multimodal model already in use). |
| 5 | GRACEFUL DEGRADATION | **+1** | No camera → file picker; no pointer/stylus → photo path; canvas export failure → still submittable as the raw image. |
| 6 | PROTOCOL OVER CUSTOM | **+1** | Reuses the **native AG-UI `ImageInputContent` → ADK Part** path (1.1.7) instead of a custom TipTap+markdown+iframe-context+trigger dance. Removes `@tiptap/*`. |
| 7 | API FIRST | 0 | No new endpoints — rides 1.1.7 multimodal + the documents API. |
| 8 | OBSERVABLE BY DEFAULT | **+1** | Submissions are real chat turns (logged like any multimodal turn) — no separate, invisible iframe-context to reason about. |
| 9 | SECURE BY CONSTRUCTION | **+1** | Removes the `@tiptap/*` dependency surface; image submission reuses the vetted upload guardrails (1.1.21 no-person check, size/resize). |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Canvas is necessarily client-side; the rest is protocol. |
| 11 | USABLE BY DESIGN | **+1** | **The headline.** A student-appropriate input (photo your paper / draw it) replacing a LaTeX rich-text editor — flips the 1.1.45 M4 **hard-fail −1** to a clear win on a student surface. |

**Net: +7.**

## Design

### Part A — reconcile: document-upload becomes an element (kills the mode)

- Add a `document` (or `document-upload`) entry to `ELEMENT_REGISTRY` /
  `elementRenderers` whose renderer mounts the existing `StudentDocumentWorkbench`
  (it already exposes `onActiveDocChange` → `document_ids`). It pushes interactive
  state per the [element recipe](activity-elements-palette.md) step.
- **Delete** the chat-page `isDocumentActivity` pre-emption branch and the
  builder's document-mode workspace-hiding. A document-feedback activity is now
  "an activity with a Document-upload element" — and can also carry a checklist,
  note, etc. The teacher materials panel already composes (no special case).
- `WorkbenchType` **drops `"document"`**; it means only the runtime surface (`app`
  = sim iframe takeover, `none` = standard workspace). Continues the 1.1.32
  "make `workbenchType` honest" cleanup.
- **Migration:** the pilot hasn't started, so real `workbenchType="document"`
  configs are ~none. Backfill any → a `document` element + `workbenchType="none"`
  (dual-read during rollout, same pattern as ALS-1 M0.2).

### Part B — image-based solution element (retires TipTap)

The `solution` element stops being a rich-text editor. It becomes a **submit-your-
work** surface with **two capture modes**, both producing an **image**:

1. **Photo** (the dominant case) — camera / file picker → the student photographs
   their pen-and-paper solution. **Reuses 1.1.7 wholesale** (client resize, the
   1.1.21 no-person guardrail, native `ImageInputContent`).
2. **Freehand whiteboard** — an in-app canvas (pen, eraser, a few colours, clear,
   undo) for no-paper / quick-sketch cases. Pointer/stylus events; on submit,
   `canvas.toBlob()` → the same image path.

**Submit → feedback is just a multimodal turn.** The captured image is sent as a
chat turn (native AG-UI image part, 1.1.7) — so the tutor **sees** the solution
and responds with feedback. This **replaces** the 1.1.45 M4 mechanism (push
markdown to iframe-context, then fire an `onProactiveTrigger`) with the proven
image→tutor path, and the turn fires **naturally** (it's a message). The 1.1.45
M4 **feedback prompt** (Socratic, never-give-the-answer — `compose_teacher_focus`)
still shapes the response; it now critiques an image instead of markdown.

**Removed:** `@tiptap/react` / `@tiptap/pm` / `@tiptap/starter-kit` /
`@tiptap/extension-image` / `@tiptap/extension-mathematics`, `solutionMarkdown.ts`,
and the iframe-context/onProactiveTrigger solution wiring.

### Why image-in is the correct interface (the core argument)

- **Physics is visual + hand-written** — equations, free-body diagrams, vector
  decompositions, graphs. The cost of forcing that into typed LaTeX is exactly the
  friction the 3-June/9-June teacher check-ins flag as the barrier for weaker
  students.
- **The tutor is already multimodal** — 1.1.7 (student photo uploads the tutor
  reads) and 1.1.44 ("the tutor sees the pixels") are shipped. The capability to
  grade a photo of handwritten work exists; the solution surface just wasn't using
  it.
- **It composes with the no-laptop reality** — same posture as
  [1.1.22 end-of-class-notes-summary](end-of-class-notes-summary.md) (students
  photograph handwritten notes) and the shared-phone classroom.

## Milestones

| # | Milestone | Scope | Est. | Gate |
|---|---|---|---|---|
| **M0** | **Reconcile** — document-upload → `document` element; delete the `workbenchType="document"` pre-emption + builder mode-hiding; retire `"document"` from `WorkbenchType`; backfill/migrate. | Fullstack | ~1d | — |
| **M1** | **Photo solution** — `solution` element becomes camera/file image submission, reusing 1.1.7 (resize + 1.1.21 guardrail); submit = a multimodal turn; 1.1.45 feedback prompt critiques the image. | Fullstack | ~1d | — |
| **M2** | **Freehand whiteboard** — in-app canvas (pen/eraser/colour/clear/undo) → `canvas.toBlob` → same submit path. Touch/stylus + mouse. | FE | ~1.5–2d | whiteboard lib via `make security-check` |
| **M3** | **Remove TipTap** — delete `@tiptap/*` + `solutionMarkdown.ts` + the old wiring; migrate existing `solution` elements; bundle/dep-surface check. | FE | ~0.5d | — |

**M0 is independently valuable** (kills the mode + the foot-guns). **M1 alone**
makes solutions student-appropriate (photo); **M2** adds the in-app option.

## Open Questions / Human Gates

1. **JB/AR — solution = pure image, or image + optional short caption?** Lead
   image-only (the work is the image); an optional one-line text note is cheap.
2. **Whiteboard library** — custom canvas vs. a light vetted lib
   (`perfect-freehand` for nice strokes / `react-sketch-canvas`). Smallest
   footprint that gives pen+eraser+undo; through the dep security gate.
3. **AR** — the 1.1.45 feedback prompt was written for text; confirm it reads
   well when the "solution" is an image of handwriting (likely fine — same Socratic
   rules — but worth a glance with sample photos).
4. **Multiple submissions / history** — does each submit append a new image turn
   (iterative feedback, recommended), or replace? Append.

## Related

- [rich-document-workbench.md](rich-document-workbench.md) — 1.1.45; this **amends** its M3b (mode) + M4 (TipTap)
- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38; the registry both surfaces join
- [student-multimodal-upload.md](student-multimodal-upload.md) — 1.1.7; the image→tutor path reused
- [activity-image-materials.md](activity-image-materials.md) — 1.1.44; "tutor sees the pixels"
- [teacher-ux-refinement.md](teacher-ux-refinement.md) — 1.1.32; the "make `workbenchType` honest" thread
- [end-of-class-notes-summary.md](end-of-class-notes-summary.md) — 1.1.22; the same photograph-your-work posture
