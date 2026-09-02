# A standard shape for a teaching prompt — and what to do when the pedagogy is longer than the cap

**Status**: **Design (OPEN)** — **1.1.98**
**Priority**: **P1** — it is the delivery mechanism for the conceptual framework JB is about to write, and without it that framework has nowhere to live
**Estimated**: ~2–3d (M0 the standard shape ~0.75d · M1 long-content offload ~1d · M2 authoring support ~0.75d)
**Scope**: Backend — a structured prompt composition over the shipped instruction-provider chain, plus a reliable offload path for long content; frontend — the authoring surface that reflects the structure
**Dependencies**: `adk/instruction_provider_chain.py` (**SHIPPED** — `compose_instruction_providers`, the composition seam); `MAX_INSTRUCTIONS_CHARS = 25_000` (`db/models/__init__.py`); `adk/curriculum_retrieval.py` (**SHIPPED**); [1.1.90](bounded-tutoring-answer-trees.md) (**M4 is the retrieval half — read together**); [1.1.91](researcher-configurable-tutors.md) (frameworks compose into the same prompt)
**Created**: 2026-09-02
**Source**: [meeting transcript](../../../09-01_Weekly_Meeting_AI_Education_Platform_Data_Compliance_and_Teacher_Feedback-Summary.md) — *"The app has character limits for speed, so the proposed solution is to use concise in-app prompts that explicitly instruct the AI to consult longer external documents"*; action item *"investigate supporting very long teaching prompts and automated summarization"*; and *"define a standardized prompt structure and guidelines"*

## Problem Statement

Three things collide, and the meeting named all three without connecting them.

**1. There is no standard shape for a teaching prompt.** A teacher writes prose
into a box. So does a researcher authoring a framework. So does the co-pilot.
Nothing says a teaching prompt has parts, which means nothing can validate one,
compare two, or explain to a teacher why theirs behaves differently from a
colleague's.

**2. The cap is real and it is about speed, not storage.**
`MAX_INSTRUCTIONS_CHARS = 25_000`. Every character is re-sent on **every turn**,
so a long prompt is a permanent latency and cost tax — and latency was already
item 3 of the August feedback. The cap is a *good* constraint being enforced
without a strategy for the content it excludes.

**3. The pedagogy about to arrive is long.** JB is writing a conceptual framework
with **Embodied Cognition** as the umbrella and SDT inside it, grounded in
literature Aswin is gathering, per curriculum level. That is not a paragraph.
Neither is Etkina's Scientific Abilities framework, nor a properly-specified ESRU
or dialogic tutor. **The system is about to be handed more pedagogy than its
prompt can hold**, and the current answer would be to truncate it — silently
losing exactly the theoretical grounding that makes the tutors defensible.

### Why the meeting's own proposal needs care

> Use concise in-app prompts that explicitly **instruct the AI to consult longer
> external documents**.

That is the right instinct and it is **the exact pattern that already failed
once**. 1.1.87: a teacher attached exam papers, the tutor was told it could
retrieve them, and it *did not look* — then discussed the wrong Question 5. The
fix was to stop asking the model to elect to retrieve and **hand it the material
instead**.

So the offload must not be "tell the model to go and read". It must be
**position-triggered**: the current concept, tree node, or lesson phase decides
what gets pulled in, and it arrives in context without the model choosing.
Same conclusion as 1.1.90 M4, reached from the other direction.

## Design

### M0 — A teaching prompt has parts

Compose the prompt from named sections rather than one blob, over the shipped
`compose_instruction_providers` chain:

| Section | Owner | Typical size |
|---|---|---|
| House style (maths notation, units) | Platform, unconditional | small, shipped |
| **Pedagogical framework** | Researcher ([1.1.91](researcher-configurable-tutors.md)) | medium |
| Interaction style | Activity | small, shipped |
| **Lesson intent** | Teacher | small |
| **Subject content** | Teacher / curriculum | **the unbounded one** |
| Concept-map bounds | Activity ([1.1.90](bounded-tutoring-answer-trees.md)) | medium |

Two payoffs beyond tidiness. A **per-section budget** makes the cap
comprehensible — a teacher is told *"your subject content is over budget"*, not
*"prompt too long"*. And sections make prompts **comparable**, which is what
[1.1.92](session-benchmark-tutor-activity.md) needs to attribute a result to a
framework rather than to prose.

### M1 — Long content goes to retrieval, triggered by position

Content exceeding its section budget is **not truncated**. It is chunked into the
activity's retrieval corpus and pulled back **by position**, per the reasoning
above. The prompt keeps a summary and a pointer; the full text arrives when the
lesson reaches the part that needs it.

**Summarisation is where this gets dangerous.** An auto-summary of a teacher's
pedagogy that drops a nuance is a silent failure of exactly the kind this project
keeps shipping. So: the summary is **generated once at authoring time, shown to
the author, and editable** — never generated per-turn behind their back.

### M2 — Authoring support

- Live per-section budget in the builder, with what happens on overflow
- **Guidelines** — the *"standardized prompt structure and guidelines"* action —
  as inline help, not a document nobody reads
- The co-pilot proposes into sections rather than into a blob

## Milestones

| M | What | Est | Gate |
|---|---|---|---|
| M0 | Sectioned prompt composition + per-section budgets | ~0.75d | None |
| M1 | Position-triggered offload + author-reviewed summary | ~1d | None |
| M2 | Builder budgets, guidelines, sectioned co-pilot proposals | ~0.75d | **Structure sign-off from JB/AR** |

## Testing

- An existing activity composes byte-identically (passthrough — the same bar 1.1.20 held)
- Total composed prompt never exceeds `MAX_INSTRUCTIONS_CHARS`; overflow offloads rather than truncates
- **Offloaded content arrives by position, with no model election** — the 1.1.87 regression test, generalised
- A summary is never regenerated silently after the author approved it
- Section attribution survives to the chat log, so 1.1.92 can attribute a score

## Open questions

1. **Who owns the section list?** It encodes a view of what teaching instruction
   *is*. JB's conceptual framework may reshape it — worth agreeing the sections
   with him before M0 rather than presenting him with them.
2. **Is 25,000 still right?** It was set for latency on an older model tier. Worth
   re-measuring, since it is now shaping pedagogy.
3. **Does the framework section live per activity or per tutor?** Per tutor
   (1.1.91) is the obvious answer; per activity may be needed for overrides.
4. **What happens to the eight existing `SKILL.md` tutors?** Same migration
   question as 1.1.91 open question 1 — these two docs should answer it together.
