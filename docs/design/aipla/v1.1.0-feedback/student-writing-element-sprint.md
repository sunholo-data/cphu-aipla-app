# WRITING-1 — sprint plan for the student writing element (1.1.73)

**Design doc**: [student-writing-element.md](student-writing-element.md)
**Sprint id**: `WRITING-1`
**Created**: 2026-08-11
**Status**: **ALL FIVE MILESTONES SHIPPED 2026-08-11** — `af869d2` (M3) · `d9de19c` (M0) · `1a1d876` (M1) · `e069c98` (M2) · `cfe4f30` (M4). Backend 3009 tests, frontend 1636, `make audit-trust-cards` green.
**Target**: land on `dev` before the 2026-08-14 pilot start; M3 ships first and standalone
**Velocity basis**: last 7 days — 38 commits, 174 files, ~20k insertions across PILOT-1, compaction port, voice-cost and 1.1.64. Element work specifically (1.1.64 multi-chart, a 3-milestone fullstack element change) landed in one day. The 1.1.38 recipe is exercised; this is its seventh pass.

## Sprint goal

A student writes prose in the workspace, it survives the tab and the device, the tutor reads and comments on it without a copy-paste, and the student downloads it as a file. Plus: a student can download the diagram they just drew.

## Recon findings that change the design

Three, found while reading the code the milestones touch. All three are recorded here and amended into the design doc.

1. **The push snapshot must be calculator-shaped, not table-shaped.** The design doc specified a per-element `WritingSnapshot` carrying one `elementId`. Reading [`element_state.py::_read_table`](../../../../backend/adk/element_state.py): every table pushes to the *same* `mcp_app_context.table.state` key, so only one table's snapshot can be live at a time — the known defect 1.1.71 exists to fix, and the reader has to compensate with "any other authored table reports EMPTY". `_read_calculator` has no such problem because `CalcSnapshot` pushes **every** calculator in one array, matched by id. With `max_items=3` from day one, the writing element must copy the calculator, not the table: **one snapshot, `{docs: [{id, title, words, chars, text, truncated}]}`**. Same reason we're not shipping a singleton — do not re-introduce a bug that already has a doc open against it.

2. **`ElementFill` needs a nominal total for the untargeted case.** `is_demonstrably_empty` is `total > 0 and filled <= 0`, and `total <= 0` renders `UNKNOWN — nothing authored to fill in`. A writing element with no `minWords` target has no natural total, so it would report UNKNOWN and the M3-refusal ("you said you're done but it's empty") would never fire on exactly the element where "I've written it" is the most tempting untrue claim. Fix: `total = min_words or 1`, `filled = words`, plus a `writing` branch in `_line` so the prose reads honestly rather than "0 of 1 words".

3. **`slugify` lives in a teacher route module** (`app/teacher/classes/[id]/_exportHelpers.ts`). Lift it to `lib/download.ts` next to `triggerDownload` — importing a teacher-route module into a student workspace component would (rightly) trip the eslint surface fence.

## Milestones

Ordered by dependency, not by number. **M3 goes first**: it is independent, ~15 lines, and is the piece a student notices tomorrow.

| M | Title | Scope | Est. | Depends on |
|---|---|---|---|---|
| **M3** | Diagram download + stop wiping the whiteboard | FE | ~0.3d | — |
| **M0** | Element model, all three stores, per-group text store, routes | BE | ~0.75d | — |
| **M1** | `WorkbenchWriting` + autosave + the four tutor wirings | FS | ~0.75d | M0 |
| **M2** | Export — txt / md / rtf | FE | ~0.4d | M1 |
| **M4** | Builder editor + co-pilot + CLI + palette rename | FS | ~0.5d | M0 |

**Total ~2.7d.** No milestone is on anyone else's critical path; M4 can slip past the pilot without M0–M2 being useless (a teacher can still author via the co-pilot's absence being visible, and via CLI once M4 lands).

---

### M3 — Diagram download + stop wiping the whiteboard (FE, ~0.3d)

**Files:** `frontend/src/components/workspace/SolutionWhiteboard.tsx`, `frontend/src/lib/download.ts`, `__tests__/SolutionWhiteboard.test.tsx`

**Tasks**
- `lib/download.ts`: export `triggerDownload` (currently module-private) and add `slugify` (lifted from `_exportHelpers.ts`, which re-imports it).
- Toolbar: **"Hent tegning"** — composite-onto-white exactly as `add()` does, then `triggerDownload(blob, "tegning-<date>.png")`. Disabled when there is no ink.
- Delete `setItems([])` from `add()`. The board keeps the ink; "Ryd" is the deliberate clear. Update the stale comment.

**Acceptance**
- [ ] "Hent tegning" triggers a download with a `.png` name; disabled on an empty board.
- [ ] "Tilføj tegning" stages the image and the items are still on the board afterwards.
- [ ] `_exportHelpers.ts` still compiles against the lifted `slugify`.

---

### M0 — Element + stores + routes (BE, ~0.75d)

**Files:** `backend/db/models/activity_config.py`, `backend/db/models/activity.py`, `backend/protocols/activity_routes.py`, **new** `backend/db/writing_progress.py`, **new** `backend/protocols/writing_progress_routes.py`, the router registration, `backend/tests/unit/test_writing_progress.py`, `backend/tests/unit/test_activity_elements.py`

**Tasks**
- `WritingElement(id, title, prompt, placeholder, min_words, max_chars)` with bounds; `ElementKind` gains `"writing"`; `ELEMENT_REGISTRY["writing"] = ElementSpec(field="writing", max_items=3, render="workspace")`; `ActivityConfig.writing`; `__all__`.
- **Recipe 1b — all three stores and both adapters.** `Activity.writing`, `ActivityUpsert.writing` (`extra="forbid"` — miss it and the builder 422s), `_activity_from_body`, `_activity_to_config`. The 1.1.48 `document` regression was exactly a missed adapter and the model test does not catch it.
- `db/writing_progress.py` — `writing_progress/{group_id}:{activity_id}`, mirroring `db/checklist_progress.py` field-for-field: `get_docs(group_id, activity_id)`, `record_doc(group_id, activity_id, element_id, text)`; `revision` increments; `words` computed server-side so the store and the tutor never disagree about the count.
- `protocols/writing_progress_routes.py` — `GET` dual-audience (student's own group off the verified `group_id` claim; owning teacher gets all groups; else 404), `PUT` student-only, 422 above `max_chars`. Copy the reasoning comment from `checklist_progress_routes.py` rather than re-deriving it.

**Acceptance**
- [ ] POST an activity with a `writing` element → GET returns it (round-trip through **both** adapters).
- [ ] `test_every_element_field_is_present_on_all_activity_models` green.
- [ ] Store: upsert, revision increments, >20,000 chars rejected, group A cannot read group B.
- [ ] Dual-auth: student reads own group; owner teacher reads all; teacher `PUT` rejected; non-owner 404.

---

### M1 — Renderer + the four tutor wirings (FS, ~0.75d)

**Files:** **new** `frontend/src/components/workspace/WorkbenchWriting.tsx`, **new** `frontend/src/lib/writingApi.ts`, `frontend/src/lib/elementTypes.ts`, `frontend/src/lib/activityElements.ts`, `frontend/src/components/workspace/elementRenderers.tsx`, the chat page ctx, `backend/adk/element_manifest.py`, `backend/adk/element_state.py`, tests both sides

**Tasks**
- `WorkbenchWriting` — a `<textarea>`, word counter, save state (gemmer / gemt / ikke gemt), 2s-idle + on-blur autosave via `fetchWithAuth` (group token — the eslint fence enforces this), `sessionStorage` buffer so an offline edit is never lost.
- **Wiring 1 — push.** `useSimSnapshotPush(sessionId, "writing")`, event `writing.commit`, calculator-shaped array snapshot, text tail-truncated at `WRITING_PUSH_CHAR_CAP = 4000` with `truncated: true`. Catch-up `writing.sync` on `sessionId` arrival, silent.
- **Wiring 2 — trust card.** Debounced, `WRITING_CARD_DEBOUNCE_MS = 3000`, one per burst, label `Din tekst delt med vejlederen (N ord)`. No card on `.sync`.
- **Wiring 3 — manifest.** `_describe_writing` naming the surface and stating the rule: comment and question, never rewrite, feedback belongs in the conversation.
- **Wiring 4 — fill state.** `_read_writing` + `_NOUNS`/`_UNITS` + the `writing` branch in `_line` (recon finding 2).
- **"Bed vejlederen om feedback"** — `onProactiveTrigger` with the FULL text; no card (the turn is the confirmation).

**Acceptance**
- [ ] Typing → one debounced PUT, one `writing.commit` push, exactly **one** trust card per burst (fake timers).
- [ ] `sessionId` arrival → `writing.sync`, **no** card.
- [ ] Snapshot tail-truncates at the cap with `truncated: true`.
- [ ] Feedback button sends the full text as a turn and dispatches no card.
- [ ] `test_every_registered_element_kind_is_described` — a real describer, not the generic fallback.
- [ ] `test_every_element_kind_declares_a_fill_reader` — a reader; untouched → `EMPTY`, typed → word count.
- [ ] `make audit-trust-cards` green.

---

### M2 — Export (FE, ~0.4d)

**Files:** **new** `frontend/src/lib/exportDocument.ts`, `WorkbenchWriting.tsx`, tests

**Tasks**
- `exportWriting(doc, format)` for `txt` | `md` | `rtf` on top of `triggerDownload`.
- RTF 1.x serialiser: ASCII header, `\uNNN?` escapes for non-ASCII (Danish `æøå` is the case that matters), `\par` paragraphs, bold/italic from markdown's two inline marks, headings bold.
- Provenance header (activity title, group code, date) on every format.
- A format dropdown, not three buttons.

**Acceptance**
- [ ] All three formats download with the right extension and MIME.
- [ ] `æøåÆØÅ` survive the RTF escape (table-driven test).
- [ ] Hand-check: the `.rtf` opens with headings intact in Word, Pages, Google Docs, LibreOffice.

---

### M4 — Authoring surfaces (FS, ~0.5d)

**Files:** **new** `frontend/src/components/teacher/WritingEditor.tsx`, `ActivityBuilderBody.tsx`, `hooks/useActivityBuilder.ts`, `lib/activityPreview.ts`, `lib/teacherApi.ts`, `backend/adk/authoring_tools.py`, the authoring `SKILL.md`, `_AuthoringCopilot.tsx` + `app/teacher/activities/[id]/page.tsx`, `cli/`, tests

**Tasks**
- `WritingEditor` modelled on `NoteEditor` (title, prompt, placeholder, word target).
- `useActivityBuilder`: `writing` state + setter + `elementPayload` + `hydrate` + `workspaceCount` + **the hand-maintained dep array** (the hook's own comment records that a missed entry silently keeps a stale value — 1.1.61's tags were lost exactly that way).
- Co-pilot both sides: `_TEXT_ELEMENT_KINDS` gains `writing`, a `_build_element_spec` branch validating by constructing `WritingElement`, `add_element` params, the `SKILL.md` line; FE `Proposal` variant + `parseProposal` + `AddElementBody` + the Apply-router case → `setWriting`.
- CLI `aiplatform activity` parity with `note`.
- **Palette rename**: `note`'s *label* becomes "Instruktion / reference"; `writing`'s is "Skrivefelt". Labels only — the `kind`, the field, and every stored row are untouched.

**Acceptance**
- [ ] A teacher adds a writing element in the builder; save → reload → it's there.
- [ ] `add_element(kind="writing")` parses, previews, and Applies onto builder state.
- [ ] `aiplatform activity` can set and read it.
- [ ] The palette no longer offers two things a teacher could read as "notebook".

---

## Quality gates

Run **after each milestone**, and all of them before the final commit:

```bash
cd backend && make lint && make test-fast     # CI parity — `make lint` alone is not enough
cd frontend && npm run quality:check          # CI parity — tests + build, not the :fast variant
make audit-trust-cards                        # the dropped-card gate (CI local-mode-safety)
```

The pre-push gotcha in CLAUDE.md applies: `quality:check:fast` and `make lint` skip the tests, and the LOCAL-MODE-AND-FORK sprint shipped 9 commits before noticing CI was red because of it.

**Known-noise:** `test_tenant_context.py` has 3 pre-existing OTel tracer-teardown failures under the full run (memory `project-pre-existing-otel-test-isolation-failure`). Confirm by running that file alone; do not chase it.

## Commit plan

Conventional commits, direct to `dev` (no PR — AIPLA workflow), one per milestone:

1. `feat(workspace): let a student download the diagram they drew (1.1.73 M3)`
2. `feat(activities): a writing element, and somewhere for the text to live (1.1.73 M0)`
3. `feat(workspace): the tutor reads what the student is writing (1.1.73 M1)`
4. `feat(workspace): the student takes their text away as a file (1.1.73 M2)`
5. `feat(activities): author a writing element — builder, co-pilot, CLI (1.1.73 M4)`

## Risks in execution order

| Risk | Mitigation |
|---|---|
| The adapter mapping is missed and the element creates but never renders (the 1.1.48 shape) | The M0 round-trip test is written **before** the frontend exists |
| The trust card is dropped (most-repeated bug on this axis) | Card assertion is in the M1 acceptance list, and `make audit-trust-cards` is a gate not a suggestion |
| `useActivityBuilder`'s hand-maintained dep array | Test asserts the **value** after Apply, not that the setter was called — the failure mode 1.1.61 documents |
| Scope creep into a teacher collection surface | Explicitly Human gate 4; out of this sprint |

---

## What actually happened

Five commits, all five milestones, in the planned order (M3 first). Three things
worth recording because they were not in the plan:

1. **Both registry guards fired on the first backend test run** —
   `test_every_registered_element_kind_is_described` and
   `test_every_element_kind_declares_a_fill_reader`. That is the system working
   exactly as the `workbench-element-builder` skill says it should: an element
   kind cannot reach `dev` invisible to the tutor. It moved the manifest
   describer and the fill reader from M1 into M0, since both are backend and a
   red commit is worse than a milestone boundary.

2. **Three pinned payload key-set assertions failed on the new key** — the
   anti-data-loss guards in `useActivityBuilder.test.ts` and
   `activityPreview.test.ts`. Updated, not weakened; that is what they are for.

3. **A pre-existing CLI wipe surfaced and was fixed in passing.** `aiplatform
   activity add-chart` hand-built its full-overwrite payload and omitted
   `conceptMap` — so adding a chart from the CLI silently deleted the activity's
   concept map. Both commands now go through one `_full_payload` with every
   element field listed in a single place.

**Not done, deliberately:**

- **The `.rtf` hand-check in Word / Pages / Google Docs / LibreOffice.** The
  serialiser is unit-tested hard (signed UTF-16 escapes, surrogate pairs,
  balanced braces, Danish round-trip) but nobody has opened the file in Word.
  That is the one M2 acceptance item a test cannot close.
- **The four human gates for JB** remain open and are recorded in SEQUENCE.md:
  rtf-vs-docx, unprompted-vs-on-request commenting, per-group vs per-student,
  and whether teachers must collect the texts. The shipped defaults are the
  ones the design doc proposed.
- **Deployment.** Nothing has been pushed or deployed; the writing element will
  not appear on dev until `dev` is pushed and the seed job runs (the authoring
  `SKILL.md` changed, so the co-pilot needs a reseed to offer the element).
