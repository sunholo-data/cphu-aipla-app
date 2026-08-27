# The task the student is working on — a material the tutor HAS, not one it may look up

**Status**: Planned — **1.1.87**
**Priority**: **P0** — the single highest-cost item in the 2026-08-21 teacher feedback. A whole lesson was built on this and it did not work, silently
**Estimated**: ~1–1.5d (M1 the third twin ~0.6d · M2 the authoring control ~0.3d · M3 task selection ~0.4d)
**Scope**: Backend — a third `MaterialRef.kind`, a durable slot write on teacher upload, a loader/injector twin in `adk/callbacks/`, and the `agent.py` wiring; frontend — one authoring control in the materials picker
**Dependencies**: [1.1.44 activity-image-materials](activity-image-materials.md) (**SHIPPED** — the durable-slot + loader/injector pattern this copies); the document pipeline (`adk/callbacks/document.py`, **SHIPPED**); [1.1.25 curriculum-library](curriculum-library.md) (the RAG path this sits beside, not replaces)
**Created**: 2026-08-27
**Source**: [teacher-feedback-2026-08-21-triage.md](teacher-feedback-2026-08-21-triage.md) item 1. Decision D1 answered by M, 2026-08-27: *"we have ADK artifact mechanism tools, can they be used?"* — yes, and there are two working precedents

## Problem Statement

A teacher built an activity around students working previous Physics A exam questions with the
tutor, and uploaded PDF printouts of the papers as activity materials. In their words:

> However, the tutor did not seem to use these files by default. It still asked students to upload
> the assignment text... One group experienced it talking about a completely different Question 5
> when made aware it had the file. It was also tedious having to PDF-print and upload individual
> exam papers. Is there an easy way to provide the tutor with the tasks, or should students copy the
> text in themselves?

Nothing failed. No 500, no log line, no error budget moved. The activity simply did not do the
thing it was built to do, and the way it did not do it — confidently discussing the **wrong**
Question 5 — is worse than a refusal, because a student cannot tell.

### Why: `kind` decides, and one kind gets a tool while the other gets the bytes

[`MaterialRef.kind`](../../../../backend/db/models/activity_config.py#L60) is
`Literal["curriculum", "image"]`, and the two kinds reach the tutor by completely different
mechanisms:

| `kind` | Mechanism | What the tutor gets |
|---|---|---|
| `"image"` (1.1.44) | Durable artifact slot → `make_activity_image_loader` copies it into the student's session → `make_activity_image_injector` inlines it as an image Part | **The material itself, on every turn.** The tutor cannot miss it |
| `"curriculum"` (1.1.25) | `build_curriculum_retrieval_tool` → a `VertexAiRagRetrieval` scoped to the cited docs | **A tool it may choose to call**, returning similarity-ranked *chunks* |

A PDF of an exam paper is `kind="curriculum"`. So it went down the retrieval path, and both halves
of the teacher's report follow directly:

- *"did not seem to use these files by default"* — correct. Retrieval is a tool. The model has to
  decide to call it, and nothing in the turn tells it that the task the student is asking about is
  sitting in the corpus.
- *"a completely different Question 5"* — also correct, and predictable. Similarity search over
  several exam papers, each containing a "Question 5", ranks by embedding distance. There is no
  reason for it to prefer *this* paper's Question 5, and it did not.

**Retrieval is the right mechanism for a reference corpus and the wrong one for the task at hand.**
A textbook chapter is something the tutor should consult when relevant. The exam question in front
of the student is something the tutor must simply *have*.

### The mechanism already exists, twice

`adk/callbacks/activity_images.py` describes itself as *"twins of the document pipeline
(`adk/callbacks/document.py`), for a teacher's activity image instead of an attached document"*.
So the platform already runs this exact pattern on two paths:

1. **A student's attached document** — `make_document_loader` → `make_document_injector`, which
   inlines the parsed blocks as **text** labelled `[Attached document: doc:{id}.json — provided by
   the user]`.
2. **A teacher's activity image** — `make_activity_image_loader` → `make_activity_image_injector`,
   which inlines an **image** Part.

A teacher's activity *document* is the obvious third twin and is the only one missing. The durable
slot is already MIME-agnostic (`save_artifact` persists `inline_data` with its `mime_type`), and
the parse path that turns a PDF into blocks already exists for student uploads.

## Goals

**Primary Goal:** a teacher can attach the task their students are working on and be certain the
tutor has it — without a student pasting anything.

**Success Metrics:**
- A tutor asked about a task in an attached material answers from that material without being told it exists.
- Asked about "Question 5", the tutor is discussing the right paper's Question 5.
- A teacher can tell, at authoring time, which of the two mechanisms a material will use.

**Non-Goals:**
- Replacing the RAG path. A textbook is correctly a corpus; this adds a second kind beside it.
- Making every material always-in-context. Context is finite and it is a per-turn cost on every
  turn of the session (see Axiom 4 below).
- Solving PDF-printing individual exam papers, which is the teacher's other complaint in the same
  item and is a materials-ingestion question, not a context one.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Removes a retrieval round-trip on turns that would have called the tool; adds prompt tokens on all of them. Roughly neutral. |
| 2 | EARNED TRUST | **+2** | This is the axiom's central case. The tutor currently discusses a task it has not read, using a same-numbered question from a different paper, with no signal to the student that it is guessing. |
| 3 | SKILLS, NOT FEATURES | 0 | No change to the skill abstraction; a material kind, not a skill. |
| 4 | RIGHT MODEL, RIGHT MOMENT | **-1** | An always-injected document is on **every** turn for the rest of the session. A 20-page exam paper would be a large per-turn cost. See the justification. |
| 5 | GRACEFUL DEGRADATION | **+1** | A material that cannot be parsed must say so at authoring time, not fall through to a tutor that behaves as if it has it — which is today's failure mode exactly. |
| 6 | PROTOCOL OVER CUSTOM | **+1** | Uses the ADK ArtifactService and the existing loader/injector callback pattern; invents nothing. This is what M's question was asking, and the answer is that the protocol already covers it. |
| 7 | API FIRST | 0 | One field on an existing model; no new endpoints. |
| 8 | OBSERVABLE BY DEFAULT | **+1** | Copying into session artifacts makes the material visible in the ADK web UI and to `adk eval` — the 1.1.44 rationale, inherited. Today "did the tutor have the paper?" is unanswerable after the fact. |
| 9 | SECURE BY CONSTRUCTION | 0 | Same ACL as materials today; the durable key is unguessable. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | No shift. |
| | **Net Score** | **+4** | Threshold: >= +4 |

**Conflict justification (Axiom 4, -1).** The cost is real and must be bounded rather than waved
past. Three bounds: a **size cap** at authoring time with the cost stated in the UI (the teacher
chooses, and can see what they are choosing); **task selection** (M3) so one question is injected
rather than a whole paper; and the `WRITING_PUSH_CHAR_CAP` precedent from 1.1.73, which already
solved the identical problem for student text — a head-plus-tail truncation with a `truncated` flag
so the tutor says so rather than commenting confidently on half a document. Reuse that shape;
do not invent a second one.

## Design

### M1 — the third twin

Add `kind="context"` to `MaterialRef` (name to settle in review — "context", "attached", "task").
On teacher upload of a context material: parse it through the existing document pipeline and write
the blocks to the durable activity slot, keyed on `material_id` alone, exactly as 1.1.44 does.
**Copy that key scheme literally.** Its docstring records a 2026-06-30 bug where the key included
`activity_id` and `teacher_uid`, diverged between save and load, and the image silently never
reached the tutor — which is precisely the symptom this doc exists to fix, so re-deriving the key
is the one thing not to do.

Then `make_activity_document_loader` / `make_activity_document_injector`, twins of the image pair,
inlining text through `make_document_injector`'s existing formatting. Wire in `agent.py` beside the
image callbacks.

### M2 — the teacher chooses, and can see the choice

In the materials picker, a material is attached either as **reference** (RAG, "the tutor can look
this up") or as **context** ("the tutor always has this"), with the size/cost consequence stated.
Default stays reference — it is the cheaper mechanism and the right one for a textbook.

This is the half that makes the failure impossible to repeat *silently*: today a teacher has no way
to know which mechanism their upload got, because there is only one and it is invisible.

### M3 — which task

Even with the paper in context, "Question 5" is ambiguous when the activity carries three papers.
The lightest version is an authoring-time split — one material per task, and the activity's
lesson prompt names which — rather than a runtime picker the student must operate. Confirm with the
teacher which shape matches how they actually run the lesson before building either.

## Testing Strategy

**Backend (pytest)**
- A `kind="context"` material writes to the durable slot under a `material_id`-only key.
- The loader copies it into a student session once, is idempotent across turns, and self-heals a vanished artifact (mirror the 1.1.44 loader tests).
- The injector inlines the parsed text into the LLM request; assert on the request, not on a mock's call count.
- A `kind="curriculum"` material still takes the RAG path and does **not** get injected — the two kinds must not merge.
- Over-cap material truncates head-plus-tail and sets `truncated`, per the 1.1.73 shape.
- An unparseable material fails at **upload**, not at turn time.

**Eval — the load-bearing one**
This is a model-behaviour claim and only an eval can hold it: an evalset with two exam papers, each
having a Question 5, asserting the tutor answers from the cited one. Ship the eval with the feature;
the unit tests prove the bytes arrive, and arriving was never the part in doubt.

**Manual, on deployed dev**
- Rebuild the teacher's actual activity from the 21 August session with their real PDFs.

## Migration

- **Additive.** Existing materials are `kind="curriculum"` and keep working unchanged; legacy rows
  with no `kind` already default to curriculum.
- **No re-ingestion.** A teacher who wants a material in context re-attaches it as one; nothing
  migrates automatically, because the choice is theirs and guessing it would inject textbooks.
- **Rollback:** the new kind is inert if the callbacks are removed — materials fall back to
  appearing as reference. No stored data is lost.

## Success Criteria

- [ ] A context material reaches the tutor on the first turn with no student action.
- [ ] The eval passes: two papers, right Question 5.
- [ ] A curriculum material still goes to RAG and is not injected.
- [ ] The teacher can see which mechanism a material uses before students arrive.
- [ ] Over-cap materials are truncated visibly rather than silently.
- [ ] The teacher who reported item 1 rebuilds the exam activity and it works.

## Open Questions

1. **What is the cap, and per material or per activity?** A three-paper activity at 20 pages each is
   not injectable at any sane budget, which is what makes M3 load-bearing rather than a nicety.
2. **Does `kind="image"` fold into `kind="context"`?** They are the same idea with different Parts.
   Merging is cleaner; it also touches shipped 1.1.44 code for no user-visible gain. Recommendation:
   leave 1.1.44 alone and revisit if a third kind appears.
3. **Is "the tutor always has this" the right teacher-facing wording?** It is a promise about model
   behaviour, and Axiom 2 says do not make promises the system cannot keep. Injection is a
   guarantee; *attention* is not.

## Related Documents

- [teacher-feedback-2026-08-21-triage.md](teacher-feedback-2026-08-21-triage.md) — item 1 and decision D1
- [activity-image-materials.md](activity-image-materials.md) — the 1.1.44 pattern this copies, including the key-scheme bug not to repeat
- [curriculum-library.md](curriculum-library.md) — the RAG path this sits beside
- [student-writing-element.md](student-writing-element.md) — the `WRITING_PUSH_CHAR_CAP` truncation shape to reuse
