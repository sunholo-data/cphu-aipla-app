# Sprint: TEACHER-PERMISSION-1A — teacher Firebase auth + Class entity + tag-based access

**Sprint ID:** `TEACHER-PERMISSION-1A`
**Design doc:** [teacher-permission-model.md](teacher-permission-model.md)
**Branch:** `feature/teacher-permission-model` (executor scratch space; final commits land direct on `dev` per AIPLA workflow — see Workflow note below)
**Base commit:** `48bfe03` (dev HEAD as of 2026-05-26)
**Promotion path:** `dev` → `test` (PR-gated) → `prod` (PR-gated). **No PR for `dev`.**
**Estimate:** ~4 days (design doc says 3.7d; +0.3d buffer for Firebase Auth integration surprises)
**Created:** 2026-05-26

## Sprint goal

Replace the LOCAL_MODE teacher stub from 1.G-Ph2 with the real teacher permission model: Firebase Auth (Google OAuth) for teachers, a `Class` Firestore entity with a structurally-uncollidable tag namespace, group → class binding so student group codes inherit class tags, and tag-based skill access via the **existing** 5-type `AccessControl` evaluator. End-to-end on the deployed dev backend; no UI swap (that's 1.G-Ph3, a separate sprint).

**Why this is foundational, not a feature:** every later teacher-facing surface (1.G-Ph3 Firebase swap, 1.C/1.D skill access scoping, 1.12 per-class budgets, Strand B v2) needs the `Class` entity. Until it exists, all of those are blocked or take shortcuts that have to be unwound.

## Scope (locked from design doc)

**In scope:**
- `Class` Pydantic model (new file `backend/db/models/class_.py`) with the **load-bearing tag-namespace invariant** `class:<owner_uid>:<class_id>`, validated server-side at construction
- Firestore CRUD for classes (`backend/db/classes.py`)
- Teacher Firebase auth path: extend `get_current_user` dispatch in `backend/auth/__init__.py` to accept a Firebase teacher JWT alongside anon-group + LOCAL_MODE
- 8 new REST endpoints under `/api/classes/*` (CRUD + lessons + groups + soft-delete)
- Group → Class binding: when a code is minted under a class, the anon-group JWT carries `group_tags={class.tag_namespace}` (replaces today's hardcoded `frozenset()` at [backend/auth/group_id_auth.py:175](../../../../backend/auth/group_id_auth.py#L175))
- `manage-class` skill (teacher-facing A2UI form) — create classes, mint codes, pick lessons
- `aiplatform class` CLI family (6 subcommands per design-doc CLI surface table)
- Soft-delete only — `Class.revoked=True` flips a flag; group JWTs validate against the live flag on every request
- E2E test exercising the full chain with the **real** `AccessContext.can_access` evaluator, no mocks
- Smoke script `scripts/smoke-v1-permission-model.sh`

**Out of scope (explicitly deferred):**
- UCPH SSO federation (v2 — Firebase configuration change, not a model change)
- Multi-school / institutional admin (UCPH-level roles above teacher)
- The 1.G-Ph3 UI swap that consumes this backend (separate sprint)
- Sub-class hierarchies (study squads, homework subgroups)
- Cross-class skill sharing / skill marketplace (v2)
- Migrating existing v0.1 group codes (`local-demo`, `aipla-demo-*`) to be class-owned — they keep `class_id=null` and continue to mint JWTs with public-only access
- Per-class budget UI (the enforcer ships in 1.12 separately; the display is post-pilot)
- Audit log of teacher actions in BigQuery (1.2 chat-log-pipeline territory)

## Workflow note — direct-to-dev, no PRs

Per [feedback-aipla-git-workflow](file:///Users/voightkampff/.claude/projects/-Users-voightkampff-dev-sunholo-data-cphu-aipla-app/memory/feedback_aipla_git_workflow.md): for AIPLA, commits land **direct on `dev`**. No PR for the `dev` branch. The `feature/teacher-permission-model` branch is the executor's scratch space across milestones; rebase or fast-forward merge to `dev` as each milestone gate passes. Promotion to `test` and `prod` happen later via PRs (those branches are the gates).

## Velocity context

Recent throughput (last 7 days, 124 commits, ~30k LOC including roadmap docs):
- TUTOR-GREET-PH-A (1.I PhA): shipped in ~0.9d (~520 LOC actual)
- QUICK-WINS (1.E + 1.H-TTS): shipped in ~0.8d
- TEACHER-UI-PH2 (1.G-Ph2 backend wire + LOCAL_MODE teacher stub): ~2d

This sprint touches more surface than any of those individually: backend models + Firestore + auth dispatch + 8 endpoints + frontend + skill template + CLI. The design doc's 3.7d estimate breaks down across 10 steps with reasonable per-step granularity. Adding ~0.3d buffer for Firebase Auth integration surprises (the inherited template's `signInWithRedirect` path is configured but unused — a class of latent-bug risk).

## Milestones

The 10 milestones map 1:1 to the design doc's Implementation Plan table. Some are parallelizable in waves (see "Parallelism" section below).

### M1 — `Class` Pydantic model + tag-namespace invariant (~0.3d)

**Files (new):**
- `backend/db/models/class_.py` — `Class` model per design-doc Pydantic block
- `backend/tests/unit/test_class_model.py`

**Acceptance:**
- [ ] `Class.create_for_teacher(owner_uid, name)` constructs `tag_namespace=f"class:{owner_uid}:{class_id}"` server-side
- [ ] `tag_namespace` `@field_validator` rejects any manually-supplied tag that doesn't match the expected shape (raises `ValueError` with the expected value in the message)
- [ ] `Class.revoke()` sets `revoked=True` + `revoked_at`; idempotent (calling twice doesn't change `revoked_at`)
- [ ] camelCase aliases on every field that crosses the wire (`classId`, `ownerUid`, `tagNamespace`, `groupCodes`, `createdAt`, `updatedAt`, `revokedAt`)
- [ ] Unit tests cover: happy-path construct, manual-tag rejection, soft-delete semantics, alias round-trip, two different teachers produce structurally-different namespaces

**Estimated LOC:** ~130 (model 70 + tests 60). **Scope:** backend.

### M2 — Firestore CRUD for classes (~0.3d)

**Files (new):**
- `backend/db/classes.py` — `create_class()`, `get_class(class_id)`, `list_classes_for_owner(owner_uid)`, `update_class()`, `add_lessons()`, `remove_lessons()`, `revoke_class()`, `mint_group_codes_under_class(class_id, count)`, `revoke_group_code()`
- `backend/tests/unit/test_classes_firestore.py`

Pattern: mirror [backend/db/chat_sessions.py](../../../../backend/db/chat_sessions.py) (the existing Firestore-CRUD module that uses the in-memory test fixture in unit tests).

**Acceptance:**
- [ ] All CRUD functions covered by unit tests via the existing in-memory store fixture (no GCP credentials needed)
- [ ] Soft-delete: `revoke_class()` sets the flag without dropping the doc; `get_class()` returns the doc with `revoked=true`
- [ ] `list_classes_for_owner()` filters by owner uid (a teacher can't see another teacher's classes via this path)
- [ ] `mint_group_codes_under_class()` writes both the `anon_groups/<code>` doc with `class_id` and appends to `Class.groupCodes`; atomic via Firestore batch

**Estimated LOC:** ~200 (CRUD 110 + tests 90). **Scope:** backend.

### M3 — Teacher Firebase auth path in `get_current_user` (~0.2d)

**Files:**
- `backend/auth/__init__.py` (modify) — extend dispatch in `get_current_user` to accept a Firebase teacher JWT path alongside the existing anon-group + LOCAL_MODE arms
- `backend/auth/firebase_auth.py` (modify if needed) — confirm the existing M1-template helper returns a `User` with `auth_mode="firebase"` and Firebase uid + email; add a derived `auth_mode="firebase_teacher"` marker so downstream route handlers can distinguish "any Firebase user" from "a teacher logging into our teacher routes" (a future-proofing nicety; in v1 the two are equivalent)
- `backend/tests/unit/test_get_current_user_teacher.py` (new)

**Acceptance:**
- [ ] Firebase token with valid signature + email → `User(auth_mode="firebase_teacher", uid=<firebase uid>, email=<email>)`
- [ ] Existing anon-group tokens still dispatch correctly (regression test)
- [ ] LOCAL_MODE shortcut still works (regression test)
- [ ] Invalid Firebase token → 401 with a clear error message (no auth_mode leakage)

**Estimated LOC:** ~120 (dispatch ~30 + tests 90). **Scope:** backend.

### M4 — `/api/classes/*` REST routes (~0.5d)

**Files (new):**
- `backend/protocols/classes_routes.py` — 8 endpoints per the design-doc API table
- `backend/tests/api_tests/test_classes_route.py`
- `backend/fast_api_app.py` (modify) — register the router

**Endpoints:**

| Method + Path | Purpose |
|---|---|
| `POST /api/classes` | Create class as the authenticated teacher |
| `GET /api/classes` | List classes owned by the current teacher |
| `GET /api/classes/{class_id}` | Get one class (owner-only) |
| `PATCH /api/classes/{class_id}` | Update name/description |
| `DELETE /api/classes/{class_id}` | Soft-delete (sets `revoked=true`) |
| `PATCH /api/classes/{class_id}/lessons` | Add/remove skills `{add: [...], remove: [...]}` |
| `POST /api/classes/{class_id}/groups` | Mint N group codes `{count: N}` |
| `DELETE /api/classes/{class_id}/groups/{code}` | Revoke a group code |

**Acceptance:**
- [ ] Each endpoint: happy-path test + auth-gate (no token → 401) + ownership-gate (teacher A can't read/write teacher B's class → 403/404)
- [ ] `PATCH /lessons` writes `Skill.accessControl.tags` for every added skill (appends `class.tag_namespace` idempotently — calling twice produces no duplicates)
- [ ] `PATCH /lessons` with `remove` undoes the binding (removes the tag from the skill, removes the skill from `Class.lessons`)
- [ ] `POST /groups` returns the freshly-minted group codes in the response body
- [ ] OTel span tag `class_id` + `teacher_uid` set on every class-routes span (verified via test that introspects the test exporter)
- [ ] Pydantic request/response shapes defined alongside `Class` in `backend/db/models/class_.py`

**Estimated LOC:** ~350 (routes 200 + tests 150). **Scope:** backend.

### M5 — Group → Class binding in `group_id_auth.py` (~0.2d)

**Files:**
- `backend/auth/group_id_auth.py` (modify) — `verify_group_token` / `user_from_token` paths: load the `anon_groups/<code>` doc, if `class_id` is set, load the bound `Class`, populate `group_tags={class.tag_namespace}` (and check `class.revoked` — reject the JWT if the class was soft-deleted)
- `backend/tests/api_tests/test_group_join_with_class.py` (new)

**Acceptance:**
- [ ] Anon-student joins via a code bound to a class with `tagNamespace="class:T1:C1"` → minted JWT carries `group_tags=["class:T1:C1"]`
- [ ] Anon-student joins via a pre-v1 group code (no `class_id` field) → minted JWT carries `group_tags=[]` (today's behaviour preserved)
- [ ] Anon-student joins via a code whose bound class is `revoked=true` → 403 with a clear error
- [ ] Existing anon-group tests still pass (regression)
- [ ] At the `verify_group_token` layer, a stale JWT minted before the class was soft-deleted is also rejected (live revocation check)

**Estimated LOC:** ~140 (modifications ~50 + tests 90). **Scope:** backend.

### M6 — Backend E2E test (~0.2d)

**Files (new):**
- `backend/tests/integration/test_class_skill_access_e2e.py` — slow-marked

**Behaviour:** Drives the full chain with the **real** `AccessContext.can_access` evaluator and no mocks:
1. Create class T1 owned by teacher T1
2. Create class T2 owned by teacher T2
3. Add skill A to T1's lessons (writes `Skill.accessControl.tags`)
4. Mint a group code G1 under T1
5. Student joins via G1 → JWT carries T1's namespace
6. `GET /api/skills` for the student returns A but not any T2-only skills
7. Direct `POST /api/skills/<T2-skill>/chat` for the student → 403

**Acceptance:**
- [ ] Test passes against the in-memory Firestore fixture
- [ ] Test marked `@pytest.mark.slow` + `@pytest.mark.integration` (so `make test-fast` skips it but `make test` runs it)
- [ ] Test exercises `backend/auth/access_context.py:can_access()` with **zero edits** to that file — verified by `git diff dev -- backend/auth/access_context.py` showing no changes (recorded as a commit message claim, not enforced by the test itself)

**Estimated LOC:** ~150. **Scope:** backend.

### M7 — Frontend teacher dashboard route + AuthContext (~0.7d)

**Files (new):**
- `frontend/src/app/teacher/page.tsx` — dashboard: class list + create-class form
- `frontend/src/app/teacher/[classId]/page.tsx` — single-class detail: lessons picker + group-code minter (replaces the LOCAL_MODE stub data from 1.G-Ph2; consumes the real `/api/classes/*` endpoints)
- `frontend/src/hooks/useTeacherAuth.ts` — route-guard hook redirecting unauthed teacher attempts to a sign-in surface
- `frontend/src/lib/teacherApi.ts` — typed `fetchWithAuth` helpers for the 8 endpoints

**Files (modify):**
- `frontend/src/contexts/AuthContext.tsx` — surface the Firebase teacher token alongside (not instead of) the anon-group state. Both can coexist; route guards decide which is required for which surface
- `frontend/src/contexts/__tests__/AuthContext.test.tsx` — extend with the teacher OAuth path
- `frontend/src/app/teacher/__tests__/page.test.tsx` (new) — dashboard renders class list, create-class form submits with mocked API

**Acceptance:**
- [ ] Google OAuth sign-in at `/teacher` lands on the dashboard within ~1.5s TTI on a clean cache (manual check via deployed dev URL)
- [ ] Dashboard lists the signed-in teacher's classes via `GET /api/classes` (real backend call, not LOCAL_MODE stub)
- [ ] Create-class form: name field, optional description, "Create" button → `POST /api/classes` → new class appears in the list
- [ ] Single-class detail: lessons multi-select (queries `/api/skills` for the platform skill catalogue), "Add lesson" / "Remove lesson" hits `PATCH /api/classes/{id}/lessons`
- [ ] Group-code minter: "Mint N codes" button → response codes rendered in a copyable list
- [ ] Route guard: visiting `/teacher` without a Firebase token redirects to a sign-in surface (not the anon-group `/group` page)
- [ ] Existing `/group` and `/chat/*` flows unaffected (regression)
- [ ] Vitest green for new + modified tests

**Estimated LOC:** ~500 (pages 300 + auth-context changes 60 + tests 140). **Scope:** frontend.

### M8 — `manage-class` skill A2UI form (~0.6d)

**Files (new):**
- `backend/skills/templates/manage-class/SKILL.md` — skill metadata + instruction
- `backend/skills/templates/manage-class/a2ui.json` — A2UI surface model for the form (create-class + lessons-picker + group-mint actions)

**Files (modify if needed):**
- `backend/admin/platform_seed.py` — seed `manage-class` alongside the other platform skills

**Acceptance:**
- [ ] After re-seed, `manage-class` skill exists in Firestore with `accessControl.type="tagged"` and a `tags=["role:teacher"]` (or equivalent — a teacher-only tag that the Firebase teacher JWT carries; encode the teacher-role tag in the auth dispatch from M3)
- [ ] An anon-student calling `GET /api/skills` does **not** see `manage-class`
- [ ] A teacher calling `GET /api/skills` from `/teacher` does see `manage-class`
- [ ] The skill's A2UI surface renders a create-class form when the teacher invokes it via chat (manual check; the wire-up to the live class CRUD via the agent's tool surface is the same pattern as other A2UI-equipped skills)

**Estimated LOC:** ~180 (skill content + a2ui surface 130 + seed wiring 50). **Scope:** backend.

**Note:** the A2UI form is the chat-driven alternative to the M7 React dashboard — both surfaces consume the same `/api/classes/*` endpoints from M4, by design. JB / AR can pick whichever they prefer; v1 ships both so the choice can be made empirically.

### M9 — `aiplatform class` CLI family (~0.5d)

**Files (new):**
- `cli/aiplatform/commands/class_.py` — 6 subcommands per the design-doc CLI surface
- `cli/tests/test_cli_class.py` — `respx`-mocked transport tests

**Subcommands:**

| Command | Purpose |
|---|---|
| `aiplatform class new --name <name> [--description <text>]` | Create class |
| `aiplatform class list [--teacher <uid>]` | List classes (admin: filter by teacher) |
| `aiplatform class get <class_id>` | Show full class detail |
| `aiplatform class lessons <class_id> --add <skill_id> ... / --remove <skill_id>` | Manage lessons |
| `aiplatform class groups <class_id> [--mint <N>] [--list] [--revoke <code>]` | Manage group codes |
| `aiplatform class delete <class_id>` | Soft-delete |

**Acceptance:**
- [ ] Every subcommand wraps the right `httpx` call with the right body shape (verified by `respx`-mocked tests)
- [ ] CLI authenticates as the teacher's Firebase token via the existing `aiplatform auth login` flow (no new auth path)
- [ ] `--help` strings clear enough to be self-documenting
- [ ] `make cli-selftest` includes a class-roundtrip exercise (create → list → mint code → delete)

**Estimated LOC:** ~280 (commands 180 + tests 100). **Scope:** CLI.

### M10 — Smoke script + quality gates + direct-to-dev merge (~0.2d)

**Files (new):**
- `scripts/smoke-v1-permission-model.sh` — drives the full chain against LOCAL_MODE: teacher signs in (LOCAL_MODE stub), creates class, adds skill, mints code, anon-student joins, fetches skills, sees only the class's lessons. Exits 0 on success.

**Acceptance:**
- [ ] `cd backend && make lint` — clean (CI-parity, ruff check + ruff format --check)
- [ ] `cd backend && make test-fast` — green (excluding pre-existing whoami/tenant failures already documented)
- [ ] `cd frontend && npm run quality:check` — green (lint + typecheck + tests + build)
- [ ] `make cli-selftest` — green
- [ ] Smoke script `scripts/smoke-v1-permission-model.sh` exits 0
- [ ] No emoji in any file changed (per [feedback-no-emoticons](file:///Users/voightkampff/.claude/projects/-Users-voightkampff-dev-sunholo-data-cphu-aipla-app/memory/feedback_no_emoticons.md))
- [ ] Sprint branch `feature/teacher-permission-model` either rebased onto current `dev` and fast-forward merged, OR all milestone commits cherry-picked direct to `dev` — **no PR**
- [ ] `git diff dev~10..dev -- backend/auth/access_context.py` shows zero changes (axiom 9 promise: the 5-type evaluator is untouched)
- [ ] Manual on deployed dev URL: teacher Google OAuth → create class → mint code → anon-student joins → sees only that class's lessons

## Parallelism (for sprint-executor parallel mode)

Dependency graph splits into waves:

```
Wave 1 (foundation, sequential):
  M1 Class model
  ↓
  M2 Firestore CRUD       M3 Teacher Firebase auth  (these two are parallel)
  ↓
Wave 2 (consumers of Wave 1, mostly parallel):
  M4 API routes (needs M2+M3)
  ↓
  M5 Group→Class binding  M6 E2E test          (M5 needs M4; M6 needs M4+M5)
  M7 Frontend dashboard   M8 manage-class skill   M9 CLI    (all need M4; independent of each other)
  ↓
Wave 3 (gates):
  M10 Smoke + quality + merge
```

Practically: M1 must finish first; then M2 + M3 can run in parallel; then M4 (gated on both); then M5 + M6 + M7 + M8 + M9 can run as a fan-out wave (5-way parallel if sprint-executor parallel mode is invoked); then M10 finalises.

**Recommendation for executor mode:** sequential is fine — the design doc estimate is 3.7d which fits within a single focused work-week. Parallel execution would shave maybe 0.5d but adds merge-conflict surface across the AuthContext + skill seed + CLI surface that costs more than it saves at this scale.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Firebase Auth integration: the inherited template's `signInWithRedirect` path is configured but unused; latent bugs may surface (popup vs redirect, OAuth callback URL whitelisting in Firebase console, COOP/COEP header interactions) | Medium | Buffer of ~0.3d already added; M3 has its own milestone separate from M4 so issues are localised; LOCAL_MODE stub from 1.G-Ph2 stays in place as fallback during dev |
| Tag-namespace invariant violated by a future refactor | Low | The Pydantic `@field_validator` is the single security boundary — touching it requires reviewing the related unit tests, which document the constraint |
| Existing `/group` flow regresses when group_id_auth.py is modified | Medium | M5 adds a dedicated regression test for the pre-v1 (null `class_id`) path; existing anon-group tests must stay green |
| `manage-class` skill leaks teacher-only operations to students | Medium | Encoded as `accessControl.type="tagged"` with a teacher-role tag — same audited evaluator that gates every other skill |
| Per-class budget enforcer (1.12, separate sprint) makes assumptions about `Class` shape that aren't met | Low | The `Class` model is sealed in M1 with full unit-test coverage; 1.12 consumes the model, not vice versa |
| Soft-deleted class JWTs leak through if revocation check is forgotten | High initially | M5 acceptance gate: stale JWT minted before soft-delete must be rejected on a fresh request. Tested explicitly |
| Multi-PR-style coordination drift since this sprint commits direct to `dev` | Low | Smaller blast radius than the 5-PR teacher-UI rollout; M10 is the integration gate |

## Success criteria

- [ ] All 10 milestones' acceptance gates met
- [ ] Backend `make lint` + `make test-fast` green
- [ ] Frontend `npm run quality:check` green
- [ ] CLI `make cli-selftest` green
- [ ] Smoke script `scripts/smoke-v1-permission-model.sh` exits 0
- [ ] Manual on deployed dev: full chain works (teacher signs in → creates class → mints code → student joins → sees only that class's lessons → cannot reach other classes' lessons even by direct skill-id)
- [ ] Tag-namespace invariant verified by attempting a curl that POSTs a Class with a bare/colliding `tagNamespace` field → 400 from Pydantic validator
- [ ] Existing `AccessContext.can_access()` evaluator unchanged (`git diff` shows no edits)
- [ ] AR + JB walkthrough captured in a follow-up note (validates the dashboard matches teacher mental model)

## Hand-off note for sprint-executor

This sprint is **planned only** — do NOT auto-execute after the JSON lands. The user will review the plan and explicitly invoke sprint-executor when ready.

When invoked, the executor should:
1. Create branch `feature/teacher-permission-model` off the current `dev` HEAD
2. Run M1 → M10 sequentially (default) or per-wave (if invoked with parallel mode)
3. After each milestone, run the milestone-specific quality gate before moving on
4. At M10, rebase/FF-merge the branch onto `dev` — **no PR for `dev`** (per [feedback-aipla-git-workflow](file:///Users/voightkampff/.claude/projects/-Users-voightkampff-dev-sunholo-data-cphu-aipla-app/memory/feedback_aipla_git_workflow.md))
5. Push to `origin/dev`; Cloud Build deploys automatically

## Out of scope (do NOT start)

Per the design doc Non-Goals + Out-of-Scope sections:

- UCPH SSO federation
- Multi-school / institutional admin
- Sub-class hierarchies
- Cross-class skill sharing / marketplace
- Migrating existing v0.1 group codes to be class-owned
- 1.G-Ph3 UI swap (the React teacher pages today read LOCAL_MODE stub data; the actual swap to Firebase auth in the AuthContext + lift LOCAL_MODE gates is a separate sprint that *consumes* this one's backend)
- Per-class budget UI surfacing (1.12 enforcer ships; display is post-pilot)
- Renaming `Skill → Lesson` in code (documented as locked decision in the design doc)
