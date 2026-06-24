# Sprint Plan: ALS-1 — Activity entity + library (M0 + M1)

## Summary
Kill the pilot-blocking activity-collision bug by decoupling an activity from
both its class and its running skill (M0), then add the many-class assignment +
teacher library + re-pointed class picker (M1). After this sprint a `(teacher,
class)` can hold **many** concept activities and creating a second one never
overwrites the first.

**Duration:** ~5 working days (M0 ≈ 3d, M1 ≈ 2d)
**Scope:** Fullstack
**Dependencies:** None blocking. Builds on the shipped `ActivityConfig` model, the
`Class` entity (1.A), the `_mint_activity_id()` helper (already present), and the
`resolve_active_config` / `inject_teacher_focus` path.
**Risk Level:** Medium (live-pilot data migration; student-resolution re-key)
**Design Doc:** [activity-library-sharing.md](activity-library-sharing.md) (1.1.43) — M0 + M1
**Scope decision (M, 2026-06-24):** Full doc M0+M1 now (not the in-place-only cut).
M2 (duplicate), M3/M3b (publish/shared catalogue/researcher-CRUD), M4 (attribution)
are **out of this sprint** — follow-on.

## The bug this fixes (code-proven, not just observed)

`POST` from [new/page.tsx:108](../../../frontend/src/app/teacher/activities/new/page.tsx)
unconditionally sends `activityId: conceptSkillId` — the **shared** concept-dialogue
skill UUID. The backend upsert key is the composite
`{teacher}:{class}:{activity_id}` written with a full Firestore `set()`
([activity_configs.py:99](../../../backend/db/activity_configs.py)), so two concept
activities in one class **are the same document** and the second silently overwrites
the first. `onAnother()`
([new/page.tsx:162-167](../../../frontend/src/app/teacher/activities/new/page.tsx))
only clears title/goal — the id never changes. Reproduced on `curly-goose-50`.

**Why it isn't a 2-line frontend change.** The student path is **skill-keyed end to
end**: [/lessons](../../../frontend/src/app/lessons/page.tsx) lists *skills* filtered
by the class's `lessons` (skill ids), each card opens a skill-keyed chat URL, and the
chat resolves `{teacher_focus}` via `resolve_active_config(activity_id = skill_id, …)`
([teacher_focus.py:46](../../../backend/adk/teacher_focus.py)). A student therefore
picks a *skill*, which forces one config per `(teacher, class, skill)`. The fix is to
**re-key the student lesson→chat→agent path from skill-id to activity-id** — exactly
the doc's M0 "student resolution by activity id, running skill resolved from content".

## Current Status Analysis

### Recent Velocity
- Last 14 days: 465 files changed, +42 456 / −3 191 (includes a large RICH-DOC sprint
  + the 1.1.43 doc itself). Sustained multi-milestone-per-day fullstack throughput.
- Recent completion rate: RICH-DOC M0→M4 + several fix sprints landed in the window.
- Estimated capacity for this sprint: comfortably ~5d of focused fullstack work.

### Existing Implementation (what we build on, not rebuild)
- `ActivityConfig` model + `activity_configs` repo (CRUD, composite key) — the content
  shape is reused verbatim for `Activity`.
- `_mint_activity_id()` already mints `teacher:{hex6}` when `activityId` is omitted
  ([activity_config_routes.py:59](../../../backend/protocols/activity_config_routes.py)).
- `Class` entity with `lessons: list[str]` + the `class:<owner>:<id>` tag invariant.
- `resolve_active_config` already keyed by `activity_id` — only the *value* flowing in
  is wrong today.
- `useActivityBuilder.elementPayload()` shared by create + edit (no id state — the gap).

## Proposed Milestones

> **Calendar flag.** Mid-point review is **Fri 2026-06-26**; holiday freeze is **week
> 27 (2026-06-29 → 07-05)**. **M0 is the pilot-blocker and must land before the
> freeze.** Front-load M0; M1 may finish either side of the freeze. The dual-read
> window (M0.2) means M0 can ship without deleting any legacy data — safe to land fast.

### Milestone M0 — Activity entity + safe migration + activity-keyed resolution
**Scope:** fullstack · **Goal:** decouple activity from class+skill; N activities per
class; second-create never overwrites. **This milestone alone fixes the bug.**
**Estimated:** ~600 impl + ~300 tests · **Duration:** ~3d

**M0.1 — Data model + repo (backend)**
- [ ] `Activity` Pydantic model (`activities/{act-…}`) — content fields mirror
  `ActivityConfig` minus `class_id`; add `owner_uid`, `visibility: draft|private`
  (published deferred to M3), `source_activity_id`/`source_owner_uid` (nullable, for
  M2), timestamps (~120)
- [ ] `db/activities.py` repo: create (mint `act-…`), get, list-by-owner, patch,
  soft-delete (~120)
- [ ] `Class.activity_ids: list[str]` field + alias (~15)
- [ ] Unit tests: model validation, mint uniqueness, repo round-trip (~120)

**M0.2 — Backfill + dual-read (backend) — the migration-risk task**
- [ ] One-shot backfill script: each `activity_configs/{t}:{c}:{a}` → one `Activity`
  (owner=t, content copied, `visibility=private`, minted `act-…`) + append id to that
  class's `activity_ids`; wrap **bare lessons** (a `cls.lessons` skill id with no
  config) as a minimal `Activity` (title = skill displayName, artefactId if sim) (~120)
- [ ] Dual-read in resolution: resolve by activity id; **fall back** to the legacy
  composite-key `ActivityConfig` for any session still carrying a skill-id (~60)
- [ ] Record every Firestore side effect in a migration-notes file (Terraform-recipe
  discipline) + dry-run mode on the script (~40)
- [ ] Tests: backfill idempotency, bare-lesson wrap, dual-read fallback (~100)

**M0.3 — Student resolution by activity id (backend) — the central spike**
- [ ] `GET /api/classes/{id}/activities` (student-resolvable from group tag) → the
  class's activities by `{activityId, title, …}` (~70)
- [ ] Resolve the **running skill from content**: artefact set → that sim's skill;
  else base `concept-dialogue`. Chat/agent instantiation keys off `activity_id` and
  injects *that* activity's focus (~120)
- [ ] Tests: two concept activities in one class resolve to distinct focus; sim
  activity resolves to sim skill (~110)

**M0.4 — Student `/lessons` + chat wiring (frontend)**
- [ ] `/lessons` enumerates **activities** (title + activity_id) not skills; card href
  carries `activity_id` (~110)
- [ ] Chat resolves config + persona by `activity_id` (the value flowing into
  `resolve_active_config` is now the minted id) (~50)
- [ ] Vitest: activity list renders N concept activities; href carries id (~70)

**M0.5 — Teacher create mints distinct ids (frontend)**
- [ ] `new/page.tsx` writes to `POST /api/activities` (mint `act-…`); stop sending
  `conceptSkillId`; bind the **activity id** to `class.activity_ids` (~50)
- [ ] `onAnother()` does a **clean reset** (fresh builder state / new id) so "Create
  another" can't reuse the prior id (~20)
- [ ] **Day-0 safety guard** (ship first): backend rejects a second `POST` that would
  overwrite an existing `(teacher,class,conceptSkillId)` config unless `activity_id`
  is explicitly the same — stops silent data loss the moment it merges, independent of
  the rest of M0 (~30)
- [ ] Vitest: two creates produce two distinct activity ids (~50)

**Files (M0):** `backend/db/models/activity.py` (new), `backend/db/activities.py` (new),
`backend/db/models/class_.py` (+field), `backend/protocols/activity_routes.py` (new) or
extend `activity_config_routes.py`, `backend/adk/teacher_focus.py` (resolution +
running-skill-from-content), `backend/scripts/backfill_activities.py` (new),
`frontend/src/app/lessons/page.tsx`, `frontend/src/app/teacher/activities/new/page.tsx`,
`frontend/src/lib/teacherApi.ts`, `frontend/src/hooks/useActivityBuilder.ts`.

**Acceptance Criteria (M0):**
- [ ] In one class, create activity A then activity B → **both persist**; A is not
  overwritten (regression test + browser-verified on a scratch class).
- [ ] A student in that class sees **both** A and B in `/lessons`, each opening its own
  tutor focus.
- [ ] Backfill run on a copy of `curly-goose-50` data: every existing config + every
  bare lesson maps to an `Activity`; no lesson lost; dual-read keeps a mid-session
  legacy skill-id resolving.
- [ ] All backend + frontend tests passing; `make lint` + `make test-fast` + `npm run
  quality:check` clean.

**Risks (M0):**
- Live-pilot migration — Mitigation: dual-read window; backfill is additive (never
  deletes `activity_configs`); dry-run first; run against a data copy before prod.
- Re-key cascade (chat/agent instantiation by activity_id) — Mitigation: M0.3 is the
  spike; land + test it before the frontend M0.4 wiring depends on it.

### Milestone M1 — Many-class assignment + library + re-pointed picker
**Scope:** fullstack · **Goal:** assign one activity to several of the owner's classes;
a "Your activities" library; class picker lists *your activities*, not raw skills.
**Estimated:** ~400 impl + ~200 tests · **Duration:** ~2d

**M1.1 — Assignment + library API (backend)**
- [ ] `PATCH /api/classes/{id}/activities {add:[…], remove:[…]}` — owner-only, validates
  the activities are the caller's (~70)
- [ ] `GET /api/activities?owner=me` → the teacher's library (~30)
- [ ] Tests: assign/unassign, owner-only guard, cross-owner reject (~90)

**M1.2 — "Your activities" library view (frontend)**
- [ ] Activities index becomes a library: cards with visibility badge (draft/private),
  assigned-classes chips, **Assign to classes ▾** multiselect, Edit, Delete (~200)
- [ ] Teacher-auth surface throughout (`fetchWithTeacherAuth` — the recurring 401
  corner) (~10)
- [ ] Vitest: library renders, assign-multiselect calls the PATCH (~90)

**M1.3 — Re-point the class-detail picker (frontend)**
- [ ] "Add from catalogue" → **"Add activity"**: picker lists the owner's library
  activities not already assigned (via `GET /api/activities?owner=me` filtered against
  `cls.activity_ids`), assigns via `PATCH /classes/{id}/activities` — **not**
  `patchLessons` (~120)
- [ ] Retire `LessonPicker` / `patchLessons` / `listAccessibleSkills` **for this
  surface**; update the empty-state copy (~30)
- [ ] Vitest: picker lists activities; add calls the activities PATCH (~60)

**Files (M1):** `backend/protocols/class_routes.py` (or wherever `patchLessons` lives) +
`activity_routes.py`, `frontend/src/app/teacher/activities/page.tsx`,
`frontend/src/app/teacher/classes/[id]/page.tsx`, `frontend/src/lib/teacherApi.ts`.

**Acceptance Criteria (M1):**
- [ ] An activity can be assigned to two of the owner's classes; both classes' students
  see it; editing it updates both.
- [ ] The class-detail picker lists the teacher's **activities** (not raw skills) and
  assigns via the activities PATCH; `patchLessons` is no longer called from this page.
- [ ] All tests passing; quality gates clean.

**Risks (M1):** Picker migration leaves a dead `lessons` path mid-cutover — Mitigation:
dual-read (M0.2) keeps `lessons` resolving until the picker fully replaces it; retire
`lessons` writes only, keep reads through the freeze.

## Day-by-Day Breakdown

### Day 1 — M0.1 + M0.5 Day-0 guard
- **Focus:** `Activity` model + repo + `Class.activity_ids`; ship the Day-0 overwrite
  guard immediately so live data stops being at risk.
- **Checkpoint:** model + repo tests green; a second overwrite-POST is rejected.

### Day 2 — M0.2 backfill + dual-read
- **Focus:** backfill script (dry-run first) + dual-read fallback + migration notes.
- **Checkpoint:** backfill on a `curly-goose-50` data copy maps every config + bare
  lesson; dual-read test green.

### Day 3 — M0.3 + M0.4 (the re-key)
- **Focus:** running-skill-from-content resolution + `/api/classes/{id}/activities`;
  `/lessons` enumerates activities; create mints distinct ids.
- **Checkpoint:** **bug dead** — A + B both persist and both render for a student.
  Browser-verify on a scratch class. **M0 shippable before the 06-29 freeze.**

### Day 4 — M1.1 + M1.2
- **Focus:** assignment + library API; "Your activities" view with assign-to-classes.
- **Checkpoint:** assign one activity to two classes works end to end.

### Day 5 — M1.3 + hardening
- **Focus:** re-point the class-detail picker; retire `lessons` writes there; full
  quality gates + browser pass.
- **Checkpoint:** picker lists activities; all gates green; deploy + `make seed` if any
  template changed.

## Quality Gates
After each milestone:
```bash
npm run quality:check          # CI parity (tests + build) — NOT the :fast variant
cd backend && make lint && make test-fast
```
Browser-verify the create-A-then-B flow + student `/lessons` per the
`aitana-frontend-verify` skill.

## Success Metrics
- [ ] Regression test: two activities in one class both persist (the bug).
- [ ] Backend + frontend test suites green; `make lint` + `npm run quality:check` clean.
- [ ] Backfill verified on a `curly-goose-50` data copy; migration notes recorded.
- [ ] Browser: student sees N activities; teacher create-another yields distinct ids.

## Dependencies
- None blocking. M0.3 (re-key) gates M0.4 — sequence within the sprint.

## Open Questions
- **Published/sharing is deferred** — M1 ships `draft|private` only; `published` + the
  shared catalogue + adopt is M3 (out of sprint). Confirm that's the intended cut.
- **Student lesson label** = activity `title` (doc Q4) — assumed yes.
- Run the backfill against **prod `curly-goose-50`** only after a verified dry-run on a
  data copy — confirm the cutover window (ideally before the 06-29 freeze).

## Notes
- M0 is independently valuable and is the actual bug fix — prioritise it to land before
  the holiday freeze; M1 is the UX-coherence half ("Add from catalogue" confusion).
- Additive migration only: do **not** delete `activity_configs` this sprint; the
  dual-read window retires it later (post-cutover), matching the doc's §Migration.
- Record every Firestore/GCP side effect in the migration notes (Terraform recipe for
  test/prod), per the side-effects discipline.
</content>
</invoke>
