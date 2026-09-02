# Bounded tutoring — the concept map steers, the answer tree navigates

**Status**: **Design (OPEN)** — **1.1.90**. Decision **D2 taken 2026-09-02**: answer trees are teacher-authored, AI-navigated
**Priority**: **P1** — the most-repeated theme of the 2026-09-01 meeting, and the first item that treats *tutor tangents* as a design problem rather than a prompt-tuning one
**Estimated**: ~5–7d phased (M0 map-bounded context ~1d · M1 question budget ~0.75d · M2 answer-tree schema + authoring ~2d · M3 navigation at runtime ~1.5d · M4 conditional retrieval ~1d · M5 co-pilot drafting ~0.75d)
**Scope**: Fullstack — `ActivityConfig` gains an answer-tree structure; `adk/` gains a navigator and a bounding preamble; the activity builder gains a tree editor; the authoring co-pilot gains a drafting tool
**Dependencies**: [1.1.98 teaching-prompt-standardisation](teaching-prompt-standardisation.md) (**the sibling — M4 here and M1 there are the same offload problem reached from two directions; build them together**); [1.1.65 living-concept-map](living-concept-map.md) (**shipped to dev** — the map element, graph view, `run_checkpoint`/`record_checkpoint`, per-group `concept_progress`); [1.1.20 interaction-style](tutor-personas.md) (**shipped** — `adk/interaction_style.py`, the preamble-injection seam this reuses); `adk/curriculum_retrieval.py` (**shipped** — the retrieval this makes conditional); [1.1.38 activity-elements-palette](activity-elements-palette.md) (the authoring registry)
**Created**: 2026-09-02
**Source**: [notes-2026-09-01.md](../../../notes-2026-09-01.md) — five separate remarks that turn out to be one piece of work

## Problem Statement

Five bullets from the 1 September meeting describe a single failure and a single
proposed fix:

> AI goes off on a tangent not related to what we want.
>
> We want to steer the AI to only talk around the cognitive map — decisions and
> questions can be used to steer.
>
> How many questions do we ask, and bound the model to what we want to teach.
>
> We give the questions — *"what do you know about forces?"* — based on their
> answer we have answer trees available to reach the learning goals.
>
> The map will live in the activity.

**The failure is not that the tutor is bad. It is that nothing tells it where the
edges are.** A skill prompt says *how* to teach (Socratic, ask one question,
short turns). An activity says *what* the lesson is about, in prose. Neither
expresses **the boundary of the subject** or **the goal state**, so a model doing
exactly what it was asked — following the student's interest — wanders, and the
teacher experiences that as unreliability.

### What already exists, and why it is not enough

The pieces are further along than the meeting assumed, and this doc is mostly
about connecting them.

| Shipped | What it gives | Why it does not solve this |
|---|---|---|
| [living-concept-map](living-concept-map.md) (CONCEPT-1, dev) | A teacher-authored prerequisite graph on the activity; a student-facing view; `run_checkpoint` / `record_checkpoint`; per-group `concept_progress` | The map is a **progress display and a checkpoint tool**. It does not constrain what the tutor may *talk about*, and the tutor is not told the map exists on an ordinary turn |
| `adk/interaction_style.py` (1.1.20) | Per-activity teaching-voice preamble appended at agent-instantiation | Styles the voice. Says nothing about subject boundary |
| `adk/curriculum_retrieval.py` | `VertexAiRagRetrieval` over cited curriculum | **The model elects whether to call it.** 1.1.87 already established what that costs: the tutor did not look, and when it did, similarity search across several papers had no reason to prefer the right one |
| `concept_progress` | Which nodes a group has covered | Read by the map UI, not fed back as a *stop condition* |

**So the map is authored, rendered and tracked — and the tutor cannot see it on a
normal turn.** That is the gap.

## Design

Four independent mechanisms. Each is separately useful; together they are what
the meeting asked for.

### 1. The map bounds the conversation (M0)

Inject the activity's concept map into the tutor's context on **every** turn —
node labels, prerequisite edges, and which nodes this group has already covered —
with a preamble that makes the boundary explicit: *these are the concepts this
lesson is about; if the student raises something outside them, acknowledge it
briefly and steer back.*

This reuses the 1.1.87 lesson directly. A material the tutor **has** beats a
material it **may look up**, and the same is true of the map: the map must be
*in the prompt*, not behind a tool call.

⚠️ **"Bounded" does not mean "rigid" — the transcript is explicit**: the maps
*"guide the AI dialogue toward desired outcomes **while allowing for limited
deviation**."* A tutor that refuses every off-map remark is a worse tutor, and a
student's tangent is often the teachable moment. The preamble must therefore
license brief excursions and require a return, not forbid departure — which is
why the counter-test in Testing (an on-map tangent is *not* suppressed) is a
first-class requirement rather than a nicety.

### 2. A question budget (M1)

*"How many questions do we ask, and bound the model to what we want to teach."*

A per-activity integer: the number of tutor questions expected before the lesson
should have reached its goals. Surfaced to the tutor as a soft budget with the
count so far, and to the teacher as an authoring knob. This is a **pacing**
control, not a hard cutoff — the pedagogical claim behind it is the teacher's.

### 3. Answer trees — teacher-authored, AI-navigated (M2 + M3)

**D2.** The teacher authors, per question:

```
question: "What do you know about forces?"
branches:
  - match: "mentions Newton's third law"        -> next: question-4  (goal: N3 covered)
  - match: "mentions force as a push or pull"   -> next: question-2
  - match: "mentions gravity only"              -> next: question-3  (gap: contact forces)
  - fallback:                                    -> next: question-2
```

At runtime the model does **one** job: read what the student actually said and
pick the branch that matches. It does not invent the next question. That is the
whole point — *generating its own next move is exactly the tangent behaviour this
item exists to stop.*

**Why this shape and not the alternatives.** AI-generated-at-runtime is nearly
free to author and reproduces the reported failure. A pure hybrid (map bounds,
AI phrases) is cheaper and is what M0+M1 give on their own — it is a **genuine
fallback if tree authoring proves too heavy in practice**, and the milestones are
ordered so that discovering this costs M2/M3 and not the whole doc.

**The authoring burden is the real risk**, and it is mitigated, not denied:
M5 has the co-pilot draft trees from the lesson prompt and the map, for the
teacher to edit. Propose → Apply, like every other co-pilot write.

### 4. Conditional retrieval (M4)

*"The teaching prompt is short. If we need a long one we need a way to
conditionally RAG-search the material reliably."*

Make retrieval a **consequence of position in the tree**, not a model election:
a node may carry the material it needs, and reaching that node fetches it. This
is the same fix 1.1.87 applied to task materials, generalised — the tutor is
handed what this step needs instead of being trusted to go and look.

## Milestones

| M | What | Est | Independently shippable |
|---|---|---|---|
| **M0** | Map in context every turn + boundary preamble | ~1d | **Yes** — likely most of the value on its own |
| **M1** | Question budget: config field, prompt surfacing, builder knob | ~0.75d | Yes |
| **M2** | Answer-tree schema + builder editor | ~2d | No (authoring only) |
| **M3** | Runtime navigation: branch matching, tree state per group | ~1.5d | Yes, with M2 |
| **M4** | Node-scoped conditional retrieval | ~1d | Yes, with M2 |
| **M5** | Co-pilot drafts trees (`propose_answer_tree`) | ~0.75d | Yes, with M2 |

**Ship M0 first and measure before committing to M2.** If bounding the context
removes most of the tangents, the tree is a refinement rather than a rescue, and
its authoring cost should be judged against a smaller remaining problem.

## Testing

- M0: an eval where the student asks something off-map; assert the tutor steers back
- M0 counter-test: an on-map tangent is *not* suppressed — bounding must not make the tutor rigid
- M3: branch selection against transcripts with known-correct branches; assert the fallback fires rather than the model inventing a question
- M4: assert retrieval fires on node entry and **not** on model election
- Regression: an activity with no map and no tree behaves byte-identically (passthrough, as `interaction_style` does for `socratic`)

## Open questions

1. **Does M0 alone fix it?** The cheapest possible answer to the meeting's
   complaint. Measure before building M2.
2. **What is a "match"?** Natural-language criteria judged by the model, or
   keyword/embedding rules? NL is more authorable and less predictable — leaning
   NL with the branch set closed and a mandatory fallback.
3. **Who owns the map when the activity is shared/adopted?** Trees are pedagogy;
   an adopted activity's tree may need editing. Interacts with ALS-SHARE provenance.
4. **Does the tree survive a group's non-linear conversation?** Students do not
   move one question at a time. Tree position may need to be advisory rather than
   a state machine.
5. **Interaction with proactive/reactive turns.** A sim-event-reactive turn has no
   tree position. Probably exempt — confirm.
