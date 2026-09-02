# Tutors as research instruments — theory-grounded, co-piloted, authored by researchers *and* teachers

**Status**: **Design (OPEN)** — **1.1.91**. *Rewritten 2026-09-02 after review: the first draft had a preview but no co-pilot, was researcher-only, and gave researchers no sight of what teachers build. All three were the point.*
**Priority**: **P1** — the mechanism is un-gated, it opens the human gate `adk/authoring_framework.py` has carried since COPILOT-1, and it is the prerequisite for [1.1.92](session-benchmark-tutor-activity.md) having any arms to compare
**Estimated**: ~6.5–8.5d phased (M0 tutor object ~1d · M1 store + two tiers ~1.5d · M2 **tutor co-pilot** ~2d · M3 preview/compare ~1d · M4 researcher cross-view ~1d · M5 seeded library ~0.5d)
**Scope**: Backend — a `Tutor` object carrying its theory, a Firestore store with two authoring tiers, co-pilot proposal tools, and a `scope=all` read for researchers; frontend — a tutor editor on the **shipped** co-pilot shell, preview/compare, and a researcher catalogue
**Dependencies**: [1.1.20 interaction-style](tutor-personas.md) (**SHIPPED** — `adk/interaction_style.py`, the injection primitive this bundles); `adk/authoring_framework.py` (**M0 shipped; its docstring names the missing store**); `components/teacher/copilot/` + `adk/authoring_tools.py` (**SHIPPED** — the shell and propose→Apply tool pattern this reuses); [1.1.5 researcher-role](researcher-role.md) (**SHIPPED**); **ALS-SHARE** (**SHIPPED** — the sharing/provenance model this copies)
**Created**: 2026-09-02
**Source**: [notes-2026-09-01.md](../../../notes-2026-09-01.md) + the tutor discussion the notes under-captured

## Problem Statement

**A tutor is currently a file in git, and the people who own the pedagogy cannot
write files in git.**

There are eight of them — `backend/skills/templates/*/SKILL.md` — each carrying a
name, avatar, voice, opening message and prompt body. Adding a ninth, or changing
how any of them teaches, is an edit, a commit, a deploy and a seed. So the answer
to *"can we try a tutor built on self-determination theory?"* is currently
**"open a ticket with M."**

### The configurable layer that exists is tone, not theory

This is the sharp version of *"current tutors are placeholders really."*
`interaction_style` (1.1.20) ships and works, and its four options are:

```
concise.md    rigorous.md    socratic.md    warm.md
```

Those are **adjectives describing a voice.** They are not pedagogical
frameworks. Nothing anywhere in the system can express:

> This tutor operationalises **self-determination theory**. It supports
> *autonomy* by offering the student a choice of route; *competence* by pitching
> the next question just past what they have shown; *relatedness* by referring to
> the group's shared work. It is expected to increase persistence, and here is
> the source that claims so.

That gap is why the notes list ESRU, SDT and Dysthe as *"another tutor"* — those
are theories, and the system has no slot for a theory. And
`adk/authoring_framework.py` says the quiet part itself:

> ***Human gate:** the prompt + rubric below are a placeholder.*

### Three separate holes, and the first draft of this doc only filled one

| Hole | State |
|---|---|
| Researchers cannot author tutors | The store `authoring_framework.py` names as missing |
| **There is no help in authoring one** — the ask was a co-pilot *"similar to"* the activity one, not a text box | Not designed. The shell, the propose→Apply model and the tool pattern all ship and are unused for this |
| **Teachers cannot make custom tutors either**, and **researchers cannot see what teachers make** | Not designed. The first draft made this researcher-only, which removes the most interesting research data in the system |

**Why the third matters most.** *"What do teachers actually build when you give
them the tool?"* is a better research question than *"does SDT beat Socratic?"*,
and it is free — it falls out of letting teachers author and letting researchers
look. The platform already has this exact shape for **classes** (`scope=all` for
researchers) and for **activities** (ALS-SHARE: publish, adopt, provenance). This
is the third instance, and it should not be invented afresh.

## Design

### M0 — A tutor is an object that carries its theory

Not a prompt string. The theory is structured data because **a researcher has to
defend it** — in the [Applied AI overview](../../../notes-2026-09-01.md#publication),
and to a teacher asking why this tutor behaves as it does.

```
Tutor
  name, displayName, avatar, voice          # what SKILL.md already carries
  framework:
    id                                      # sdt | esru | dialogic | socratic | custom
    label, summary
    provenance                              # citation(s) + who vouched for it
    constructs: [                           # what the theory operates on
      { name: "autonomy",
        behaviours: ["offer a choice of route", …],   # observable, promptable
        evaluation_hint: "…" }               # feeds 1.1.92's rubric adapters
    ]
  prompt                                     # generated FROM the above, then editable
  interaction_style                          # resolves to the SHIPPED primitive
  lineage: { parent_tutor_id, kind }         # variant-of, as ALS-SHARE does
  status: draft | ready | in-use
```

Two properties earn their keep. **`constructs → behaviours` is what makes the
prompt reviewable** — a reader can check the prompt against the theory instead of
taking it on faith. And **`evaluation_hint` is the seam to 1.1.92**: a tutor that
claims to support autonomy states how you would know, at design time, rather than
having a rubric retro-fitted to it later.

### M1 — One store, two authoring tiers

| | **Researcher** | **Teacher** |
|---|---|---|
| Author a framework from scratch (theory, constructs, provenance) | ✅ | ❌ |
| Create a **variant** of an existing tutor (adjust behaviours, prompt, voice, opening) | ✅ | ✅ |
| Scope | Publishable to all | Own classes, publishable to colleagues |
| See **everyone's** tutors, incl. teacher-authored | ✅ (M4) | Own + published |

**Teachers get variants, not blank frameworks** — deliberately, and not as a
permissions grudge. A tutor with a theory field and no theory in it is worse than
no theory field: it makes an unfounded claim look founded. A teacher who wants
"SDT but warmer, and it should stop giving away the answer" gets exactly that,
with lineage back to the researched parent — **and the delta is itself the
research finding.**

Lineage means you can ask: *SDT as designed vs SDT as thirty teachers actually
adapted it.* That is a paper.

### M2 — The tutor co-pilot *(the piece the first draft missed)*

Same floating shell as the activity co-pilot (`components/teacher/copilot/`),
same **propose → Apply / Edit / Dismiss**, same tool-call shape as
`adk/authoring_tools.py`. Nothing new is invented; a fourth co-pilot mount joins
class management, analytics and activity authoring.

New proposal tools:

| Tool | What it proposes |
|---|---|
| `set_framework` | From *"I want a tutor grounded in self-determination theory"* — the framework, its constructs, and a provenance stub for the human to confirm |
| `set_construct_behaviours` | Concrete, promptable behaviours per construct — the step researchers find tedious and models are good at |
| `draft_tutor_prompt` | The prompt **generated from the constructs**, so it is traceable to the theory rather than free-written |
| `suggest_evaluation` | How you would tell whether it worked → 1.1.92 |
| `critique_tutor` | The inverse, and the most valuable for a researcher: *"your prompt claims to support autonomy but never offers a choice"* |

⚠️ **The co-pilot must not invent citations.** It proposes a framework *shape* and
leaves provenance for a human to supply or confirm. A model confabulating a
reference into a research instrument that ends up in a journal paper is the worst
failure available here, and it is a **hard requirement, not a caution** — see
Testing.

### M3 — Preview and comparison

The load-bearing half of *"simulations and previews"*: a scratch conversation
against the draft tutor on a chosen activity, **side by side against another
tutor**, because the question is nearly always comparative. Runs on the author's
own turns — **no student data**, and nothing written to the chat log as student
turns.

### M4 — Researchers see what teachers build

The `scope=all` pattern already shipped for classes, applied to tutors: a
researcher-facing catalogue of every tutor including teacher-authored variants,
with lineage, usage counts, and a link into 1.1.92's scores.

Access is **read-only and logged**, exactly as class reads are
(`auth.researcher_bypass` on the span). Teachers should be told this is visible —
it is their professional work, and the trust-card principle applies to teachers
as much as to students.

### M5 — Seeded library

**ESRU**, **SDT**, **dialogic/Dysthe** (*"authentic questions"*), **IBSE**, and a
**"Bob Evans"** persona — the transcript's list, which is longer than the
dictated notes captured. Ships the slots; the content is JB's and Aswin's.

⚠️ **They are not a flat list.** The transcript sets a structure the first draft
of this doc missed: **Embodied Cognition is the umbrella theory**, with SDT
incorporated inside it to inform motivation and well-being, grounded in
literature per curriculum level. JB is starting this work; Aswin is gathering the
literature. So `framework` (M0) needs a **parent** — a persona is an
operationalisation *of* something, not a peer of it — and the field should be
shaped with JB before M5 rather than after.

### M6 — The clash gatekeeper

Flagged in the transcript, and explicitly *"discussed but not designed"*: an
activity authored as Socratic, run under a non-Socratic persona, produces a tutor
fighting itself. The mechanism already half-exists — `interaction_style`'s
non-Socratic preambles **countermand** the SKILL.md rule, which is precisely the
collision, done deliberately.

So the gatekeeper is a **compatibility check at assignment time**, not a runtime
guard: when a tutor is attached to an activity, warn where the activity's style
and the tutor's prescribed behaviours contradict. Advisory — a researcher may
*want* the clash, and measuring it is a legitimate experiment ([1.1.92](session-benchmark-tutor-activity.md)).
~0.5d.

⚠️ Names are phonetic transcriptions from the notes with confidence recorded —
**not verified citations** (see [Terms I inferred](../../../notes-2026-09-01.md#terms-i-inferred)).
**M0–M4 are not gated on M5.** That separation is the 1.1.78 lesson and it is the
whole reason this doc can start now.

## Milestones

| M | What | Est | Gate |
|---|---|---|---|
| M0 | `Tutor` object with framework/constructs/lineage | ~1d | None |
| M1 | Store + researcher/teacher tiers + variants | ~1.5d | None |
| M2 | **Tutor co-pilot** on the shipped shell | ~2d | None |
| M3 | Preview + side-by-side comparison | ~1d | None |
| M4 | Researcher cross-view over teacher-authored tutors | ~1d | Tell teachers first |
| M5 | Seeded framework library (ESRU, SDT, dialogic, IBSE, "Bob Evans") | ~0.5d | **JB / AR content + the umbrella structure** |
| M6 | Persona × activity clash gatekeeper (advisory) | ~0.5d | M0 |

## Testing

- An activity with no tutor override behaves byte-identically (passthrough, as `socratic` does today)
- A tutor resolves to exactly the `interaction_style` preamble the primitive already injects
- A **teacher** cannot create a bare framework; **can** create a variant; a **student** sees neither
- A variant records lineage to its parent, and the parent's later edits do **not** silently mutate it
- **`set_framework` never emits a provenance string the human did not supply** — asserted directly, because a fabricated citation is the failure that matters most here
- Preview turns are never written as student data
- A researcher read of a teacher's tutor tags the span, as class reads do

## Open questions

1. **Do the eight existing `SKILL.md` tutors migrate into this model, or coexist?**
   Coexistence means two ways to define a tutor — the half-adoption pattern the
   handover audit calls the worst outcome. Leaning migrate, after M1.
2. **Does a teacher's variant need approval before students see it?** A governance
   question, not a technical one. Interacts with [1.1.95](safe-to-publish-vetting.md),
   which is the same question for activities.
3. **Tutor per activity, per class, or both?** 1.1.92 needs it recorded per
   session whatever the answer.
4. **Versioning.** [1.1.92](session-benchmark-tutor-activity.md) needs an edited
   tutor to be a *new version*, or earlier sessions become unattributable.
5. **Are ESRU / Dysthe the right names** for what JB and Aswin mean?
6. **Does a theory-grounded tutor need a "why am I like this?" surface for
   students?** Fits [prompt-transparency-and-config](prompt-transparency-and-config.md),
   and is a strong differentiator for the paper.
