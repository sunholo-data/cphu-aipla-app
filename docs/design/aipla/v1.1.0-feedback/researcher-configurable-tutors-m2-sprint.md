# Sprint Plan: TUTOR-4 — teachers author, researchers watch, the co-pilot helps (1.1.91 M1b/M1c/M4/M2)

## Summary

The four things the shipped tutor layer still cannot do, in the order that makes each one
land on solid ground:

1. **Teachers cannot make a tutor at all** (M1b) — every authoring route is researcher-only.
2. **Researchers cannot see what teachers make** (M4) — and it is the more interesting half.
3. **A researcher's edit breaks the trace to the theory** (M1c) — they edit rendered text, not constructs.
4. **There is no help authoring one** (M2) — the ask was a co-pilot, not a text box.

**Duration:** ~4.75–5.25 days · **Scope:** Fullstack · **Design doc:** [1.1.91](researcher-configurable-tutors.md) M1b · M1c · M4 · M2
**State it builds on:** M0, M1a, M5 (2 of 7), M7 all shipped and in production.

## The sequencing argument, because it is the whole plan

**M1b and M4 are one piece of work, not two.** Letting teachers author produces nothing
observable until researchers can look; letting researchers look shows an empty list until
teachers can author. Split across sprints, each looks like a feature that does nothing.
Together they produce the finding the design doc says is *better than the headline research
question*:

> *"What do teachers actually build when you give them the tool?"* is a better research
> question than *"does SDT beat Socratic?"*, and it is free — it falls out of letting
> teachers author and letting researchers look.

**M1c before M2.** The co-pilot's `draft_tutor_prompt` proposes a prompt *generated from
constructs*. If constructs are not editable, the co-pilot's output can only be applied as
free text and the theory trace it exists to preserve is broken on arrival. Structural editing
is what gives the co-pilot somewhere to put its proposals.

## Milestones

### M1b — The teacher tier
**Scope:** fullstack · ~0.75–1d
- [ ] Teacher-scoped variant creation: a teacher may fork an existing tutor, never author a bare framework — *"a tutor with a theory field and no theory in it is worse than no theory field"*
- [ ] `author_role: "teacher"` + owner scoping on the store; a teacher sees the shared catalogue plus their own
- [ ] Reuse `TutorVariantDialog` — it already inherits-what-you-do-not-state and shows the parent; the change is who may open it and what they may set
- [ ] **A teacher may not choose a placeholder framework** (already true in the dialog) **and may not clear a researched framework silently** — changing pedagogy is the delta worth recording
- [ ] Open question 2 is a **governance** call, not a technical one: does a teacher's variant need approval before students see it? Interacts with [1.1.95](safe-to-publish-vetting.md). **Ask JB/AR; default to no approval and full lineage until told otherwise**

**Acceptance:** a teacher forks Sofie·ESRU into their own variant, uses it on their class, and cannot create a framework from scratch. A researcher's tutors remain visible to them; another teacher's are not.

### M4 — Researchers see what teachers build
**Scope:** fullstack · ~0.75d
- [ ] `scope=all` on the tutor catalogue — the third instance of the pattern already shipped for classes and activities, **not a new mechanism**
- [ ] Researcher catalogue view: every tutor including teacher-authored, with lineage, author, and usage count
- [ ] Read-only and **logged** (`auth.researcher_bypass` on the span), exactly as class reads are
- [ ] ⚠️ **Gate: teachers are told first.** It is their professional work, and the trust-card principle applies to teachers as much as to students

**Acceptance:** a researcher sees a teacher's variant with its parent and its usage; the read is span-tagged; a teacher sees a plain statement that researchers can see tutors they create.

### M1c — Structural construct editing
**Scope:** fullstack · ~1d
- [ ] Edit a framework's constructs and behaviours as data — add/remove/reword a behaviour, retag its `dimension`, edit the `evaluation_hint`
- [ ] Regenerate the instruction from the edited constructs, so the trace holds
- [ ] Keep the shipped free-text override as the escape hatch, marked as such: `prompt_provenance` already distinguishes `generated` from `edited`
- [ ] The Firestore override store extends from "an instruction string" to "an optional construct list + an optional instruction"

**Acceptance:** a researcher adds a behaviour to ESRU, regenerates, and the new line appears in the live tutor prompt with the framework still marked `generated`.

### M2 — The tutor co-pilot
**Scope:** fullstack · ~2d
- [ ] Fourth mount on the **shipped** co-pilot shell (`components/teacher/copilot/`), same propose → Apply / Edit / Dismiss, same tool shape as `adk/authoring_tools.py`. Nothing new is invented
- [ ] `set_framework` · `set_construct_behaviours` · `draft_tutor_prompt` · `suggest_evaluation` · `critique_tutor`
- [ ] **`critique_tutor` is the one to build first** — *"your prompt claims to support autonomy but never offers a choice"* — it is the most valuable for a researcher and the only one that is useful before the others exist
- [ ] Ground proposals in the **researcher-authored frameworks already on disk**, so the co-pilot suggests from the corpus rather than from the model's memory
- [ ] ⚠️ **HARD REQUIREMENT: the co-pilot must never emit a citation a human did not supply.** Already enforced in the type system — `Provenance.vouched_by` has no default and no empty value — so this milestone must not add a path around it. A test asserts a proposal cannot carry provenance

**Acceptance:** a researcher describes a tutor in prose and gets a proposed framework, constructs and behaviours to Apply or Edit; `critique_tutor` names a claimed construct with no supporting behaviour; **no tool output ever contains a citation string**.

## Out of scope
- **M3 preview / side-by-side comparison** (~1d) and **M6 clash gatekeeper** (~0.5d). M6 is now smaller than written — a tutor owns both style and framework, so the commonest clash is gone by construction.
- **Frameworks 3–7.** Each is a read-the-PDF task (~0.5d), independent of this sprint. 5E or CER is the natural third.
- **Retiring `ActivityConfig.persona` / `interaction_style`.** They remain the pre-tutor fallback; removing them is a cleanup once no activity uses them.

## Success criteria
- [ ] A teacher creates a tutor variant without a researcher and without a deploy.
- [ ] A researcher sees every teacher-authored tutor with lineage, and teachers have been told.
- [ ] A researcher changes a framework's *behaviours* and the generated instruction follows.
- [ ] The co-pilot proposes structure and **never** a citation.
- [ ] An activity with no tutor still composes byte-identically — the passthrough guarantee survives all four milestones.
