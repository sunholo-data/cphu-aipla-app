# Sprint TUTOR-2 — a teacher can make their own tutor

**Sprint ID:** `TUTOR-2` · **Created:** 2026-09-28 · **Design doc:** [teacher-authored-tutors.md](teacher-authored-tutors.md) (1.1.135)
**Estimated:** ~4.5d over seven milestones (rescoped 2026-09-29)
**Source:** M, 2026-09-28 — *"a teacher should be able to make their own tutor, with their own teaching approach and/or adjust the researcher created ones. teachers and researchers should be able to save variants for themselves"*, then *"we use our own avatars for now and we will upload more so there is more choice"*, and *"lets have private and shared versions, but researchers always see all"*.

## What this sprint is, in one line

⚠️ **Rescoped 2026-09-29, one day in.** The plan opened by claiming two finished backends had no controls. Only **one** does — the tutor variant dialog. Custom approaches were already mounted, teacher tier and all, by 1.1.110; the claim came from grepping a function name that does not exist. See the correction block in the design doc.

So: one real unmounted control, one missing layer (custom personas), one missing field (visibility, now shipped in M0), and a **mechanical sweep** that found seven unmounted `teacherApi` exports my hand analysis had got wrong in both directions. That sweep is M6, and it is now the milestone with the best argument behind it rather than the cheap one at the end.

Measured before starting (prod + test Firestore, 2026-09-28): **0 tutor variants, 0 custom approaches, 0 framework overrides.** Four `tutors` rows, all skill-bound seeds. The zero-approaches number still stands but measures **adoption, not reachability** — a teacher could have authored one at any point this month.

## Order, and why it is this order

M0 first because everything after it writes rows, and a row written before the visibility rule exists is a row someone has to migrate. M6 is independent and cheap and could ship alone — it is the one that changes the *class* of bug rather than this instance, so it does not get descoped if time runs short.

### M0 — ownership and visibility (~1d, backend)

- `Tutor.visibility: "private" | "shared" | None`. **Absent ≠ private.** Absent reads as `shared` (what the row meant before the field existed); a newly created tutor is written `private` explicitly.
- Same pair on custom approaches (`authored_frameworks`), which changes 1.1.110's global listing — stated in the design doc, same absent rule so nothing existing disappears.
- `list_tutor_catalogue(for_uid, see_all)` and the approach listing filter; **a researcher's read is unfiltered and logged**, on the `_load_for_modify` precedent (observable, not silent).
- `PUT /api/research/tutors/{id}/visibility` — the share control's endpoint.
- The class-tutor setter refuses a tutor the caller cannot see (`_assert_setting_fits_class` is the seam).
- ⚠️ Visibility must be applied in **both** `list_tutor_catalogue` and `resolve_tutor`, the way framework assignments already are, or the picker offers what the resolver then refuses.

### M1 — the surface (~0.25d, frontend) — **mostly shipped by 1.1.110**

Left to do: let a teacher READ the seven published approaches (today they are invisible, and 1.1.135's argument requires a teacher to pick an approach somebody can read), and give their own approaches the share control M0's `visibility` field is waiting for.

### M2 — tutor authoring + the share control (~1d, fullstack)

`TutorVariantDialog` mounted (the home its own docstring asked for on 2026-09-11). "New tutor" for a teacher, gated on choosing an approach. Variant/create routes re-gated `assert_researcher` → `assert_teacher` + ownership. Share control beside each owned tutor, matching the activities library's gesture and its **"Shared"** label, with the one line saying what private means.

### M3 — custom personas (~1d, fullstack)

`Persona.source` widens `Literal["yaml"]` → `Literal["yaml", "firestore"]`; a `custom_personas` collection; owner + visibility as M0; CRUD. `resolve_persona_chain` is **untouched** — a custom persona is just another id it resolves, not a second resolution path.

### M4 — avatar picker (~0.25d, fullstack)

A generated manifest of `frontend/public/personas/*`, `make avatars`, and `make check-avatars` in CI — the `make sim-prompt` / `make check-sim-prompt` pattern. Picking only; no upload, no new content class, no policy. ⚠️ The CI check is the half that matters: a dropped-in file nobody regenerated is invisible, which looks like the feature not working.

### M5 — voice (~0.5d, frontend)

The curated catalogue (`GET /api/voice/voices`) in the persona editor. `voice_prompt` is shown **only** for the tiers that honour it — Chirp3-HD and WaveNet reject prompts, so offering the field there is a control that silently does nothing.

### M6 — the guard (~0.5d)

`scripts/check-client-api-mounted.sh`: fail when an exported `teacherApi.ts` function has no call site outside `teacherApi.ts`, with an allow-list carrying a reason per entry. CLAUDE.md lists the unmounted-control row as **manual**; this is instances three and four.

## Constraints picked up from the room

- ⚠️ **Shared checkout.** A parallel session is working 1.1.108 i18n in this same working tree. Stage by explicit path only — never `git add -A`/`-a`/`.` (this sprint's first act was undoing exactly that mistake).
- **New UI copy goes in a `copy` object or `messages/`, never inline JSX** (1.1.108 M4, now a CLAUDE.md footgun row). This sprint adds a lot of copy; it is the first sprint written under that rule.

## Acceptance

- [ ] M0: an unmarked tutor stays pickable; a private tutor is invisible to another teacher and visible to a researcher; the researcher read is logged; a class cannot be given a tutor its teacher cannot see.
- [ ] M1: a teacher who is not a researcher creates, edits and deletes their own custom approach — the right 1.1.110 granted and never delivered.
- [ ] M2: a teacher creates a variant, it appears in their class picker and nobody else's, and one control shares it.
- [ ] M3: a custom persona resolves through the SHIPPED chain.
- [ ] M4: adding an avatar is drop-the-file + `make avatars`, and CI fails if someone forgets the second half.
- [ ] M5: `voice_prompt` is not offered for a voice tier that ignores it.
- [ ] M6: the guard fails on a deliberately unmounted export and passes on the allow-listed ones.
- [ ] **End to end:** a teacher with no researcher claim authors an approach, builds a tutor on it, gives it a face and a voice, assigns it to their class, and a student is taught by it.
