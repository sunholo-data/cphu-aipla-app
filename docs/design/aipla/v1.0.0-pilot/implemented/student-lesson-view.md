# Student lesson view — live skill resolve + class-context UI

**Status**: Implemented
**Priority**: P1 (lesson list correctness + class-oriented UX)
**Estimated**: ~0.75 day (backend ~0.25d, frontend ~0.5d)
**Scope**: Fullstack
**Dependencies**: 1.A teacher permission model (shipped), 1.B lesson picker (shipped)
**Created**: 2026-06-01
**Last Updated**: 2026-06-02

## Problem Statement

Two bugs with the same root cause — lesson assignment is live but the group token
treats it as an immutable snapshot taken at mint time.

**Current State:**

- `mint_group_codes_under_class()` calls `create_group(skill_ids=list(cls.lessons))`.
  Correct at mint time, but if a teacher later calls `add_lessons()` or
  `remove_lessons()`, every existing code still carries the old `skill_ids` in the
  stored `GroupRecord`. Students who rejoin see the stale list.
- The `/lessons` page renders a flat alphabetical card grid with no class label.
  Students cannot confirm which class they're logged into, and there is no visual
  separation between "these are your class's lessons" and "these are general platform
  skills."

**Impact:**

- Teachers during the pilot will iterate on lesson assignment regularly. Requiring
  students to request a new code every time lessons change is a support burden.
- Students who land on `/lessons` after joining have no confirmation they're in the
  right class — relevant when multiple classes run in parallel on the same device set.

## Goals

**Primary Goal:** Resolve `skill_ids` live from `Class.lessons` at join time, and
surface the class name on the `/lessons` page so students see class context immediately.

**Success Metrics:**

- Teacher adds a lesson; student who re-visits `/lessons` (or rejoins with the same
  code) sees the new lesson without a new code being minted.
- `/lessons` page shows a "Klasse / Class: [name]" label when the group is class-bound.
- No regression in unbound-group / LOCAL_MODE / Firebase teacher paths.

**Non-Goals:**

- Multi-class grouping in the UI. v1 students have exactly one active class; the design
  accommodates future multi-class but the UI does not attempt it.
- Changing code lifetime or mint flow. Codes keep working as-is; only the join response
  is enriched.
- Real-time push to an open `/lessons` tab (Firestore subscription is post-pilot scope).
- Surfacing class name in the chat page header (separate task).

## Axiom Alignment

Scored per [docs/product-axioms.md](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Live Firestore read in `join_group` adds ~10 ms on a warm container — imperceptible at human scale |
| 2 | EARNED TRUST | +1 | Class name on `/lessons` confirms "you are in Hold 9A" and removes a key source of join-to-lesson confusion |
| 3 | SKILLS, NOT FEATURES | +1 | Presenting lessons inside a named class context reinforces that the student is accessing a curated skill set, not a generic AI chat |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model involved |
| 5 | GRACEFUL DEGRADATION | +1 | Unbound groups (no classId) fall through to stored skill_ids silently; frontend omits the class banner if class_name is absent |
| 6 | PROTOCOL OVER CUSTOM | +1 | Piggybacks on the existing `anon_groups` Firestore lookup already done by `_resolve_class_tags`; no new storage primitives |
| 7 | API FIRST | +1 | Class name and live skill_ids resolved server-side and returned in the join response — client is a dumb consumer |
| 8 | OBSERVABLE BY DEFAULT | 0 | Existing `join_group` log already covers the outcome; no new instrumentation needed |
| 9 | SECURE BY CONSTRUCTION | +1 | Skill access is still enforced server-side via `AccessContext.can_access`. The client skill_ids list is display-only — it cannot grant access to skills not assigned to the class |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | All class context resolved server-side; frontend renders what it receives |
| | **Net Score** | **+7** | Threshold >= +4 OK |

**Conflict Justifications:** None.

## Design

### Backend: live skill_ids at join time

**Files:** `backend/auth/group_id_auth.py`, `backend/auth/group_routes.py`

`_resolve_class_tags()` already does a Firestore `get_document("anon_groups", group_id)`
lookup to retrieve `classId` and then loads the `Class`. `join_group()` duplicates this
call to get class context for the join response. This is acceptable at v1 scale; a
future refactor could share one Firestore read.

**`JoinResult`** (in-memory dataclass) gains two new optional fields:

```python
@dataclass
class JoinResult:
    token: str
    uid: str
    expires_at: float
    skill_ids: tuple[str, ...]
    class_name: str | None = None   # new
    class_id: str | None = None     # new
```

**`join_group()`** after gate 7 (token minted), before `return`:

```python
# Live-resolve class context if this group is class-bound.
live_skill_ids = record.skill_ids
resolved_class_name: str | None = None
resolved_class_id: str | None = None

anon_doc = get_document("anon_groups", group_id)
if anon_doc:
    bound_class_id = anon_doc.get("classId")
    if bound_class_id:
        from db.classes import get_class
        cls = get_class(bound_class_id)
        if cls and not cls.revoked:
            live_skill_ids = tuple(cls.lessons)
            resolved_class_name = cls.name
            resolved_class_id = cls.class_id

return JoinResult(
    token=token, uid=uid, expires_at=exp,
    skill_ids=live_skill_ids,
    class_name=resolved_class_name,
    class_id=resolved_class_id,
)
```

The `if cls and not cls.revoked` guard is purely defensive — at this point `gate 4`
(checked by `_resolve_class_tags`) has already fired for a revoked class, so in
practice the class will not be revoked here. If it somehow were, we fall back to the
stored `skill_ids` silently.

**`JoinGroupResponse`** (Pydantic) gains matching optional fields:

```python
class JoinGroupResponse(BaseModel):
    token: str
    uid: str
    expires_at: float
    skill_ids: list[str] = []
    resumedSessionId: str | None = None
    class_name: str | None = None   # new
    class_id: str | None = None     # new
```

Return site in `join_group_endpoint`:

```python
return JoinGroupResponse(
    token=result.token,
    uid=result.uid,
    expires_at=result.expires_at,
    skill_ids=list(result.skill_ids),
    resumedSessionId=get_active_session_for_group(body.group_id),
    class_name=result.class_name,
    class_id=result.class_id,
)
```

### Frontend: persist class context

**File:** `frontend/src/lib/anonymousGroupAuth.ts`

`PersistedGroupSession` gains two optional fields:

```typescript
export interface PersistedGroupSession {
  token: string;
  uid: string;
  expires_at: number;
  group_code?: string | null;
  skill_ids?: string[];
  resumedSessionId?: string | null;
  class_name?: string | null;   // new
  class_id?: string | null;     // new
}
```

`readStoredGroupSession()` needs no changes — new fields are optional and pass through
`JSON.parse` transparently.

### Frontend: expose class context from provider

**File:** `frontend/src/contexts/AnonymousGroupAuthProvider.tsx`

`AnonymousGroupAuthContextValue` gains:

```typescript
className: string | null;
classId: string | null;
```

In `join()`, store class context alongside the group code:

```typescript
const sessionWithCode: PersistedGroupSession = {
  ...data,
  group_code: code,
  // class_name and class_id already in data if the backend returned them
};
```

In the context `value` object:

```typescript
className: session?.class_name ?? null,
classId: session?.class_id ?? null,
```

### Frontend: class-context lessons page

**File:** `frontend/src/app/lessons/page.tsx`

`AnonGroupLessonsPage` passes the new prop through:

```tsx
<UniversalLessonsPage
  groupAuthStatus={ready ? "ready" : "waiting"}
  allowedSkillIds={groupAuth.skillIds.length > 0 ? groupAuth.skillIds : null}
  className={groupAuth.className}
/>
```

`UniversalLessonsPage` props gains `className?: string | null` and renders a
context banner when set:

```tsx
{className ? (
  <div className="rounded border border-border bg-muted/40 px-3 py-2 text-sm">
    <span className="text-muted-foreground">Klasse / Class: </span>
    <span className="font-medium">{className}</span>
  </div>
) : null}
```

Placed below the `<header>` (the "Lektioner / Lessons" h1) and above the skills grid.
The banner is absent for Firebase teacher, LOCAL_MODE, and unbound-group paths — no
change to any of those.

## API Changes

`POST /api/auth/group/join` response — backward-compatible addition (both new fields
are optional/nullable):

```json
{
  "token": "...",
  "uid": "anon:...",
  "expires_at": 1234567890.0,
  "skill_ids": ["problem-set-hints", "concept-dialogue"],
  "resumedSessionId": null,
  "class_name": "Hold 9A",
  "class_id": "cls_abc123"
}
```

For unbound groups, `class_name` and `class_id` are `null` (or absent — Pydantic
serialises them as `null`).

## Migration

No Firestore schema migrations. `GroupRecord.skill_ids` is retained as-is — it records
what was assigned at mint time and serves as a fallback for unbound groups. We stop
trusting it for class-bound groups at join time; we do not delete it.

No Firestore security rule changes. The `anon_groups` read inside `join_group` is a
backend service-account call.

## Testing Strategy

### Backend

Extend `backend/tests/unit/test_group_id_auth.py`:

- `test_join_live_resolves_updated_class_lessons`: mint code under class with lessons
  [A], call `add_lessons` to add B, then `join_group` — assert `skill_ids = (A, B)`.
- `test_join_returns_class_name_and_id`: assert `class_name` and `class_id` on join
  result for a class-bound code.
- `test_join_unbound_group_returns_stored_skill_ids`: assert `class_name` is `None`
  and `skill_ids` equals the stored tuple for a code with no classId.

Extend `backend/tests/api_tests/test_group_join_with_class.py`:

- Assert `class_name` and `class_id` fields present in HTTP response for class-bound join.
- Assert `class_name: null` in HTTP response for unbound join.

### Frontend

Extend `frontend/src/app/lessons/__tests__/page.test.tsx`:

- Class banner renders when `className` prop is set on `UniversalLessonsPage`.
- Class banner absent when `className` is null.

Extend provider tests to assert `className` and `classId` populated from
`session.class_name` / `session.class_id`.

### Manual

1. Teacher adds a lesson to a class. Student (on existing code) clears sessionStorage
   and rejoins with the same code. Verify new lesson appears.
2. Student lands on `/lessons`. Verify class name matches the class the teacher created.
3. Join with an unbound code (created via `/api/auth/group/create` directly). Verify
   no class banner, full public skill list.

## Success Criteria

- [ ] Teacher adds a lesson mid-session; student reconnects with the same code and sees
      the new lesson on `/lessons`.
- [ ] `/lessons` shows "Klasse / Class: [class name]" for class-bound students.
- [ ] No class banner for unbound / LOCAL_MODE / Firebase teacher paths.
- [ ] All `test_group_id_auth.py` unit tests pass.
- [ ] All `test_group_join_with_class.py` API tests pass.
- [ ] `npm run quality:check:fast` clean.
- [ ] `cd backend && make test-fast` clean.

## Open Questions

None — scope is bounded and implementation is derivable from the existing
`_resolve_class_tags` pattern.

## Related Documents

- [lesson-picker.md](lesson-picker.md) — the `/lessons` page this builds on (1.B)
- [teacher-permission-model.md](teacher-permission-model.md) — Class entity, tag
  namespace, `mint_group_codes_under_class`
- [teacher-ui.md](teacher-ui.md) — teacher dashboard, lesson assignment flow
- [session-persistence.md](session-persistence.md) — `resumedSessionId` in join response (1.F)

---

## Implementation Report

**Completed**: 2026-06-02
**Actual Effort**: [e.g., 5 days vs 3 estimated]
**Branch/PR**: [link or commit range]

### What Was Built
- [Summary of actual implementation]
- [Any deviations from plan]

### Files Changed
- [New files created]
- [Modified files]

### Lessons Learned
- [What went well]
- [What could be improved]
