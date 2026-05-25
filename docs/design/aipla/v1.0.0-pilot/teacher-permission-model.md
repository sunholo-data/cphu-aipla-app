# Teacher permission model — Firebase auth, Class entity, tag-based skill access

**Status**: Planned
**Priority**: P1 (foundational for v1 — every teacher-facing surface depends on it)
**Estimated**: ~3-5 days implementation (combined; ~0.5d for this doc itself)
**Scope**: Backend (Class model + Firestore CRUD + teacher-auth wiring) + Frontend (teacher dashboard + class-management UI) + Auth (extend `AnonymousGroupAuthProvider` with a Firebase teacher path)
**Dependencies**: v0.1 shipped; existing `AccessControl` 5-type model ([backend/db/models/access.py](../../../../backend/db/models/access.py)); existing anon-group auth ([backend/auth/group_id_auth.py](../../../../backend/auth/group_id_auth.py))
**Created**: 2026-05-24
**Last Updated**: 2026-05-24

## Problem Statement

v0.1 ships anonymous-group student auth and a single platform-owned skill (`problem-set-hints`). For v1.0.0-pilot (10 teachers + K, 2026-08-14), teachers need to **own** the system: sign in, create classes, mint group codes that bind to those classes, and pick which skills (lessons) each class can use. None of that exists today.

The pieces are all *adjacent* in the current code but **not connected**:

- `AccessControl` already supports a `tagged` access type via `User.group_tags ∩ AccessControl.tags` (5 access types: `private`, `public`, `domain`, `specific`, `tagged`). The docstring at [backend/db/models/access.py:12](../../../../backend/db/models/access.py#L12) calls `tagged` "the B2B team-sharing primitive" — exactly what we need.
- `AnonymousGroupAuthProvider` mints group JWTs but always sets `group_tags=frozenset()` ([backend/auth/group_id_auth.py:175](../../../../backend/auth/group_id_auth.py#L175)). Groups have no tags → tag-based skill access is unreachable from the student side.
- Firebase Auth is wired ([frontend/src/lib/firebase.ts](../../../../frontend/src/lib/firebase.ts) — `signInWithRedirect` + `GoogleAuthProvider` exist) but no teacher route uses it; the home page just routes anon-group users straight to `/group`.
- The scoping site ([architecture.qmd ADR-001](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd#adr-001-student-identity-no-auth-anonymous-group-ids) and [strands.qmd](file:///Users/mark/Documents/clients/cph-uni/strands.qmd) `manage-class` row) decided teachers get UCPH SSO *or* Firebase federated; the v1 scope commits to `manage-class` as a teacher skill. The auth-mechanism choice is the "open question for JB" still flagged in the ADR.

**Current State:**
- No `Class` entity in Firestore. Group codes ([anon_groups collection](../../../../backend/auth/group_id_auth.py)) exist standalone with no parent. Teachers can't see their own classes because there's no concept of one.
- No teacher route on the frontend. Home page (`/`) is anon-group-only in v0.1's `NEXT_PUBLIC_AUTH_MODE=anonymous_group_id` config.
- All skills currently default to `AccessControl(type="public")` ([platform_seed.py](../../../../backend/admin/platform_seed.py)). No way for a teacher to scope a skill to "my class only."
- Two teachers minting group codes today could in principle collide on tags (none in use, but no namespacing means it'd be a race-to-the-bottom once tags appear).
- The CLI surface ([cli/aiplatform/commands/groups.py](../../../../cli/aiplatform/commands/groups.py)) lists groups by uid; there's no `aiplatform class` command and no `class:<id>` namespace to scope group operations to.

**Impact (if not built):**
- v1 pilot cannot ship. The "5 skills + curated sim library + teacher config + multimodal + BigQuery logs + per-class budgets enforced" commitment in [aipla/SEQUENCE.md](../SEQUENCE.md) at v1.0.0-pilot requires teachers to *exist* as first-class actors with at least three operations: log in, create class, assign skills.
- Per-class budget enforcement (1.12) needs a `Class` to enforce against. Without it, budget is per-uid which doesn't match the pedagogical unit ("a class of ~25 students for one term").
- Strand-B (student-as-creator, v2) needs per-class scoping to prevent one class's experiments from spilling into another's session state. The permission model has to land before any v2 work meaningfully starts.

## Goals

**Primary Goal:** A teacher signs in via Firebase (Google OAuth as the v1 default; UCPH SSO as the v2 upgrade path), creates a `Class`, the system mints group codes that inherit the class's tag namespace, the teacher picks which skills the class can use, and students who join via those codes can only see those skills. End-to-end, **reusing the existing 5-type `AccessControl` model with zero changes to the evaluator** — the work is the ownership / minting / lifecycle layer above it.

**Success Metrics:**
- Teacher signs in via Google OAuth on `/teacher` and lands on a dashboard within **~1.5s TTI** (Firebase Auth is already in the bundle; this is a routing + redirect + state-bootstrap operation, not a new dep).
- New teacher creates a class via the `manage-class` skill UI in **<60s** (form: class name + lessons multi-select; system mints 1-5 group codes; teacher copies them to hand out).
- Anonymous student joining via a group code that's bound to a class with `lessons=[A, B]` sees A and B in their `/skills` API response — and is rejected by the access policy on attempting to invoke any other skill.
- Zero tag-namespace collisions possible: collision attempt is rejected at `Class.create()` time by the namespace-prefix invariant; this is testable in `tests/unit/test_class_model.py`.
- Existing 5-type `AccessControl` evaluator ([backend/auth/access_context.py](../../../../backend/auth/access_context.py)) **untouched** — verified by `git diff` showing no changes to that file's `can_access()` logic.
- `aiplatform class new/list/lessons/groups` CLI commands work end-to-end against a deployed dev backend, covered by `cli/tests/test_cli_class.py`.

**Non-Goals:**
- UCPH SSO. Federation of Firebase Auth with UCPH IDP is **v2**, not v1. v1 ships Google OAuth as the teacher-auth mechanism — sufficient for the 10-teacher pilot (each teacher uses a UCPH-issued Google Workspace identity). The permission model is auth-mechanism-agnostic; swapping to UCPH SSO later is a Firebase configuration change, not a model change.
- Multi-school / institutional admin. There is no role "above" teacher in v1. UCPH-level admins would need to manage cross-class data, audit budgets across teachers, etc. — that's a v2 / handover concern.
- Sub-class / sub-group hierarchies. A class is flat; it has groups; groups have students. No "study squad" or "homework sub-group" layer.
- Renaming `Skill` to `Lesson` in code. `Skill` stays the technical primitive. "Lesson" is **only** a UX label applied in teacher- and student-facing surfaces. (Decision: see "Lesson naming" subsection under Design.)
- Cross-class skill sharing. A teacher's class can use skills the *platform owns* (public access) or skills *the teacher created* (tagged with their class). Teachers can't (in v1) share a custom skill across their own classes via "shared skill" or across teachers via "marketplace." That's v2.
- Migrating existing v0.1 group codes (e.g. `local-demo`) to be class-owned. Pre-v1 group codes stay platform-owned (the "implicit platform class" with `tags=[]`); v1 introduces classes alongside.

## Axiom Alignment

Scored per [docs/product-axioms.md](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Teacher dashboard is a new surface — not a performance regression on student flow. Performance is "fast enough for a config screen" (~1.5s TTI), not "instant" |
| 2 | EARNED TRUST | +1 | Tag-namespace invariant (`class:<teacher_uid>:<class_id>`) is **enforced server-side** — a teacher cannot construct a tag that reaches into another teacher's namespace, even by tampering. Plus per-class soft-delete preserves audit trail (no data destruction). Both close trust holes that a "just put tags in a string field" approach would leave open |
| 3 | SKILLS, NOT FEATURES | +1 | `manage-class` is itself a skill (per strands.qmd v1 commitment) — teachers interact with class management via the same AG-UI + A2UI surface students use, not a separate "teacher app." Doubles down on the skills-as-the-interface decision |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model in this path — pure auth/data work |
| 5 | GRACEFUL DEGRADATION | +1 | When teacher's Firebase token expires mid-session, group codes the teacher already minted continue to work (group JWTs are independent of teacher session). Per-class budget enforcer continues to enforce even without the teacher dashboard being open. Student flow degrades gracefully if class metadata is unreachable (falls back to "no lessons available" rather than 500) |
| 6 | PROTOCOL OVER CUSTOM | +1 | **No new auth/access protocol.** Firebase Auth (industry-standard OIDC) for teacher; the existing 5-type `AccessControl` model with `tagged` primitive (already in tree) for lesson access; existing anonymous-group JWT shape for students. The entire design is "wire up what's already there" — no custom envelope, no custom auth scheme |
| 7 | API FIRST | +1 | Every teacher operation has a corresponding backend endpoint + CLI command before any frontend ships: `POST /api/classes`, `GET /api/classes/{id}`, `PATCH /api/classes/{id}/lessons`, `POST /api/classes/{id}/groups`. Frontend is a thin client over the API. Teachers can manage classes via CLI alone if the UI ever breaks |
| 8 | OBSERVABLE BY DEFAULT | +1 | Every class operation emits an OTel span keyed by `class_id` + `teacher_uid`. The existing per-class budget enforcer (1.12) can attach to these spans for ratelimit / cost accounting without separate plumbing |
| 9 | SECURE BY CONSTRUCTION | +1 | Tag-namespace prefix invariant is enforced at the Pydantic-validator layer of `Class` — a malformed tag fails before reaching Firestore. Combined with the existing audited `AccessContext.can_access()` evaluator, the security surface is **smaller** than today (we delete the gap where two teachers could collide on tags) |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Standard CRUD; client renders forms over typed API. Neither thinner nor fatter than the rest of the stack |
| | **Net Score** | **+7** | Threshold >= +4 OK |

**Conflict Justifications:** None. No -1 scores.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| Teacher authentication | OIDC via Firebase Auth (industry standard), Google OAuth provider | `firebase/auth` SDK is already a dep; `GoogleAuthProvider` + `signInWithRedirect` are used in [frontend/src/lib/firebase.ts](../../../../frontend/src/lib/firebase.ts) for the existing (unused-in-anon-mode) Google sign-in path. Verified API: `signInWithPopup`, `signInWithRedirect`, `GoogleAuthProvider` per Firebase JS SDK v10.x (the version we pin) |
| Lesson access control | Existing `AccessControl` Pydantic model with `type: "tagged"` ([backend/db/models/access.py](../../../../backend/db/models/access.py)) | Zero changes to model or evaluator. `Class` populates `Skill.accessControl.tags` with class-namespaced tags |
| Group token format | Existing HS256 JWT shape minted by [backend/auth/group_id_auth.py](../../../../backend/auth/group_id_auth.py) | Adds one custom claim — `class_id` — and populates `group_tags` from the class. No new format |
| API shape | REST over `/api/classes/...` following the existing pattern from `/api/skills/...` | Same auth dependency (`Depends(get_current_user)` with Firebase-uid verification), same access-context middleware injection |
| Standards docs (not invented) | None new — the design is `Firebase Auth + AccessControl(type="tagged") + new Pydantic model with a string-prefix invariant` | Worth saying explicitly: this design adds zero new wire formats |

**No new protocols, no new wire formats, no new auth schemes.** This is plumbing on top of audited primitives.

## CLI Surface

Per [design-doc-creator §5b-bis](../../../../.claude/skills/design-doc-creator/SKILL.md), every developer-facing surface gets a CLI affordance baked in. Teachers will mostly use the GUI, but ops + debugging + tests + AR's authoring loop all need CLI access.

| Command | Purpose | Position in tree |
|---|---|---|
| `aiplatform class new --name <name> [--description <text>]` | Create a class as the authenticated teacher (CLI authenticates as the teacher's Firebase token via `aiplatform auth login` from a prior step) | new `aiplatform class` family |
| `aiplatform class list [--teacher <uid>]` | List classes owned by the current teacher (or another teacher with `--teacher`, admin-only) | new |
| `aiplatform class get <class_id>` | Show full class detail — name, tag namespace, lessons, group codes, member count, soft-delete status | new |
| `aiplatform class lessons <class_id> --add <skill_id> ...` / `--remove <skill_id>` | Manage which skills the class can access. Writes `Skill.accessControl.tags` for new bindings | new |
| `aiplatform class groups <class_id> [--mint <N>] [--list] [--revoke <group_code>]` | Manage group codes under this class. `--mint N` mints N codes that all carry the class's tag namespace | new (extends existing `aiplatform groups` family) |
| `aiplatform class delete <class_id>` | Soft-delete a class. Flips `revoked: true` on the doc; group JWTs validate live against this flag | new |

Estimate: **~0.5 day** total for all six CLI hooks (one Click subcommand each + httpx call + a unit test per command). Falls naturally out of the API-first ordering — the CLI is written *while* the API is being designed, not after.

**Backlink to** [local-dev-cli.md](../../v6.1.0/local-dev-cli.md) — the platform CLI conventions doc this extends.

## Design

### Architecture overview

```
                  Browser (chat.example.com)
                  ┌──────────────────────────────────────────────┐
                  │ Teacher path                                  │
                  │   /teacher → Firebase Auth (Google OAuth)     │
                  │      ↓                                        │
                  │   Teacher Dashboard                           │
                  │   - Classes I own (list)                      │
                  │   - Create class                              │
                  │   - Pick lessons for class                    │
                  │   - Mint / revoke group codes                 │
                  │      ↓ (calls)                                │
                  │ Student path (unchanged from v0.1)            │
                  │   /group → paste code → Anonymous group JWT   │
                  │      ↓ JWT carries class_id + group_tags      │
                  │   /chat/<skill> → access enforced by tags    │
                  └──────────────────────────────────────────────┘
                                  ↓
                  Backend (FastAPI)
                  ┌──────────────────────────────────────────────┐
                  │ Auth middleware                                │
                  │  - Firebase JWT (teacher uid + email)         │
                  │  - or HS256 anon-group JWT (uid + class_id + │
                  │    group_tags)                                │
                  ├──────────────────────────────────────────────┤
                  │ Firestore                                      │
                  │  classes/<class_id>                            │
                  │  ├─ ownerUid: teacher firebase uid             │
                  │  ├─ name: "Physik 9A vår 2026"                │
                  │  ├─ tagNamespace: "class:<teacher_uid>:<id>"  │
                  │  ├─ lessons: [skill_id_A, skill_id_B]          │
                  │  ├─ groupCodes: [adjective-noun-NN, ...]       │
                  │  └─ revoked: false                              │
                  │                                                │
                  │  skills/<skill_id> (UNCHANGED)                 │
                  │   accessControl: {type: "tagged",              │
                  │     tags: ["class:<teacher_uid>:<class_id>"]} │
                  │                                                │
                  │  anon_groups/<group_code> (modified)           │
                  │   class_id: <class_id>          # NEW          │
                  │   tagNamespace: <inherits from class>          │
                  └──────────────────────────────────────────────┘
```

The dotted line: students never see the teacher path; teachers don't need to manage anonymous-group state directly. The Class doc is the only new entity; everything else is field additions / wiring.

### The `Class` entity

**Firestore collection:** `classes/<class_id>`

**Pydantic model** (new file `backend/db/models/class_.py` — trailing underscore because `class` is reserved):

```python
class Class(BaseModel):
    """Teacher-owned grouping of students + lessons.

    The tag-namespace prefix is the load-bearing invariant:
    `class:<owner_uid>:<class_id>`. Constructed server-side; a teacher
    cannot supply or modify it directly. This makes tag-collision
    between teachers structurally impossible — two teachers can never
    produce the same tag because uids are unique.

    Soft-deleted (`revoked: true`) classes stop minting new groups
    and their existing group JWTs are rejected at verification time,
    but the doc + audit trail stays.
    """

    class_id: str = Field(alias="classId")  # short ULID
    owner_uid: str = Field(alias="ownerUid")  # teacher's Firebase uid
    name: str  # human-readable, e.g. "Physik 9A vår 2026"
    description: str | None = None
    tag_namespace: str = Field(alias="tagNamespace")  # derived, immutable
    lessons: list[str] = Field(default_factory=list)  # skill_ids
    group_codes: list[str] = Field(alias="groupCodes", default_factory=list)
    revoked: bool = False
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    revoked_at: datetime | None = Field(alias="revokedAt", default=None)

    @field_validator("tag_namespace")
    @classmethod
    def _validate_tag_namespace(cls, v: str, info: ValidationInfo) -> str:
        owner_uid = info.data.get("owner_uid")
        class_id = info.data.get("class_id")
        expected = f"class:{owner_uid}:{class_id}"
        if v != expected:
            raise ValueError(f"tag_namespace must be {expected!r}, got {v!r}")
        return v
```

**The validator is the security boundary.** A teacher API call that tries to set an arbitrary tag fails at Pydantic validation before hitting Firestore. The only path that produces a valid `Class` instance is `Class.create_for_teacher(uid, name)` which constructs the namespace internally.

### Teacher Firebase auth path

**Frontend.** Extend [frontend/src/contexts/AuthContext.tsx](../../../../frontend/src/contexts/AuthContext.tsx) so the teacher path runs alongside (not instead of) anon-group:

```tsx
// In NEXT_PUBLIC_AUTH_MODE=anonymous_group_id+teacher (v1 default):
// - /        → home (links to /group OR /teacher)
// - /group   → existing anon-group join
// - /teacher → NEW Firebase Google OAuth signin + dashboard
// - /chat/*  → works for both auth modes (auth middleware accepts either token)
```

The existing `signInWithRedirect(auth, new GoogleAuthProvider())` flow in [frontend/src/lib/firebase.ts](../../../../frontend/src/lib/firebase.ts) is already configured for the inherited template's teacher routes — they just don't have teacher routes yet. Wire is two new routes + a route-guard hook (`useTeacherAuth`).

**Backend.** The existing `get_current_user` dependency in [backend/auth/__init__.py](../../../../backend/auth/__init__.py) already dispatches by mode (Firebase OR LOCAL_MODE OR anon-group). For v1 we add a third arm: if the token verifies as a Firebase JWT, return a `User` with `auth_mode="firebase_teacher"`. The route handlers downstream use this mode to enforce "teachers can write to `classes/*`; students can only read their bound class."

### Group → Class binding

[backend/auth/group_id_auth.py:175](../../../../backend/auth/group_id_auth.py#L175) currently passes `group_tags=frozenset()`. After v1, when a group code is minted under a class:

```python
# Before
group_tags=frozenset(),

# After (group bound to a class)
group_tags=frozenset({class.tag_namespace}),
```

…which means `AccessContext.can_access(skill)` for a `Skill` with `accessControl={type: "tagged", tags: [class_namespace]}` immediately returns True via the existing `User.group_tags ∩ AccessControl.tags` check. The 5-type evaluator code is **literally unchanged**.

### Lesson naming

`Skill` stays the technical term throughout the backend, frontend code, ADK agent names, MCP tool config, and API endpoints. **"Lesson" is purely a UX label** applied at the surface:

- Teacher dashboard: "Add a lesson to this class" (the API call writes `Class.lessons`)
- Student chat: "Today's lesson: Boldkast — projectile motion" (the agent's welcome panel)
- CLI: stays `aiplatform class lessons <class_id> --add <skill_id>` for grep-ability

The decision is documented here once so we don't keep re-litigating it. Renaming `Skill → Lesson` in code would touch ~200 files for zero pedagogical value.

### Sequence: a teacher creating a class

```
1. Teacher signs in at /teacher (Google OAuth → Firebase JWT)
2. POST /api/classes  body: {name: "Physik 9A"}
     → backend creates class_id (ULID); tag_namespace = "class:<uid>:<ULID>"
     → Firestore: classes/<ULID> document
     → response: full Class doc
3. Teacher picks skills via dashboard:
   PATCH /api/classes/<id>/lessons  body: {add: [skill_id_A, skill_id_B]}
     → backend updates each Skill's accessControl: appends tag_namespace to
       skill.access_control.tags (idempotent)
     → backend updates Class.lessons
4. Teacher mints group codes:
   POST /api/classes/<id>/groups  body: {count: 3}
     → backend mints 3 codes via existing minting path; each carries class_id
       and tag_namespace
     → response: ["adjective-noun-12", "adjective-noun-34", "adjective-noun-56"]
5. Teacher hands codes to students.
6. Student joins with code (existing v0.1 flow unchanged):
   POST /api/auth/group/join  body: {code: "adjective-noun-12"}
     → backend loads anon_groups/<code>; reads class_id + tag_namespace from
       the bound class
     → mints anon-group JWT with group_tags = {tag_namespace}
     → response: jwt
7. Student visits /skills:
   GET /api/skills  → backend filters via AccessContext.can_access(skill);
     returns only skills whose accessControl.tags ∩ user.group_tags is
     non-empty
     → student sees skill_A and skill_B (NOT the platform's other skills)
```

Steps 1, 2, 3, 4, 7 are new endpoints. Step 5 is a teacher physical act. Step 6 is a one-line edit in `user_from_token` to read `claims.get("group_tags", [])` instead of always passing `frozenset()`.

## API Changes

**New endpoints:**

| Method + Path | Purpose | Auth |
|---|---|---|
| `POST /api/classes` | Create class (teacher creates a class they own) | Firebase teacher JWT |
| `GET /api/classes` | List classes for current teacher | Firebase teacher JWT |
| `GET /api/classes/{class_id}` | Get one class | Firebase teacher (owner) |
| `PATCH /api/classes/{class_id}` | Update class fields (name, description) | Firebase teacher (owner) |
| `DELETE /api/classes/{class_id}` | Soft-delete class | Firebase teacher (owner) |
| `PATCH /api/classes/{class_id}/lessons` | Add/remove skills from class | Firebase teacher (owner) |
| `POST /api/classes/{class_id}/groups` | Mint N group codes under class | Firebase teacher (owner) |
| `DELETE /api/classes/{class_id}/groups/{code}` | Revoke a group code | Firebase teacher (owner) |

**Modified endpoints:**

| Path | Modification |
|---|---|
| `POST /api/auth/group/join` | Reads `class_id` from `anon_groups/<code>`; if bound, JWT carries `group_tags=[class.tag_namespace]` |
| `GET /api/skills` | Filter already uses `AccessContext.can_access()`; no code change, but behaviour now distinguishes class-bound students from public-only access |

**Pydantic request shapes** — all defined in `backend/db/models/class_.py` and tested in `tests/unit/test_class_model.py`.

## Migration

**Firestore.** New `classes` collection. No schema migration of existing data — `anon_groups` gets an optional `class_id` field added (Firestore is schema-on-write, so existing docs without the field stay valid). Pre-v1 group codes (like `local-demo`) keep `class_id = null` and continue to mint JWTs with `group_tags=frozenset()` (the "implicit platform class" — public skills only).

**Frontend.** New `/teacher` route. Existing `/group` and `/chat/*` routes unchanged. `NEXT_PUBLIC_AUTH_MODE` gains a third value `anonymous_group_id+teacher` (default for v1 deploys). LOCAL_MODE still works as a separate auth shortcut for dev.

**Feature flag:** none. Either v1 ships with the teacher path enabled, or it doesn't. The risk surface is small enough that a flag adds more complexity than safety.

**Rollback:** revert the v1 commits. v0.1 group flow continues to work because the `class_id` field is optional throughout.

## Testing Strategy

**Backend (pytest):**

- `backend/tests/unit/test_class_model.py` (new):
  - `tag_namespace` validator rejects manually-supplied tags
  - `Class.create_for_teacher(uid, name)` produces the correct namespace
  - Soft-delete (`revoke()`) sets `revoked=True` + `revoked_at`; idempotent
- `backend/tests/api_tests/test_classes_route.py` (new): each new endpoint, happy path + auth gate + ownership gate (teacher A can't read teacher B's class).
- `backend/tests/api_tests/test_group_join_with_class.py` (new): join a code bound to a class, verify the minted JWT carries `group_tags` equal to the class's namespace.
- `backend/tests/integration/test_class_skill_access_e2e.py` (new, slow-marked): full chain — create class, add lessons, mint group code, anon-join, `GET /api/skills` returns only those lessons. Exercises the **real** `AccessContext.can_access` evaluator with no mocks (per the [feedback-self-testable-loops](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_self_testable_loops.md) memory's pattern).

**Frontend (vitest):**

- `frontend/src/contexts/__tests__/AuthContext.test.tsx`: teacher Google OAuth path returns a Firebase JWT; route-guard hook redirects unauthed teacher attempts to `/teacher`.
- `frontend/src/app/teacher/__tests__/page.test.tsx` (new): dashboard renders class list; create-class form submits to `POST /api/classes` (mocked).
- Existing tests for `/group` and `/chat/*` unaffected.

**CLI (pytest under `cli/tests/`):**

- `cli/tests/test_cli_class.py` (new): every new subcommand wraps the right httpx call with the right shape. Mocked transport via `respx`, same pattern as [test_cli_sessions.py](../../../../cli/tests/test_cli_sessions.py).

**Smoke:** extend `scripts/smoke-jutland.sh` (or create `scripts/smoke-v1-permission-model.sh`) — teacher signs in (LOCAL_MODE stub), creates a class, adds the demo skill, mints a group code, an anon-student joins, fetches skills, sees only the demo skill. Exits 0 on full chain.

## Implementation Plan

| Step | What | Where | Est |
|---|---|---|---|
| 1 | `Class` Pydantic model + tag-namespace invariant + tests | `backend/db/models/class_.py`, `tests/unit/test_class_model.py` | 0.3 d |
| 2 | Firestore CRUD for classes | `backend/db/classes.py`, `tests/unit/test_classes_firestore.py` | 0.3 d |
| 3 | Teacher Firebase auth path in `get_current_user` | `backend/auth/__init__.py`, `backend/auth/firebase_auth.py`, `tests/unit/test_get_current_user_teacher.py` | 0.2 d |
| 4 | API routes for classes | `backend/protocols/classes_routes.py`, `tests/api_tests/test_classes_route.py` | 0.5 d |
| 5 | Group → Class binding in `group_id_auth.py` | `backend/auth/group_id_auth.py`, `tests/api_tests/test_group_join_with_class.py` | 0.2 d |
| 6 | E2E test exercising the full chain | `tests/integration/test_class_skill_access_e2e.py` | 0.2 d |
| 7 | Teacher dashboard route + auth context | `frontend/src/app/teacher/page.tsx`, `frontend/src/contexts/AuthContext.tsx`, tests | 0.7 d |
| 8 | `manage-class` skill A2UI form | `backend/skills/templates/manage-class/SKILL.md`, A2UI surface | 0.6 d |
| 9 | CLI `aiplatform class` family | `cli/aiplatform/commands/class_.py`, `cli/tests/test_cli_class.py` | 0.5 d |
| 10 | Smoke script + docs | `scripts/smoke-v1-permission-model.sh`, this doc's Status update | 0.2 d |
| | **Total** | | **~3.7 d** (≈ 4 days with buffer) |

## Success Criteria

- [ ] `make test-fast` (backend) green; all new tests pass.
- [ ] `npm run quality:check` (frontend) green; new teacher route + AuthContext tests pass.
- [ ] CLI `make cli-selftest` green; `aiplatform class` family exercised.
- [ ] Smoke script `scripts/smoke-v1-permission-model.sh` exits 0 against LOCAL_MODE backend.
- [ ] Manual: teacher signs in with Google OAuth at `/teacher`, creates a class, picks lessons, mints group codes; anon student joins and sees only those lessons.
- [ ] Tag-namespace invariant verified: an attempt to POST a Class with a bare/colliding tag (via curl, bypassing the dashboard) fails with 400 from the Pydantic validator.
- [ ] Backend log shows `class_id` + `teacher_uid` on every span emitted from `/api/classes/*` routes (OTel attribute set).
- [ ] Existing `AccessContext.can_access()` evaluator unchanged (`git diff` against `dev` shows no edits to that file).
- [ ] AR + JB walkthrough — does the teacher dashboard match their expectation of "create class, pick lessons, hand out codes"? Documented in a follow-up note.

## Out of Scope (deferred)

- **UCPH SSO federation.** v2. Firebase Auth can federate with arbitrary OIDC providers; the data model doesn't change. v1 ships Google OAuth as the sole teacher-auth provider; 10-teacher pilot all have UCPH Google Workspace identities so this is sufficient.
- **Per-class budget UI** ([SEQUENCE.md row 1.12](../SEQUENCE.md)) — the enforcer ships; the *display* in the teacher dashboard is a follow-up sprint.
- **Audit log of teacher actions.** OTel spans are emitted (per axiom 8), but a queryable "what did teacher X do this week" log lives in BigQuery (1.2 chat-log-pipeline territory).
- **Class transfer between teachers.** Teacher leaves UCPH; their classes need to migrate to another teacher. v2 admin concern.
- **Multi-teacher classes.** A class with two co-teachers. v2 admin concern.
- **Lesson-level overrides** (e.g. "this lesson is available to class A but only to students whose tag also includes 'advanced'"). Would require nested tag matching; not in v1 scope.

## Related Documents

- [../SEQUENCE.md](../SEQUENCE.md) — top-level AIPLA roadmap; this doc consolidates the originally-separate rows 1.6 (`teacher-auth-ucph-sso.md`) and 1.7 (`class-and-group-management.md`)
- [./SEQUENCE.md](SEQUENCE.md) — v1.0.0-pilot version-local sequence
- [ADR-001](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd#adr-001-student-identity-no-auth-anonymous-group-ids) — anonymous group IDs (this doc's parent decision)
- [strands.qmd](file:///Users/mark/Documents/clients/cph-uni/strands.qmd) — `manage-class` skill row in the v1 catalogue
- [backend/db/models/access.py](../../../../backend/db/models/access.py) — 5-type AccessControl model (untouched by this design)
- [backend/auth/group_id_auth.py](../../../../backend/auth/group_id_auth.py) — anon-group JWT minting (modified: now carries class_id + group_tags)
- [v0.1.0-jutland/group-tooling.md](../v0.1.0-jutland/group-tooling.md) — `aiplatform groups` CLI v0.1; the `aiplatform class` family extends this pattern
- [docs/upstream-feedback.md](../../../upstream-feedback.md) — entries about teacher auth + permission gaps in the inherited template that this design resolves
- Memory: [feedback-search-protocols-first](../../../../../.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_search_protocols_first.md) — the principle that says "search for existing primitives before designing new ones." This doc explicitly leans on the already-shipped 5-type `AccessControl` model rather than inventing a new access mechanism
