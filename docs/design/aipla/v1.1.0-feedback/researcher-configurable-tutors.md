# Tutors as research instruments — theory-grounded, co-piloted, authored by researchers *and* teachers

**Status**: **Design (OPEN)** — **1.1.91**. *Rewritten 2026-09-02 after review: the first draft had a preview but no co-pilot, was researcher-only, and gave researchers no sight of what teachers build. All three were the point.* **⭐ CHOSEN 2026-09-09 as the extension's workstream D** (*"go on doing tutors now"* — decision D7, [09-09 triage](meeting-2026-09-09-triage.md)), and M5 revised: the seven TP frameworks and their primary literature are on disk.
**Priority**: **P1** — the mechanism is un-gated, it opens the human gate `adk/authoring_framework.py` has carried since COPILOT-1, and it is the prerequisite for [1.1.92](session-benchmark-tutor-activity.md) having any arms to compare
**Estimated**: **~8.5–11d phased** (M0 tutor object ~1d · **M7 migrate the existing tutors ~1–1.5d** · M1 store + two tiers ~1.5d · M2 **tutor co-pilot** ~2d · M3 preview/compare ~1d · M4 researcher cross-view ~1d · M5 seeded library ~1d · M6 clash gatekeeper ~0.5d) — *revised 2026-09-09: M5 re-sized to seven frameworks, M7 added by the migrate decision*
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

**A second audience, added 2026-09-09: teachers, studying how a tutor teaches.**
From the 09-09 meeting — *"teachers can use the tutors as teaching training to
see the different ways we teach."* Every tutor doc in this repo assumes the
tutor's user is a student; this one is a professional comparing seven
operationalised pedagogies by talking to them. **It needs almost no new build** —
it is M3 pointed at a person rather than at a configuration screen — but it does
change what M3 is *for*, and therefore what it should look like: a comparison a
teacher reads, not a diff an author checks. It also makes the seven-tutor library
valuable **before a single student uses it**, which matters a great deal while
both legal gates are shut.

**And M3's transcript is the input to the training loop.** M, 2026-09-09:
*"we can use that then for teacher training."*
[1.1.107 framework-fit-profile](framework-fit-profile.md) M4 reads a preview
conversation back through all seven framework lenses, so a teacher talks to the
ESRU tutor and is shown what it actually did, in each tradition's own terms.
**No student data, no consent question, no legal gate** — which makes it the one
teacher-facing use of the tutor library available today.

### M4 — Researchers see what teachers build

The `scope=all` pattern already shipped for classes, applied to tutors: a
researcher-facing catalogue of every tutor including teacher-authored variants,
with lineage, usage counts, and a link into 1.1.92's scores.

Access is **read-only and logged**, exactly as class reads are
(`auth.researcher_bypass` on the span). Teachers should be told this is visible —
it is their professional work, and the trust-card principle applies to teachers
as much as to students.

### M5 — Seeded library

**⭐ REVISED 2026-09-09 — the library now has a known size, a source, and its
primary literature on disk.** The 9 September meeting delivered Aswin's "TP
Framework" Drive folder with the instruction ***"a tutor for each of these
folders"***. That is **seven**, not the open-ended list below, and each arrives
with the paper it operationalises:

| Framework | Primary source | On disk |
|---|---|---|
| **5E learning cycle** | Tanner 2017, *Order Matters* | ✅ |
| **Accountable Talk** | Institute for Learning, AT Sourcebook | ✅ |
| **Authentic Dialogue** | **Dysthe 1996, *The Multivoiced Classroom*** | ✅ |
| **Claim–Evidence–Reasoning (CER)** | *Inquiry and Scientific Explanation* chapter | ✅ |
| **ESRU** — elicit / student response / recognise / use | **Ruiz-Primo & Furtak 2006**, J Res Sci Teach | ✅ |
| **POE** — predict, observe, explain | ERIC ED420715 | ✅ |
| **Toulmin argumentation** | Erduran, Simon & Osborne 2004 | ✅ |

Citation table: [`docs/literature/tp-framework/README.md`](../../../literature/tp-framework/README.md).
The PDFs and their parsed full text are **gitignored** — the repo is public and
these are copyrighted journal articles. Do not publish them into
`frontend/content/` or quote them at length into a `SKILL.md`.

**Two of these were unverified guesses seven days ago.** The 1 September triage
carried ESRU at *medium confidence* and Dysthe with *"no idea what the intended
action is"*. Both now have a paper and a verb. Recorded because the ⚠️ below
still applies to everything **not** in this table.

**SDT sits on a different layer and the object must be able to say so.** The
literature README puts SDT and embodied cognition in the **conceptual
framework** — the research/theoretical perspective — and explicitly *not* in the
teaching-practice cycle. So a "SDT tutor" (asked for again on 09-09, from
material Aswin sent) and an "ESRU tutor" are not siblings: one describes what
motivates a learner, the other describes a move a teacher makes in a dialogue.
M0's `framework` field needs the **parent** already flagged below *and* a
**layer**, or the library will flatten a distinction its own sources take care
to draw.

**And the definitional gap is now on the record.** *"What is a Socratic bot
actually? Definition"* — asked directly in the 09-09 meeting, and it is the
sharpest available statement of this doc's premise. The product **already ships
`socratic`**, as one of four tone adjectives, as the **default**, and — from
`adk/interaction_style.py` — as a **passthrough that injects nothing at all**.
So AIPLA claims to teach Socratically, cannot say what that means, and
implements it as an absence. Answering the question is AR's and JB's;
**making the answer expressible, and checkable against the tutor's behaviour, is
M0.**

Ships the slots; the content is JB's and Aswin's.

#### The example conversations — ask for them explicitly

The meeting noted that the framework folders *"have examples of conversations"*.
**They were not in the copied Drive folder and they are the more valuable half.**
Worked dialogues annotated in a framework's own terms are the one thing
[1.1.92](session-benchmark-tutor-activity.md) M3 has no source of: ground truth.
Without it, calibration is an LLM judging an LLM, which is precisely the
*"models rate highly"* failure the 1 September transcript raised. → **action on
Aswin.**

⚠️ **They are not a flat list.** The transcript sets a structure the first draft
of this doc missed: **Embodied Cognition is the umbrella theory**, with SDT
incorporated inside it to inform motivation and well-being, grounded in
literature per curriculum level. JB is starting this work; Aswin is gathering the
literature. So `framework` (M0) needs a **parent** — a persona is an
operationalisation *of* something, not a peer of it — and the field should be
shaped with JB before M5 rather than after.

### M7 — Migrate the eight `SKILL.md` tutors *(decided 2026-09-09: migrate, do not coexist)*

**Open question 1 is answered: the eight existing tutors move into the model.**
Coexistence was the alternative and it is the half-adoption pattern the handover
audit names as the worst outcome — two ways to define a tutor means every later
feature (the co-pilot, the clash gatekeeper, versioning, the
[1.1.92](session-benchmark-tutor-activity.md) arm,
[1.1.107](framework-fit-profile.md)'s fidelity check) has to be built twice or
silently work for only half the tutors.

**The migration is also the honest test of M0's schema.** If the eight real
tutors do not fit the `Tutor` object, the object is wrong — better to discover
that against `led-planck-tutor` than against a researcher's first SDT draft.

Sequencing, and it matters:

1. **M0 first, then migrate, then M1's store.** Migrating into a schema that has
   not survived contact with the existing eight is how the schema acquires a
   permanent workaround.
2. **`SKILL.md` stays the seed source, not a second definition.** The existing
   deploy-time seed (`platform_seed`, `make seed`) already reads
   `skills/templates/*/SKILL.md` into Firestore. The migration extends that path
   to emit `Tutor` objects — **one pipeline, not two** — so a git-authored tutor
   and a researcher-authored tutor land in the same store and are the same kind
   of thing thereafter.
3. **A migrated tutor's `framework` is honestly empty.** None of the four
   operationalises a named theory, and back-filling one would be the exact
   failure M1 refuses for teachers: *a theory field with no theory in it makes an
   unfounded claim look founded.* They migrate as `framework: null`, which is
   also a finding — it is the baseline arm [1.1.107](framework-fit-profile.md)
   measures the framework tutors *against*.

⚠️ **Only half of the eight are tutors.** `manage-class`, `analytics-chat`,
`activity-authoring-assistant` and `aipla-help` are **teacher tools** riding the
same `SKILL.md` mechanism. **Migrate the four student-facing tutors only** —
`concept-dialogue`, `kinebot-kinematics-tutor`, `led-planck-tutor`,
`problem-set-hints`; the other four keep the plain skill path. Getting this wrong
would put a class-management assistant in a tutor catalogue and, worse, into the
1.1.92 matrix as an arm.

**Regression bar: byte-identical behaviour.** A migrated tutor must resolve to
the same prompt it produces today — the same standard `interaction_style` holds
for `socratic` passthrough. This is a refactor with a schema attached, and it
should be provable as one.

~1–1.5d.

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
| M5 | Seeded framework library — **seven TP frameworks, literature on disk** (5E, Accountable Talk, Dysthe, CER, ESRU, POE, Toulmin) + SDT on the conceptual layer | ~1d (**re-estimated 2026-09-09** — seven is a known size, not a slot) | **JB / AR content + the umbrella structure**; the *example conversations* are an action on Aswin |
| M6 | Persona × activity clash gatekeeper (advisory) | ~0.5d | M0 |
| **M7** | **Migrate the 4 student-facing `SKILL.md` tutors** into the store, `framework: null`, byte-identical output | **~1–1.5d** | **M0 (schema must survive them first)** |

## Testing

- An activity with no tutor override behaves byte-identically (passthrough, as `socratic` does today)
- A tutor resolves to exactly the `interaction_style` preamble the primitive already injects
- A **teacher** cannot create a bare framework; **can** create a variant; a **student** sees neither
- A variant records lineage to its parent, and the parent's later edits do **not** silently mutate it
- **`set_framework` never emits a provenance string the human did not supply** — asserted directly, because a fabricated citation is the failure that matters most here
- Preview turns are never written as student data
- A researcher read of a teacher's tutor tags the span, as class reads do

## Open questions

1. ~~Do the eight existing `SKILL.md` tutors migrate, or coexist?~~
   **ANSWERED 2026-09-09 (M): MIGRATE** — the four student-facing ones, after M0
   and before M1's store. → **[M7](#m7--migrate-the-eight-skillmd-tutors-decided-2026-09-09-migrate-do-not-coexist)**
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
