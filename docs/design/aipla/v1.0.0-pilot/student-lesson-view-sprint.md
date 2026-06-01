# Sprint Plan: STUDENT-LESSON-VIEW

**Sprint ID**: STUDENT-LESSON-VIEW
**Design Doc**: [student-lesson-view.md](student-lesson-view.md)
**Estimate**: ~0.75d
**Status**: In Progress
**Created**: 2026-06-01

## Milestones

### M1 — Backend: live-resolve skill_ids + class context at join (~0.25d)

Files: `backend/auth/group_id_auth.py`, `backend/auth/group_routes.py`

- [ ] Add `class_name: str | None = None` and `class_id: str | None = None` to `JoinResult` dataclass
- [ ] In `join_group()`: after gate 7, add Firestore lookup of `anon_groups/<group_id>` to get `classId`; if found, load the class and use `tuple(cls.lessons)` as `live_skill_ids` and populate `class_name` / `class_id`
- [ ] Add `class_name: str | None = None` and `class_id: str | None = None` to `JoinGroupResponse` Pydantic model
- [ ] Update `join_group_endpoint` return to pass `class_name=result.class_name, class_id=result.class_id`

Estimated LOC: ~30

### M2 — Backend tests (~0.1d)

File: `backend/tests/unit/test_group_id_auth.py`, `backend/tests/api_tests/test_group_join_with_class.py`

- [ ] `test_join_live_resolves_updated_class_lessons`: mint code under class with lesson A, add lesson B via `add_lessons`, join — assert skill_ids = (A, B)
- [ ] `test_join_returns_class_name_and_id`: class-bound join returns class_name / class_id
- [ ] `test_join_unbound_group_returns_none_class_context`: no classId → class_name is None
- [ ] Extend `test_group_join_with_class.py` API test to assert new fields in HTTP response

Estimated LOC: ~60

### M3 — Frontend: types + provider (~0.15d)

Files:
- `frontend/src/lib/anonymousGroupAuth.ts`
- `frontend/src/contexts/AnonymousGroupAuthProvider.tsx`

- [ ] Add `class_name?: string | null` and `class_id?: string | null` to `PersistedGroupSession`
- [ ] Add `className: string | null` and `classId: string | null` to `AnonymousGroupAuthContextValue`
- [ ] Expose from provider: `className: session?.class_name ?? null`, `classId: session?.class_id ?? null`

Estimated LOC: ~15

### M4 — Frontend: class banner on lessons page (~0.15d)

Files:
- `frontend/src/app/lessons/page.tsx`

- [ ] Add `className?: string | null` to `UniversalLessonsPage` props
- [ ] Render class banner below `<header>` when `className` is non-null
- [ ] Pass `className={groupAuth.className}` from `AnonGroupLessonsPage`

Estimated LOC: ~20

### M5 — Frontend tests (~0.1d)

File: `frontend/src/app/lessons/__tests__/page.test.tsx`

- [ ] Test: class banner renders with `className` set
- [ ] Test: class banner absent when `className` is null/undefined

Estimated LOC: ~25

## Quality Gates

After all milestones:
```bash
cd frontend && npm run quality:check:fast
cd backend && make test-fast
```
