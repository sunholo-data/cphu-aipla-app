# Teacher-authored tutors — a face, a voice, an approach, and somewhere to keep them

**Status:** **Design (OPEN)** — **1.1.135**
**Priority:** **P1** — three of the four capabilities below are already BUILT and unreachable, so most of this is mounting work, not new machinery. The exception (M3–M5) is genuinely new.
**Estimated:** ~4.5d phased, rescoped 2026-09-29 (M0 ownership+visibility ~1d · M1 the surface ~0.25d · M2 tutor authoring ~1d · M3 custom personas ~1d · M4 avatar picker ~0.25d · M5 voice ~0.5d · M6 the guard ~0.5d)
**Scope:** Fullstack — `Tutor` and `Persona` gain ownership and visibility; a Firestore persona layer beside the YAML one; an avatar upload; one role-graded Approaches & Tutors surface; and the CI guard for the bug class that caused this.
**Dependencies:** [1.1.91 researcher-configurable-tutors](researcher-configurable-tutors.md) (**shipped** — the `Tutor` object, the store, `create_variant`, the variant dialog); [1.1.110 custom-approaches-and-literature-corpus](custom-approaches-and-literature-corpus.md) (**shipped backend, no UI** — `authored_frameworks`, and the teacher/researcher matrix this doc extends rather than re-opens); [1.1.12 voice-personas](voice-personas.md) (**shipped** — `Persona`, six YAML personas, the resolution chain); [1.1.11 voice-personas](voice-personas.md) (**shipped** — the curated voice catalogue at `voice/voices.py` and `GET /api/voice/voices`); [1.1.44 activity-image-materials](activity-image-materials.md) (**shipped** — the upload → GCS → serve pattern M4 copies); [1.1.107 framework-fit-profile](framework-fit-profile.md) (the research attribution an authored tutor lands in — see Open question 3)
**Created:** 2026-09-28
**Source:** M, 2026-09-28 — *"can teachers make their own tutor and teaching approach? I don't see the ability to choose a custom tutor currently in class setup"*, then: *"a teacher should be able to make their own tutor, with their own teaching approach and/or adjust the researcher created ones. teachers and researchers should be able to save variants for themselves, and maybe give them an avatar upload, choice of vocal/voice etc as well."*

## Problem Statement

The question was whether teachers *can*. Read against the code the answer is **yes by design, no in practice** — and the practical half is not a missing feature, it is missing controls on finished features.

### What exists and is reachable

`TutorPicker` is mounted on the class detail page, so **choosing** a tutor for a class works. It is not on the class-*creation* flow, which is where the question came from.

Editing the seven published frameworks is researcher-only and is mounted at `/teacher/research/frameworks`.

### What exists and is reachable by nobody

> ⚠️ **CORRECTION, 2026-09-29.** The table below originally claimed custom
> approaches had **no UI at all**. That was wrong, and the error was mine: I
> grepped for `createCustomFramework` — a name I invented — and for the URL
> string `frameworks/custom`, which appears only in the client. I never grepped
> the actual export `createCustomApproach`, then reported the absence as a fact
> rather than as "I could not find a call site".
>
> **What is actually true:** `CustomApproachPanel` exists, is mounted on the
> frameworks page in two places, has tests, and calls `createCustomApproach` at
> line 101. More than that, **1.1.110 already built the teacher tier**: when the
> researcher-only framework list 403s, the page renders a teacher view with two
> tabs — "Try them" (`TutorPreviewPanel`) and "Yours" (the full approach CRUD).
> A teacher can author a custom approach in the product today.
>
> So this was one gap, not two, and **M1 is largely already done**. The
> 0-approaches-on-prod number still stands, but it measures **adoption, not
> reachability** — a different problem with different answers.

| Capability | Backend | Client | Rendered anywhere? | On prod |
|---|---|---|---|---|
| Create a tutor **variant** | `POST /api/research/tutors/variant` | `createTutorVariant` | **No** — nothing renders `<TutorVariantDialog` | **0 variants** |
| Create a **custom approach** | `POST/PUT/DELETE /api/research/frameworks/custom` | 4 typed functions | **Yes** — `CustomApproachPanel`, teacher tier included | **0 approaches** |

`TutorVariantDialog` is written and has five green tests. It was removed from `TutorPicker` on 2026-09-11 with its own docstring saying *"the mechanism needs a home on the Approaches surface, not on a class"* — and never got one.

A **mechanical** sweep of `teacherApi.ts` — every export with no consumer outside the client and its own tests — finds seven: `listMyActivities`, `fetchVoiceList`, `isTeacherOnlySkill`, `revokeGroupCode`, `clearTutorFramework`, `chatLogExportPath`, `searchFrameworkSources`. `fetchVoiceList` matters to M5: the voice catalogue has a typed client and no picker. `revokeGroupCode` deserves attention on its own account.

That sweep is the point of this section. My hand analysis got one export wrong **in each direction** — invented an absence that was not there, and missed six that were. CLAUDE.md's *"a whole stack ships with the control unmounted"* row is marked **manual**, and this doc is the argument that manual does not work. **M6 is the most valuable milestone here**, not the cheap one at the end.

### What does not exist at all

**A tutor's face and voice are not data a teacher can set.** `Persona.source` is `Literal["yaml"]` and its own docstring records that *"Firestore-custom personas are a v1.2 follow-up"*. The six personas are YAML files with avatars at `frontend/public/personas/*.webp` — a path a teacher cannot write to. So "give them an avatar upload, choice of voice" is the one genuinely new piece of this doc, and it needs a persona layer that lives in Firestore.

**And nothing is private.** `list_tutor_catalogue()` returns every row in the `tutors` collection to every teacher. *"Save variants for themselves"* has no mechanism at all: a tutor has an `author_uid` but no visibility, so the first teacher variant would appear in every other teacher's picker.

## Design

Four changes, in the order the data forces.

### 1. Ownership and visibility, on the gesture teachers already know (M0)

**Decided with M, 2026-09-28: private and shared, with a share button, the way activities already work.**

The precedent is complete and mounted: `POST /api/activities/{id}/visibility`, a control on the activities library page, and a vocabulary a teacher already reads — `published` is **labelled "Shared"** in `activityDisplay.tsx`. A tutor gets the same gesture and the same word.

`Tutor` gains `visibility: "private" | "shared"`, default `private` on create, with a share control on the Approaches & Tutors surface. `author_uid` already exists and becomes the owner.

⚠️ **Two states, not three, and the reason matters.** An activity's `visibility` folds lifecycle and sharing into one field (`draft | private | published`). A tutor already has lifecycle: `status: draft | ready | in-use`, which 1.1.91 uses to decide when an edit must fork a version. Giving `visibility` its own `draft` would put "not finished" in two fields that can disagree. So the vocabulary is shared with activities where it means the same thing and not where it does not.

- `list_tutor_catalogue(for_uid, *, see_all=False)` returns base tutors + every `shared` tutor + the caller's own `private` ones.
- ⚠️ **The migration is the risk.** Four skill-bound rows exist on prod and test. They must read as `shared` — a default of `private` for EXISTING rows empties every class's tutor picker at once. So absent `visibility` reads as `shared` (the behaviour before the field existed) while a newly created tutor is written `private` explicitly. Absent and private are deliberately not the same thing; same tri-state discipline as `defaultConceptMap` in CONCEPT-2 M3.
- A class may only be given a tutor its teacher can see. `_assert_setting_fits_class` is the existing seam.

**Custom approaches get the same pair**, which is a change to what 1.1.110 shipped: today `list_authored_frameworks()` returns every approach to every caller. One teacher's half-drafted approach in everyone's list is the same noise a half-drafted tutor would be, and having two sharing models on one screen is worse than changing one. Same absent-means-shared migration, so nothing that exists today disappears.

### 1b. Researchers see everything, and it is observable (M0)

**M, 2026-09-28: "researchers always see all."** A researcher's catalogue read is unfiltered — every tutor, every persona, every approach, private or not — because the research question *"SDT as designed versus SDT as thirty teachers actually adapted it"* is unanswerable over a filtered view, and that lineage is 1.1.91's stated reason for recording variants at all.

Two conditions on that, both from precedent already in this repo rather than invented here:

- **The bypass is spanned, not silent.** `_load_for_modify` already does this for a researcher reaching another teacher's activity — *"span it like the class read-bypass so the elevated access is observable"*. The same applies: an unfiltered read is logged as one.
- **Seeing is not editing.** A researcher may already edit anyone's custom approach (1.1.110's matrix) and that stays. But a private tutor a teacher is still working on renders as theirs — `canEdit` is server-computed per row and already carries this distinction, so it needs no second rule.

⚠️ This is worth saying to teachers in the product rather than only here: a "private" tutor is private from other *teachers*, not from the research team. Anything else would be a promise the research design cannot keep. One line of copy next to the share control, not a dialog.

### 2. One Approaches & Tutors surface, graded by role (M1)

Not two screens. `/teacher/research/frameworks` becomes the Approaches & Tutors surface for both roles, rendering different depth:

| | Researcher | Teacher |
|---|:--:|:--:|
| Read the seven published frameworks, and what each tutor is actually told | ✅ | ✅ |
| Edit a published framework's constructs | ✅ | ❌ |
| Create / edit / delete **their own** custom approach | ✅ | ✅ |
| Edit / delete **anyone's** custom approach | ✅ | ❌ |
| Create a tutor variant | ✅ | ✅ |
| Author a tutor from scratch | ✅ | ✅ (see 3) |
| Share their own tutor / approach | ✅ | ✅ |
| **See everything, private included** | ✅ | ❌ |

This is 1.1.110's matrix, extended to tutors along the same line it already drew. The access rule stays **server-computed per row** (`canEdit`); a second copy in the client disagrees with the first the moment one changes.

The reviewability rule from `TutorPicker` holds on this screen too: a teacher can always see what a tutor is actually told, one disclosure away.

### 3. A teacher may author a tutor, and the claim comes from the approach (M2)

1.1.91 M1 restricted teachers to variants, reasoning that *"a tutor with a theory field and no theory in it makes an unfounded claim look founded"*. 1.1.110 then carved the honest exception: a custom approach **makes no such claim** — it is labelled as authored, renders under its own heading, and carries no provenance.

This doc takes that one step and no further: **a teacher may author a tutor from scratch, provided its approach is a published framework or a custom approach.** A tutor with an empty theory field remains impossible. The claim lives on the approach, where it can be checked; the tutor only points at it. That honours both prior decisions rather than overturning either.

`TutorVariantDialog` gets its home here — the thing its docstring asked for.

### 4. A face and a voice as data (M3–M5)

`Persona.source` widens from `Literal["yaml"]` to `Literal["yaml", "firestore"]` and a `personas/{id}` collection joins the loader, layered exactly as `authored_frameworks` layers over the framework YAML and `tutors` over the base catalogue. One more instance of a pattern this codebase already has three of, rather than a fourth mechanism.

A custom persona carries the fields `Persona` already defines — `name`, `title`, `avatar`, `language`, `interaction_style`, `voice`, `voice_prompt`, `bio` — plus the same `author_uid` / `visibility` pair as a tutor. `resolve_persona_chain` is untouched: a Firestore persona is just another id it can resolve.

**Voice (M5) is mostly wiring.** `voice/voices.py` is a curated catalogue grouped by language and `GET /api/voice/voices` already serves a teacher's picker. What is missing is somewhere for the choice to live, which M3 provides. `voice_prompt` (the natural-language delivery steer) applies only to Gemini-TTS tiers and is ignored by Chirp3-HD/WaveNet — the picker must say so rather than offering a field that silently does nothing on the selected voice.

**Avatars are CHOSEN, not uploaded (M4).** M, 2026-09-28: *"we use our own avatars for now and we will upload more so there is more choice."* That is option (a) from the open question, and it removes the hardest thing in this doc — a user-uploaded image that a 16-year-old sees, attached to a class for a term, would have been the first of its kind in AIPLA and needed a policy nobody had written. Picking from a set the project controls needs none.

The cost is that "upload more so there is more choice" must not mean a code change each time. So the picker reads a **generated manifest** of `frontend/public/personas/*`, on the same generate-and-gate pattern the repo already uses for the sim authoring prompt (`make sim-prompt` / `make check-sim-prompt`) and the tutor docs (`make tutor-docs` / `make check-tutor-docs`): drop files in, run `make avatars`, and the new faces are offered. CI fails if the manifest and the directory disagree, so an added file that nobody regenerated is caught rather than silently absent.

M4 drops from ~0.75d to ~0.25d and is no longer gated on anything.

## Milestones

### M0 — ownership and visibility (~1d, backend)
`visibility` on `Tutor` and on custom approaches; absent reads as `shared`, a new row is written `private`; `list_tutor_catalogue(for_uid, see_all)`; a researcher's read is unfiltered and spanned; the class-tutor setter refuses a tutor the caller cannot see. Tests include the migration case (the four existing rows and every existing approach stay visible) and the researcher case (a teacher's private tutor is visible to a researcher and not to another teacher).

### M1 — the surface (~0.25d, frontend) — **mostly shipped by 1.1.110**
The teacher tier already exists (a 403 renders "Try them" + "Yours"). What is left is small: a teacher currently cannot SEE the seven published approaches at all, and this doc's own argument is that a teacher building a tutor must pick an approach somebody can read — so they need a read of the catalogue (summaries and constructs, not the override editor). Plus the share control for their own approaches, which M0's `visibility` field is waiting for.

### M2 — tutor authoring (~1d, fullstack)
`TutorVariantDialog` mounted for both roles; "New tutor" for a teacher, gated on choosing an approach; `POST /api/research/tutors/variant` re-gated from `assert_researcher` to `assert_teacher` + ownership; the **share control** beside each tutor a teacher owns, matching the activities library's gesture and its "Shared" label, with the one line saying what private means.

### M3 — custom personas (~1d, fullstack)
`Persona.source` widened; the Firestore layer and loader; owner-scoped CRUD; the tutor editor picks a custom persona as it picks a YAML one.

### M4 — avatar picker (~0.25d, fullstack)
A generated manifest of the shipped avatar images, a `make avatars` target and its CI check, and a picker in the persona editor. No upload, no new content class, no policy.

### M5 — voice (~0.5d, frontend)
The curated catalogue in the persona editor, with `voice_prompt` shown only for the tiers that honour it.

### M6 — the guard that would have caught this (~0.5d)
`scripts/check-client-api-mounted.sh`: fail when an exported `teacherApi.ts` function has no call site outside `teacherApi.ts`. An allowlist with a stated reason per entry covers the legitimate cases. This is the milestone that changes the class of bug rather than this instance of it, and it is cheap; it should ship even if the rest is descoped.

## Open questions

1. ~~**Student-visible uploaded avatars**~~ **Settled by M, 2026-09-28: option (a), no upload.** The project ships the avatar set and adds to it; a teacher picks from it. No user-generated student-facing imagery, so no moderation question, no accountability record, no review step. If upload is ever wanted, the policy question comes back with it — it was never an engineering blocker.
2. **Does a teacher-authored tutor enter the research record?** 1.1.92 attributes a scored session to `(tutor_id, version)` and 1.1.107's framework tabs read those. Thirty teacher variants would land in the same tabs as the designed arms. 1.1.91 already solved the shape of this for previews (`preview:{uid}`, logged without content) — the likely answer is the same marker, but it is **AR/JB's call**, not an engineering one.
3. ~~**Can a teacher share a tutor beyond themselves?**~~ **Settled by M, 2026-09-28**: private and shared, with a share button, the way activities already do it — one tier, not a school/global split. Shared means visible to every teacher on the deployment, which is what `published` already means for an activity. Researchers see everything regardless.
4. **Does the URL move?** `/teacher/research/frameworks` says "research" to a teacher who is not one. Renaming costs a redirect and nothing else, but it is a naming call.

## Risks

- ⚠️ **The visibility migration.** Default `private` would empty every class's tutor picker simultaneously, which reads as "the tutors are gone". Absent-means-`shared` is the whole mitigation and it is tested at M0.
- **The avatar set has to be easy to grow, or it will not grow.** "We will upload more" fails quietly if adding a face needs a developer. The manifest + `make avatars` + CI check is the whole mitigation, and the check is the half that matters: a dropped-in file nobody regenerated is invisible, which looks like the feature not working.
- **Two lists.** `list_tutor_catalogue` and `resolve_tutor` already apply framework assignments in both places precisely so they cannot disagree. Visibility must be applied in the same pair or the picker and the resolver will diverge — a teacher would pick a tutor the resolver then refuses.
- ⚠️ **"Private" is a promise to a teacher that the research design does not keep.** Researchers see all, by decision. Unless the product says so next to the control, a teacher will reasonably read "private" as "nobody sees this", and discovering otherwise is the kind of thing that costs consent rather than a bug report.
- **Changing 1.1.110's listing behaviour** is a shipped-behaviour change, not a new field: every existing custom approach must stay visible, which the absent-means-shared rule gives, but it is the second place in this doc where a default decides whether something vanishes.
- **This doc is mostly mounting work, which is the kind that looks done when it is not.** The acceptance criteria below are deliberately written as "a teacher can do X end to end", not "the endpoint exists" — the endpoints already exist and that is the problem.

## Testing

- **M0:** an unmarked tutor is pickable; a private tutor is invisible to another teacher; a class cannot be given a tutor its teacher cannot see; the four prod rows survive.
- **M1:** a teacher (not researcher) can READ the seven published approaches and share one of their own. Create/edit/delete of their own already works — 1.1.110 shipped it, and the first draft of this doc wrongly said otherwise.
- **M2:** a teacher creates a variant and it appears in their class picker and nobody else's; a tutor cannot be created without an approach.
- **M3–M5:** a custom persona resolves through the SHIPPED chain (no second resolution path); `voice_prompt` is not offered for a voice tier that ignores it.
- **M6:** the guard fails on a deliberately unmounted export, and passes on the allowlisted ones.
- **End-to-end, the one that matters:** a teacher with no researcher claim creates an approach, builds a tutor on it, gives it a face and a voice, assigns it to their class, and a student in that class is taught by it.

## Acceptance

- [ ] A teacher who is not a researcher can author a teaching approach, and it is theirs to edit.
- [ ] A teacher can build a tutor on that approach, or on a published framework, or as a variant of an existing tutor.
- [ ] A teacher and a researcher can each keep a tutor to themselves, and share it with one control that says "Shared" like the activities library does.
- [ ] A researcher sees every tutor, persona and approach regardless of visibility, the access is observable, and the product tells teachers so.
- [ ] A tutor can be given a face and a voice without anyone touching the repository, choosing from the avatar set the project ships.
- [ ] Adding a new avatar image is `drop the file in, run make avatars` — and CI fails if someone forgets the second half.
- [ ] Every one of those is reachable from the product, by a person, without an API client.
- [ ] No exported `teacherApi` function is left with no call site and no stated reason.
