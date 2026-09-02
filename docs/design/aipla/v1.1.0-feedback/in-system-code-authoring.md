# Writing code in the system — for teachers, and for students

**Status**: **Design (OPEN)** — **1.1.97**. Needs a scope decision before build
**Priority**: **P2** — called *"a key request"* in the meeting, but it is the largest single new surface in this batch and its scope is genuinely undecided
**Estimated**: ~4–5d for the student slice; the teacher slice depends heavily on the scope decision below
**Scope**: Frontend — a code element in the workbench with an editor and output pane; backend — execution routing and the tutor-context push. Possibly the activity builder, depending on scope
**Dependencies**: ⚠️ `backend/tools/code_execution/` (**SHIPPED but NOT the same feature** — see below); [1.1.38 activity-elements-palette](activity-elements-palette.md) (the element registry + the two-surface recipe); [1.1.62/1.1.69](tutor-sees-element-state.md) (element state reaching the tutor); ADR-013 (artefact safety — the closest existing precedent for running untrusted code)
**Created**: 2026-09-02
**Source**: [meeting transcript](../../../09-01_Weekly_Meeting_AI_Education_Platform_Data_Compliance_and_Teacher_Feedback-Summary.md) — *"A key request is the ability for teachers and students to write code directly in the system."* Missed entirely by the dictated notes

## Problem Statement

> A key request is the ability for **teachers and students to write code directly
> in the system**.

**That sentence contains two different features and the difference matters more
than anything else in this doc.**

### The prior art is a trap

`backend/tools/code_execution/` exists and ships. It would be easy — and wrong —
to read this request as mostly done. That module's own docstring:

> *Code execution sub-agent for non-Gemini skill agents… Gemini agents receive
> `BuiltInCodeExecutor` directly.*

That is **the model** writing and running code to answer a question. The request
is **a human** writing code and seeing what it does. They share an executor at
most; they share no UI, no pedagogy, and no safety model. Recording this
explicitly because "we already have code execution" is exactly the kind of
half-true that stops a real feature getting built.

### Why a physics platform wants this

Computational physics is in the curriculum, and a code cell is the natural
workbench element for it — model a trajectory, fit a curve, integrate numerically.
It also composes with what already ships: a code element that can read the
**data table** (1.1.71/1.1.88) turns "here are our measurements" into "here is our
fit", which is precisely the lab workflow the sims already stage.

And it is the first workbench element where **the student's artefact is itself
inspectable reasoning**. A tutor that can see the code *and* its output can do
something genuinely new: not "your answer is wrong" but "your loop never updates
velocity."

## The scope decision (needed before build)

**Two features, and the meeting did not separate them.**

| | **Student code element** | **Teacher-authored code** |
|---|---|---|
| Who writes | A student, inside an activity | A teacher, authoring an activity |
| Purpose | Do physics | Build interactive content |
| Shape | A workbench element like the table or chart | Overlaps [teacher-authored-workbench-apps](teacher-authored-workbench-apps.md) and the ADR-013 artefact-review pipeline |
| Risk | Sandboxing untrusted student code | Untrusted code shipped **to other people's classrooms** |
| Est | ~4–5d | Substantially more, and it is a **governance** problem before an engineering one |

**Recommendation: build the student element first, and treat the teacher half as
a separate decision.** A teacher writing code that runs for thirty students is
the same problem ADR-013 already governs for generated HTML artefacts, and it
should reuse that answer rather than invent a second one. The student element is
bounded, valuable on its own, and does not prejudge it.

## Design — the student code element

### M0 — The element

A workbench element following the registry recipe: editor, Run, output pane,
persisted per group like the table (`table_progress`'s idiom, not
`sessionStorage` — that mistake is documented and fixed).

**Python**, because it is what physics teaching uses and what the curriculum
assumes. Execution in the browser (Pyodide) is worth serious consideration over a
server sandbox: no untrusted server-side execution, no per-run cost, works
offline-ish, and the blast radius is the student's own tab. The cost is payload
size and no arbitrary packages — probably acceptable for `numpy`-shaped work.

### M1 — The tutor sees the code *and* the output

Both, via the shipped element-state push. The tutor gets what they wrote, what it
printed, and any traceback — which is the whole pedagogical point, and directly
reuses the 1.1.87 lesson that the tutor should **have** the artefact rather than
be trusted to ask for it.

⚠️ **And the trust card is mandatory** — this is precisely the element class where
it has been dropped twice before. `make audit-trust-cards` gates it.

### M2 — Reading the workbench

Let the code read the group's data table. This is where it stops being a toy: the
measurements the group took become the input to the fit they write.

## Milestones

| M | What | Est | Gate |
|---|---|---|---|
| M0 | Code element: editor, run, output, per-group persistence | ~2d | **Scope + runtime decision** |
| M1 | Code + output + traceback reach the tutor; trust card | ~1d | M0 |
| M2 | Code reads the group's table | ~1d | M0, 1.1.71 |
| M3 | Co-pilot can add a code element to an activity | ~0.5d | M0 |

## Testing

- Per the `workbench-element-builder` recipe: state reaches the tutor **and** a trust card is shown — `make audit-trust-cards` must pass
- An infinite loop does not hang the tab beyond a bounded timeout
- Code persists per **group**, survives a closed tab, and is not `sessionStorage`
- A traceback reaches the tutor as text, not as a swallowed error
- No execution path can reach the network or another group's data

## Open questions

1. **Student element only, or teachers too?** The scope decision above. Needs
   answering before M0.
2. **Browser (Pyodide) or server sandbox?** Leaning browser. Server execution of
   student-authored code is a security surface this project has no need to open.
3. **Is this in scope for the extension at all?** ~4–5d against ~75 days, for a
   feature whose classroom is gated behind two legal approvals. It is a *"key
   request"*, which argues for it; the arithmetic argues for later.
4. **Which curriculum level?** If C-level is the November focus and computational
   work sits at B/A, this may serve the wrong cohort first.
