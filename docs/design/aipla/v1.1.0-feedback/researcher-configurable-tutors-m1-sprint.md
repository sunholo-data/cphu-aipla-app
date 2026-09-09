# Sprint Plan: TUTOR-2 — ESRU reaches a live turn, and a researcher can edit it (1.1.91 M1)

## Summary

Two things, and they only mean anything together:

1. **ESRU becomes a real tutor instruction.** The framework's constructs and behaviours
   ([TUTOR-1](researcher-configurable-tutors-sprint.md)) render into a preamble that is
   injected into the tutor's system prompt at agent-instantiation time.
2. **A researcher can edit that instruction** from a surface in the app, without a commit, a
   deploy or a seed — the thing 1.1.91 exists to fix (*"a tutor is a file in git, and the
   people who own the pedagogy cannot write files in git"*).

**Duration:** ~1.5–2 days · **Scope:** Fullstack · **Design doc:** [researcher-configurable-tutors.md](researcher-configurable-tutors.md) §M1
**Follows:** TUTOR-1 (the object + the verified ESRU framework)

## The two decisions that shape this

**1. A framework with no framework is a passthrough — the PERSONA-1 precedent.** Injecting a
teaching-framework preamble into every tutor turn would change runtime behaviour for every
shipped tutor at once. 1.1.20 faced exactly this and took the low-risk route: the default
injects **nothing**, so existing tutors are byte-identical. Same here — an activity with no
`framework_id` composes exactly as it does today. The blast radius of this sprint is
"activities a researcher deliberately opted in", and nothing else.

**2. The instruction is RENDERED from the constructs, not typed.** `build_framework_instruction`
is `draft_tutor_prompt` (M2) **minus the LLM** — a deterministic function from
constructs → behaviours → preamble text. That is the reviewability property doing real work: the
instruction a tutor receives is *derived from* the theory, so a reader can check one against the
other. A researcher's edit then layers **on top of** that render, and the surface shows both, so
an edit is always visibly a delta from the theory rather than an untraceable prompt.

This is also why the override stores the **instruction**, not a free-text prompt: it lands in a
slot whose default is generated and displayed beside it.

## Milestones

### M1 — Framework → instruction
**Scope:** backend · ~0.3d
- [x] `backend/frameworks/instruction.py` — `build_framework_instruction(fw)` renders label + summary + per-construct behaviours into a preamble; deterministic, no model, empty string for a placeholder framework (nothing to say ⇒ say nothing)
- [x] Behaviour lines render verbatim from the YAML so the prompt and the theory cannot drift

**Acceptance:** ESRU renders a preamble naming all four moves and every behaviour; a placeholder framework renders `""`.

### M2 — Researcher override store
**Scope:** backend · ~0.3d
- [x] `backend/db/framework_overrides.py` — one doc per framework at `framework_overrides/{framework_id}`: the edited `instruction`, `updatedBy`, `updatedAt`, `version`
- [x] `resolve_framework_instruction(framework_id)` — override if present, else the M1 render, else `""`. The `authoring_framework.default_framework_prompt` pattern: Firestore layers onto exactly the git default
- [x] Missing doc ⇒ the rendered default ⇒ behaves as if the feature did not exist

**Acceptance:** saving an override changes what `resolve_framework_instruction` returns; deleting it restores the render byte-for-byte.

### M3 — It reaches a live turn
**Scope:** backend · ~0.4d
- [x] `framework_id: str | None` on `ActivityConfig` (alias `frameworkId`), default `None`
- [x] `backend/adk/tutor_framework.py` — `inject_framework_preamble(instructions, activity_id, group_tags=)`, sibling of `inject_interaction_style_preamble`; resolves activity → class, passthrough on unset/unknown/empty
- [x] Wired into `compose_instruction_providers` (`adk/agent.py`) **immediately outside** `inject_interaction_style_preamble`, so on the "later instruction wins" convention the **pedagogy outranks the voice preset**. Recorded in a comment — this is the M6 clash axis, decided rather than stumbled into
- [x] `tutor.framework_id` as an OTel span attribute (the 1.1.20 `tutor.interaction_style` precedent) so 1.1.92 can join scores to arms

**Acceptance:** an activity with `framework_id="esru"` composes an instruction containing the ESRU moves; with `framework_id=None` it composes **byte-identically** to today.

### M4 — Researcher API
**Scope:** backend · ~0.3d
- [x] `backend/protocols/frameworks_routes.py`, every route `assert_researcher`-gated
- [x] `GET /api/research/frameworks` — catalogue + resolved instruction + `isOverridden` + the rendered default alongside
- [x] `PUT /api/research/frameworks/{id}/instruction` · `DELETE …` (revert)
- [x] Registered in `fast_api_app.py`

**Acceptance:** a teacher without the researcher claim gets 403 on every route; a researcher can read, edit and revert.

### M5 — The researcher surface
**Scope:** frontend · ~0.4d
- [x] `/teacher/research/frameworks` — the catalogue, ESRU first, placeholders badged as awaiting content
- [x] An editor showing **the rendered default and the researcher's override side by side**, with Save and Revert; forbidden state for non-researchers, matching `/teacher/research/activities`
- [x] `fetchWithTeacherAuth` throughout (a researcher is a Firebase teacher identity, never a group token)

**Acceptance:** a researcher edits ESRU's instruction, reloads, and sees the edit; Revert restores the generated text.

### M6 — Tests
**Scope:** both · ~0.3d
- [x] Backend: render determinism; override round-trip + revert; **passthrough proves byte-identity** when unset; injection ordering vs interaction_style; 403 for a non-researcher on every route
- [x] Frontend: list renders, forbidden state, save calls the right endpoint with the teacher helper
- [x] `make lint` + `make test-fast`; `npm run quality:check`

## Out of scope
- **The tutor co-pilot** (M2 of the design doc) — `set_framework`, `critique_tutor` et al. This sprint gives the researcher a *text surface*; the co-pilot that proposes into it is next.
- **Per-tutor storage.** This edits the **framework's** instruction, which is the shared thing. Per-tutor variants + lineage are the `Tutor` store, still M1-proper.
- **Teacher-tier variants**, preview/compare (M3), researcher cross-view (M4), clash gatekeeper (M6).
- **Editing constructs/behaviours structurally** — the surface edits the rendered instruction. Structural editing is the co-pilot's job and would otherwise be a JSON textarea, which is not a surface for a researcher.

## What shipped that the plan did not name

- **`/teacher/research/frameworks` needed a nav entry, and the existing one had to be
  narrowed.** `RESEARCH_DESTINATION` matched the prefix `/teacher/research`, so adding a
  sibling page lit both entries at once. Frameworks is a sibling of the research scan rather
  than a tab inside it: *"what is the tutor told to do"* is a different question from *"what
  have teachers built"*.
- **The route is Firebase-only, not dispatcher-auth, and is now allowlisted in
  `scripts/check-auth-dispatcher.sh`.** The first cut imported the dual-audience dispatcher;
  the guard's own header says researcher-only surfaces are legitimately Firebase-only and must
  be listed with a reason. The dispatcher would have let a group token reach
  `assert_researcher` and be denied there — safe, but a layer late and against the convention.
  Caught because the API tests 401'd, which is the guard's stated failure mode working in
  reverse.
- **A placeholder framework shows no badge at all.** The first cut labelled every un-overridden
  framework "Generated from the theory", including the six with no constructs — which is the
  unfounded-claim failure this line of work exists to avoid, in the UI instead of the data.

## Success criteria
- [x] ESRU's four verified moves reach a live tutor's system prompt.
- [x] A researcher changes what the tutor is told, in the app, with no commit or deploy.
- [x] An activity with no framework composes byte-identically to before this sprint.
- [x] The generated default is always visible beside the override, so an edit reads as a delta from the theory.
- [x] Non-researchers 403 on every route.
