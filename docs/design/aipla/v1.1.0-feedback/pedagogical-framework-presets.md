# Pedagogical framework presets — Betty's Brain, Productive Failure, and teacher-authored frameworks

**Status:** Design (OPEN) — **P1.** Written 2026-08-06 from Aswin's 2026-08-06 feedback, endorsing Jesper's steer.
**Priority:** **P1** — this is the research programme's core question in product form: *does the tutor's pedagogical stance change what students learn?* Without a second framework there is nothing to compare Socratic against, and Strand A's research design has no independent variable. Material for the **21 August teacher training**.
**Estimated:** ~3d (M1 framework axis ~0.75d · M2 Betty's Brain ~0.75d · M3 Productive Failure + phase state ~1d · M4 teacher-authored ~0.5d). Excludes the pedagogical authoring itself, which is AR/JB work.
**Scope:** Backend-heavy — a `pedagogical_framework` field on `ActivityConfig` orthogonal to `interaction_style`, a framework preamble set beside [`backend/skills/preambles/interaction_style/`](../../../../backend/skills/preambles/interaction_style/), phase state for Productive Failure, and a teacher-authored override riding [1.1.47](prompt-transparency-and-config.md). Frontend: a framework picker + explainer in the activity builder.
**Dependencies:** [1.1.47 prompt-transparency-and-config](prompt-transparency-and-config.md) (**OPEN** — the override⊕default Firestore store M4 rides); [authoring-teaching-framework.md](authoring-teaching-framework.md) (**OPEN** — the *researcher-owned* framework for the **authoring co-pilot**; this doc is its student-tutor sibling, see the distinction below); [1.1.12 tutor-personas](tutor-personas.md) (**SHIPPED** — `interaction_style`, the axis this must not be confused with); [1.1.27 lesson-author-surface](lesson-author-surface.md) (**OPEN** — the resolved-prompt preview that makes an active framework legible); [workbench-element-awareness](workbench-element-awareness.md) (1.1.62 — a framework must compose with the element manifest, not overwrite it)
**Source:** Aswin, 2026-08-06 — *"I agree with Jesper where we can give some freedom to the teachers for designing their lesson prompt. We can give some option where teachers can choose, or they can design their own. We have Socratic dialog for one option. This might be other option: **Betty's Brain** … students teach the agency to learn ([Leelawong & Biswas 2008](https://link.springer.com/article/10.1007/s40593-015-0057-9)) … **Productive Failure** — students attempt to solve problems before the instruction to reveal their understanding/alternative conceptions ([Kapur & Bielaczyc 2012](https://www.tandfonline.com/doi/epdf/10.1080/10508406.2011.591717))."* M's reply: *"Will look at adding the two teaching prompt options."*
**Created:** 2026-08-06 (M)
**Last Updated:** 2026-08-06 (M)

## Problem Statement

**AIPLA has one pedagogy, and it is hardcoded as the default.**

The tutor's stance is Socratic everywhere. `InteractionStyle` looks like it
offers alternatives —

```python
InteractionStyle = Literal["socratic", "concise", "rigorous", "warm"]
```

— but read the preambles and it is clear these are **register, not pedagogy**.
`socratic` is a passthrough (`_PASSTHROUGH = "socratic"`, the baked-in
"≤3 sentences, end with a question" rule); the other three append a tone
override. All four are the same teacher speaking in different voices: an expert
who asks leading questions. `interaction_style` is additionally **tied to
persona** — picking a class persona sets avatar, voice and style together —
which is right for voice and wrong for pedagogy. A teacher should not have to
change the tutor's *character* to change its *method*.

What Jesper and Aswin are asking for is different in kind. **Betty's Brain**
inverts the expertise relation: the AI is a confused peer the student teaches,
and its confusion is the pedagogical instrument. **Productive Failure** inverts
the *sequence*: the student attempts before any instruction, and the tutor's job
in phase one is to withhold help it is perfectly capable of giving.

Neither is a tone. Both contradict the Socratic default at the level of what the
tutor is *for*.

### Why this is the research programme's problem, not just a feature

AIPLA's Strand A asks whether AI tutoring changes physics learning. With exactly
one pedagogy in the product, there is no independent variable — every arm of
every comparison is Socratic. The [deploy runbook's A/B mechanism](../../../ops/runbooks/deploy.md)
(tagged Cloud Run revisions per class, `revision` stamped on every chat-log row)
exists precisely to compare arms, and currently has nothing pedagogically
distinct to compare. **A second framework is what makes the A/B capability
mean something.**

### Distinguishing this from `authoring-teaching-framework.md`

These are easy to confuse and are not the same doc:

| | [authoring-teaching-framework.md](authoring-teaching-framework.md) | **This doc** |
|---|---|---|
| Steers | The **authoring co-pilot** — how it helps a teacher *build* an activity | The **student tutor** — how it teaches once the activity runs |
| Owner | Researchers (AR/JB) | Teacher chooses per activity; researchers author the presets |
| Artefact | A meta-prompt over `activity-authoring-assistant/SKILL.md` | A framework preamble over the student tutor's instructions |

They share the [1.1.47](prompt-transparency-and-config.md) override⊕default
substrate. They do not share a prompt.

## Goals

**Primary:** A teacher chooses the pedagogical framework for an activity —
Socratic, Betty's Brain, Productive Failure, or their own — and the tutor
genuinely adopts it.

**Success metrics:**

- Betty's Brain: the tutor sustains the taught-peer role across a session
  without collapsing back into explaining. **This is the hard part** and needs an
  eval, not a vibe check.
- Productive Failure: the tutor withholds instruction during the attempt phase
  and transitions on a defined trigger, visible to the student.
- Framework is orthogonal to persona/tone — any framework with any persona.
- A framework is legible: teacher sees what it does before choosing; student is
  told when the tutor's role is unusual.
- Framework id is stamped on every chat-log row, so an A/B arm is analysable.

**Non-goals:**

- Making the framework the co-pilot's choice — the teacher picks.
- Framework-specific UI surfaces (Betty's Brain's original had a concept-map
  artefact the student edits; ours reuses the shipped [concept map](living-concept-map.md)).
- Validating the pedagogy. That is the research, not the build.
- Replacing `interaction_style`.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | A preamble on a prompt composed once per session. Phase state is one small read. |
| 2 | EARNED TRUST | +1 | A tutor playing a confused peer **must not deceive**: the student is told at session start that the AI is playing a learner. Withholding help in Productive Failure is announced as deliberate ("I want to see your attempt first"), never silent incapacity. See Security/Ethics. |
| 3 | SKILLS, NOT FEATURES | +1 | The framework is expressed in the skill's own instructions, not a parallel engine. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No extra calls; the phase-transition judgement rides the turn already happening. |
| 5 | GRACEFUL DEGRADATION | +1 | Unset → Socratic, today's behaviour. Missing preamble file → passthrough, exactly as `_load_preamble` already handles it. Phase state unavailable → Productive Failure degrades to Socratic rather than sulking. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Reuses the shipped file-based preamble + injection mechanism; adds no second prompt-layer system. |
| 7 | API FIRST | +1 | `pedagogical_framework` rides the activity contract; `GET /api/frameworks` lists them for builder and CLI alike. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Framework id + version stamped on chat-log rows — without it an A/B arm is unanalysable. |
| 9 | SECURE BY CONSTRUCTION | 0 | Preset preambles are repo files; teacher-authored text is teacher-scoped and treated as untrusted content (below). |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | All composition server-side; the client renders a picker. |
| 11 | USABLE BY DESIGN | +1 | A named framework with an explanation is more usable than a blank prompt box, which is what "design your own" means today. |
| | **Net Score** | **+7** | Threshold: >= +4 |

## Framework-Native Capability Check

- **The injection mechanism is shipped.** `inject_interaction_style_preamble`
  loads `{style}.md` from a preamble dir, appends after base instructions
  (later instruction wins), caches, and falls back on a missing file. The
  framework axis reuses this **verbatim** with a second directory and a second
  field. No new plumbing.
- **Phase state has a precedent.** Productive Failure's attempt→instruction
  boundary is the same shape as CONCEPT-1's per-group `concept_progress`:
  per-group, survives rejoin, read fresh by a tool. Reuse that store's shape;
  do not build a third progress store.
- **The teacher-authored override is [1.1.47](prompt-transparency-and-config.md)'s
  job.** M4 registers the framework as one more prompt layer in that store
  rather than adding a bespoke Firestore collection. If 1.1.47 has not landed,
  M4 waits — it does not fork.

## Design

### The core decision: a second axis, not more `InteractionStyle` values

```python
# Register (voice) — unchanged, persona-tied
InteractionStyle = Literal["socratic", "concise", "rigorous", "warm"]

# Method (pedagogy) — new, orthogonal, activity-scoped
PedagogicalFramework = Literal["socratic", "bettys_brain", "productive_failure", "custom"]
```

Adding `bettys_brain` to `InteractionStyle` would have been cheaper and is
wrong for three reasons: `interaction_style` is **persona-tied** (a teacher
would have to change the tutor's character to change its method); `socratic` is
the **passthrough sentinel** in that enum, so a framework whose whole point is
overriding Socratic cannot live in an enum where Socratic means "no override";
and the two axes must be **independently analysable** in the chat logs to be
research data.

`socratic` appears in both enums deliberately: on the framework axis it is the
default passthrough, preserving today's behaviour exactly.

### Composition order

The tutor's instructions are assembled as:

```
base SKILL.md
  ⊕ {teacher_focus}      -> sim tutor_block, elements manifest (1.1.62),
                            ILOs, concept map, teaching goal
  ⊕ framework preamble    <- NEW: how to teach
  ⊕ interaction style     -> how to sound
```

Framework before register, so tone modifies method rather than the reverse.
**The framework must not overwrite the element manifest** — Betty's Brain still
needs to know the workbench has a data table; a confused peer that cannot see
the student's apparatus is useless. Composition, not replacement. The 1.1.62
completeness test extends to assert the manifest survives every framework.

### M2 — Betty's Brain

The AI is a peer learner the student teaches. Its confusion is diagnostic: what
the student cannot explain is what the student does not understand.

Contract, in the preamble:

- You are learning this topic **with** the student, not teaching it. You do not
  have the answer.
- Ask the student to explain. When their explanation has a gap, be **plausibly
  confused at the gap** — not randomly confused, and never wrong on purpose in a
  way that plants a misconception.
- You may be corrected, and should update visibly when you are.
- If the student is completely stuck for several turns, step out of role
  explicitly ("let me stop being the student for a second") rather than
  abandoning them.

**The hard problem is role stability.** Every base instruction says "you are a
physics tutor", and a model under pressure to be helpful reverts to explaining.
Mitigations: the framework preamble is appended last among prompt layers (later
wins); the base skill's tutor-identity line is made framework-conditional rather
than absolute; and the eval measures **role adherence over 15 turns**, not 3 —
collapse happens late.

The escape hatch is deliberate. An unrelieved confused peer is a bad experience
for a struggling student, and Axiom 11 outranks fidelity to a 2008 paper.

### M3 — Productive Failure

Two phases: **Generation** (student attempts an unfamiliar problem with no
instruction, surfacing their intuitive approaches) then **Consolidation** (the
tutor compares what the student produced against the canonical method).

This is the milestone that is not just a preamble, because a phase boundary is
**state**:

| | Generation | Consolidation |
|---|---|---|
| Tutor withholds method | yes | no |
| Tutor asks for another approach | yes | no |
| Tutor names the canonical solution | **no** | yes |

Transition triggers, whichever comes first: the student produces N distinct
attempts; the student explicitly asks to move on; a teacher-set time budget
expires; the student is unproductively stuck (repeats without variation).

Implementation: a `phase` on the same per-group store CONCEPT-1 uses, plus a
`advance_to_consolidation(reason)` tool. The transition is **announced to the
student** and carded — the moment a tutor changes its rules, a student is
entitled to know.

**The withholding must be honest.** The preamble says: *"say plainly that you
are holding back the method on purpose and why; never pretend you don't know."*
A tutor feigning ignorance is a trust violation (Axiom 2) and, unlike Betty's
Brain — where the role is disclosed up front — would be undisclosed deception.

**Productive Failure is only productive if the problem is right.** It needs a
genuinely unfamiliar problem with multiple plausible approaches. A routine
exercise makes the withholding pointless and irritating. The builder warns when
Productive Failure is selected on an activity with a solution element and no
teaching goal describing a novel problem — and this constraint goes in the
teacher-facing explainer, because it is the thing most likely to make the
framework fail in the pilot.

### M4 — Teacher-authored frameworks

`framework: "custom"` + a teacher-authored preamble stored via
[1.1.47](prompt-transparency-and-config.md)'s override⊕default registry.

- Presented as **"start from a preset and edit"**, never a blank box — the
  preset text is loaded in as the starting point.
- Bounded (2000 chars) and counted against the `SkillConfig` 10k instruction cap
  together with everything else `{teacher_focus}` stacks (memory
  `feedback-skill-instructions-10k-cap`).
- Treated as **untrusted content**: it can shape the tutor's stance but must not
  be able to disable safety instructions or the disclosure rules above. Safety
  and disclosure layers compose **after** the custom preamble.

### Frontend Changes

A framework picker in the activity builder, beside (not inside) the persona
panel — the separation is the point. Each option shows a one-paragraph
explainer, an example exchange, and its citation. Selecting a non-Socratic
framework shows what changes for the student.

Students get a one-line notice at session start when the framework is not
Socratic ("In this activity the AI plays a fellow student you're teaching").

### API Changes

- `GET /api/frameworks` — id, label, description, example, citation. Powers the
  builder and the CLI from one contract.
- `pedagogical_framework` on the activity POST/PATCH payload (**complete
  payload** — the full-overwrite footgun).

### CLI Surface

- `aiplatform activity set-framework <id> --framework productive_failure`
- `aiplatform framework list` / `show <id>` — print the exact preamble text.
  Same argument as 1.1.62's manifest command: a prompt layer nobody can render
  is a prompt layer nobody can debug.

## Implementation Plan

### M1 — Framework axis (~0.75d)
- `PedagogicalFramework` on `ActivityConfig`; `backend/skills/preambles/pedagogical_framework/`
- `inject_framework_preamble` (mirrors `inject_interaction_style_preamble`)
- Composition order + a test that the element manifest survives
- `GET /api/frameworks`, CLI, framework id on chat-log rows

### M2 — Betty's Brain (~0.75d)
- `bettys_brain.md` preamble (AR/JB review the pedagogy)
- Framework-conditional tutor-identity line in the base skill
- Student notice; **15-turn role-adherence eval**

### M3 — Productive Failure (~1d)
- `productive_failure.md`; phase state on the per-group store
- `advance_to_consolidation` tool + student-visible announcement + trust card
- Builder warning on unsuitable activities
- Eval: no canonical method named during Generation; transition fires

### M4 — Teacher-authored (~0.5d)
- `custom` framework riding 1.1.47's override store, seeded from a preset
- Bounds + safety-layer-after-custom composition test

## Migration & Rollout

Field defaults to `socratic` = today's behaviour; no backfill. Behind
`AIPLA_PEDAGOGICAL_FRAMEWORKS`, dev first, and **not enabled for pilot classes
until AR/JB sign off on the preamble text** — the pedagogy is theirs, not
engineering's.

> Flag passed as a build-arg needs its [`cloudbuild.promote.yaml`](../../../../cloudbuild.promote.yaml)
> twin, or it never reaches prod. The feature flags were missing there once
> already and no tfvar could light them up.

Preambles live in `SKILL.md`-adjacent files, so **a change needs a seed**
(`make seed ENV=dev`) — the "works in tests, deployed app shows old behaviour"
footgun applies directly here.

## Testing Strategy

### Backend (pytest)
- Framework resolution: activity → default; unknown → passthrough; missing file → passthrough
- Composition order: framework precedes register; **element manifest present under every framework**
- Custom preamble cannot suppress the safety/disclosure layers
- Total composed instruction stays under the 10k cap with a maximal config
- Phase state: per-group, survives session change; transition idempotent

### Eval (ADK) — the real gate
- **Betty's Brain role adherence over 15 turns** — the tutor does not revert to
  explaining; it never asserts a *wrong* physics claim while confused
- Betty's Brain escape hatch fires on a persistently stuck student
- **Productive Failure Generation phase names no canonical method**, across a
  student who asks for the answer three times
- Transition fires on each trigger; the announcement is visible
- Framework × persona matrix: each framework holds under each persona

### Frontend (Vitest + RTL)
- Picker renders explainers; student notice appears only for non-Socratic
- Transition trust card renders
- `make audit-trust-cards` green

## Security Considerations

**The ethics are the security surface here.**

- **Disclosure.** Betty's Brain is role-play, disclosed at session start. Without
  disclosure, a system telling a 16-year-old it does not understand physics is
  simply lying to them.
- **No planted misconceptions.** Betty's Brain confusion sits at genuine gaps in
  the student's explanation; the preamble forbids asserting false physics.
- **Honest withholding.** Productive Failure says it is holding back and why.
- **Custom preambles are untrusted.** Teacher text composes *before* safety and
  disclosure layers, so it cannot remove them. This is a prompt-injection
  surface with a teacher-shaped entry point — treat it as such.
- Framework choice is activity config, written through the shipped owner-scoped
  path; no new ACL.

## Success Criteria

- [ ] Framework is orthogonal to persona — any framework with any persona
- [ ] Betty's Brain holds role for 15 turns without reverting to explaining
- [ ] Betty's Brain never asserts wrong physics while confused
- [ ] Productive Failure names no canonical method during Generation
- [ ] Transition is triggered, announced and carded
- [ ] Student is told when the tutor's role is non-standard
- [ ] Element manifest survives every framework
- [ ] Framework id on chat-log rows (A/B analysable)
- [ ] `aiplatform framework show` prints the live preamble
- [ ] Custom preamble cannot suppress safety/disclosure

## Open Questions

1. **Does Betty's Brain need its own artefact?** The original pairs the taught
   agent with a concept map the student edits and the agent is quizzed on. We
   have [a concept map](living-concept-map.md). Composing them is attractive and
   is a second doc, not this one.
2. **Can a framework change mid-activity?** Productive Failure's phases are
   internal, but a teacher might want Socratic-then-Betty's. Out of scope;
   noting it because the phase machinery would generalise.
3. **Who authors the preamble text?** Engineering can draft from the two papers,
   but AR/JB own it. **Blocking for M2/M3 pilot enablement, not for M1.**
4. **Which framework does a *class-level* default use?** `interaction_style`
   inherits from the class persona. Proposed: framework is **activity-only** —
   it is a property of the task, not the class.
5. **Is 21 August the right forum?** This is the most discussable item in the
   feedback round and the training already has teachers in a room. Proposed:
   demo M1+M2 in dev, and treat the session as the pedagogy review AR/JB owe M2.

## Related Documents

- [authoring-teaching-framework.md](authoring-teaching-framework.md) — the co-pilot-side sibling; read the distinction table above
- [prompt-transparency-and-config.md](prompt-transparency-and-config.md) — 1.1.47, the override store M4 rides
- [living-concept-map.md](living-concept-map.md) — per-group progress state precedent; the Betty's Brain artefact question
- [workbench-element-awareness.md](workbench-element-awareness.md) — 1.1.62, the manifest a framework must not overwrite
- [lesson-author-surface.md](lesson-author-surface.md) — 1.1.27, resolved-prompt preview
- [docs/ops/runbooks/deploy.md](../../../ops/runbooks/deploy.md) — the per-class A/B revision mechanism this gives content to
- Leelawong & Biswas (2008), *Designing Learning by Teaching Agents: The Betty's Brain System* — https://link.springer.com/article/10.1007/s40593-015-0057-9
- Kapur & Bielaczyc (2012), *Designing for Productive Failure* — https://www.tandfonline.com/doi/epdf/10.1080/10508406.2011.591717
- [docs/notes-2026-08-03.md](../../../notes-2026-08-03.md) — Aswin's raw feedback
