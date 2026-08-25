# Teacher-authored workbench apps — the ask that appears in every set of notes

**Status**: Planned — **scope not yet agreed**
**Priority**: P1 (strategic; the largest uncovered ask in the feedback record)
**Estimated**: not estimated — this doc exists to frame the decision, not to schedule it
**Scope**: Fullstack + sandbox + authoring
**Dependencies**: [1.1.49 external-host-mcp-apps](external-host-mcp-apps.md) (the `ui://` + artefact plumbing), ADR-013 (sandbox security)
**Created**: 2026-08-25
**Last Updated**: 2026-08-25

## Problem Statement

Teachers want to make their own workbench applications, and they will not do it
outside AIPLA. This is the most persistent ask in the feedback record and it has
no design coverage at all.

**17 August:**
> *"teachers need agency to create applications"*
> *"make stuff for the workbench"*
> *"teachers learn how to vibe code in physics"*
> *"teacher need to be conpentent and be able to verify and check results. know what good looks like"*
> *"for creation of vibe coded apps single pane of glass is preferable or import via published urls"*

**25 August:**
> *"teachers wont use claude code to make stuff, it has to be in our system"*
> *"tried to create a wave and system show the amplitude / the model drawing svg waas bad amplitude drawing / wrong format (svg)? (js)?"*

The 25 August line is the important one, and it is worth being precise about
what it establishes:

1. **The delivery answer is settled.** An external tool — Claude Code or
   anything like it — is not acceptable. Whatever this becomes has to live in
   AIPLA. That removes the cheapest option from the table.
2. **The first real attempt has already been made, and it failed on format.**
   Someone tried to generate a wave visualisation showing amplitude; the model
   produced SVG and the amplitude was drawn badly. The note itself asks the
   right question — *wrong format (svg)? (js)?*

That second point is a technical finding, not an anecdote. A static SVG has to
encode the *result* of the physics; a small JS program encodes the *model* and
lets the value be computed and animated. Asking an LLM to draw a correct
waveform as SVG path data is asking it to be a renderer. Asking it for
`y = A·sin(kx − ωt)` in a loop is asking it for physics, which is the thing it
is good at and the thing a physics teacher can actually check.

**This doc does not decide that.** It records that the format question is the
first thing any prototype must answer, and that we already have one data point
against SVG.

## What already exists to build on

Not starting from zero — worth being explicit, because the gap is smaller than
"let teachers write apps" sounds:

- **The artefact model** (ADR-013): sandboxed iframe, separate origin, CSP, 200 KB cap, vetted catalogue. Already the security envelope for exactly this kind of code.
- **`_WORKSPACE_ELEMENT_SERVERS` + the iframe-context bridge**: an artefact can already push state to the tutor and receive it back. Fixed and gated in [1.1.79](pilot-session-2026-08-21-followups.md).
- **The authoring co-pilot**: already proposes activity elements with an Apply/Edit/Dismiss model. A generated app is another proposal shape, not a new interaction model.
- **`aiplatform sim scaffold <name>`** and `frontend/src/_sim-template/`: the scaffold path a developer uses today.
- **EXT-MCP**: sims are already portable MCP Apps with `ui://` exposure — which is what "import via published urls" is gesturing at.

## The questions this doc exists to force

**1. What is a teacher-authored app made of?**
Options, in rough order of ambition: a parameterised template (teacher fills in
constants, no code); a constrained DSL; generated JS against a small physics
runtime; or free-form generated code in the sandbox. The 25 Aug SVG failure
argues against "generated static asset" and towards "generated *program*".
Geogebra is named in the 17 Aug notes as a reference point for a calculator
suite — worth studying as an existence proof of the constrained-authoring
option.

**2. How does a teacher verify it?**
*"teacher need to be conpentent and be able to verify and check results. know
what good looks like"* is the hardest requirement in the whole ask, and it is a
pedagogical one. A physics teacher who cannot read JS still has to be able to
tell a correct simulation from a plausible-looking wrong one — and a wrong
simulation shown confidently to a class is worse than no simulation. Any design
that cannot answer this should not ship, regardless of how good the generation
is. Candidate answers: known-value checks the teacher states in physics terms,
side-by-side against an analytic solution, a review step by AR/JB before class
use.

**3. Single pane of glass, or import by URL?**
The 17 Aug note prefers the former but allows the latter. This is really a
question about the review gate: an in-product authoring surface can enforce the
ADR-013 envelope structurally, whereas importing a published URL moves the
trust boundary to whoever published it.

**4. Who reviews before a class sees it?**
Today every artefact is hand-vetted into a catalogue. Teacher-authored apps
either need that gate to scale, or a different one. This is the same question
1.1.76 (delegated programme administration) is asking about admin rights, and
should probably be answered consistently.

## Why it is not estimated

Because the answer to question 1 changes the size by an order of magnitude, and
because it is not primarily an engineering decision — it is a decision about
what a physics teacher can be expected to author and verify. AR and JB should
be in that conversation before anyone scopes a sprint.

**Recommended next step:** a spike, not a sprint. Take the 25 August wave case —
the one that already failed — and try it in two or three formats against the
existing artefact envelope. That gives a real answer to the format question and
a concrete artefact to put in front of teachers, for roughly a day of work.

## Related Documents

- [external-host-mcp-apps.md](external-host-mcp-apps.md) — `ui://` MCP Apps, the "import via published urls" half
- [activity-authoring-assistant.md](activity-authoring-assistant.md) — the propose/Apply model a generated app would ride
- [activity-elements-palette.md](activity-elements-palette.md) — the element registry a new app type must join
- [delegated-programme-administration.md](delegated-programme-administration.md) — the review-gate question, in its other form
- `.claude/skills/mcp-app-artefact` — the current hand-authored artefact path
- `docs/notes-2026-08-17.md`, `docs/notes-2026-08-25.md` — the source asks
