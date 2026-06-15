# Sprint: DOCWORK — documents-workbench surface (M1 + M2)

**Design doc:** [documents-workbench-surface.md](documents-workbench-surface.md) (1.1.33)
**Status:** Planned → executing
**Goal:** Make teacher-assigned materials student-visible *at the teacher's discretion*, and give students one Documents surface in the workbench for their uploads + those materials.
**Scope:** M0 (image click-to-expand) SHIPPED `445422d`. This sprint = M2a + M2b + M1.
**Estimate:** ~1–1.5d. Order: **M2a → M2b → M1** (field first, then the read, then the surface that consumes both).

## Guiding principle

Aggregation, not new plumbing. Uploads come from native AG-UI `ImageInputContent` in the session messages (already in `messages[].images`); materials come from the existing `MaterialRef` + active-config resolve. The only new field is `MaterialRef.studentVisible`; the only new endpoint is a student-scoped, visibility-filtered materials read.

---

## M2a — `studentVisible` field + teacher toggle (fullstack, ~0.3d)

**Backend**
- Add `student_visible: bool = Field(default=False, alias="studentVisible")` to `MaterialRef` ([backend/db/models/activity_config.py:34](../../../backend/db/models/activity_config.py#L34)). Flows through `ActivityConfigUpsert` automatically (`extra="forbid"`, `populate_by_name`).
- Test (`backend/tests/api_tests/test_activity_config_routes.py`): a material with `studentVisible: true` round-trips through POST + PATCH; default is `false` when omitted.

**Frontend**
- Add `studentVisible?: boolean` to `MaterialRef` ([frontend/src/lib/teacherApi.ts:71](../../../frontend/src/lib/teacherApi.ts#L71)) and `ActivityConfigUpsert.materials`.
- In `MaterialsSection.tsx`: cite defaults `studentVisible: false` ([line 73](../../../frontend/src/components/teacher/MaterialsSection.tsx#L73)); each cited-material chip gets a "Show to students" toggle that flips `studentVisible` via `onChange`.
- Test (`MaterialsSection.test.tsx`): toggling a chip sets `studentVisible: true` in the emitted `onChange`; new cites default false.

**Acceptance:** teacher marks a cited material student-visible; it round-trips; default off; RAG grounding unchanged (still uses all materials).

## M2b — student-scoped, visibility-filtered materials read (backend + thin FE, ~0.4d)

**Backend**
- New `GET /api/activity-configs/active/{activity_id}/materials` in `activity_config_routes.py`: `resolve_active_config(activity_id, group_tags=user.group_tags)` (deny-by-default ACL, same as the existing `/active/{activity_id}`), return its `materials` **filtered to `student_visible is True`**, each resolved to display metadata `{docId, origin, title?, level?}`. Do **not** filter inside `resolve_active_config` (the agent's RAG grounding needs all materials).
- Test: returns only `studentVisible` materials; a hidden material is excluded; an activity the caller's group can't access → denied.

**Frontend**
- `fetchActivityMaterials(activityId)` client in a student-facing lib (e.g. `frontend/src/lib/studentApi.ts` or reuse the chat api lib) → `/api/proxy/...`, `fetchWithAuth`.

**Acceptance:** endpoint returns only teacher-marked-visible materials for the caller's activity; hidden excluded; ACL respected.

## M1 — Documents surface in the workbench (frontend, ~0.5d)

**Frontend**
- `DocumentsPanel` (new, `frontend/src/components/workspace/`): shows (a) **Uploads** — aggregate `messages.flatMap(m => m.images ?? [])`, each a `ZoomableImage` thumbnail (shipped M0); (b) **Assigned materials** — the M2b list (title/source), click → parsed text (M3 later; for now link/label). Honest empty state when both are empty.
- Wire into the workbench: extend `workspaceContentKind` so the Documents surface appears when there are uploads OR visible materials (it must coexist with `sim`/`checklist`, so this is an *additional* surface/section, not a 4th mutually-exclusive kind — confirm the `WorkspaceShell` composition and add a section/tab accordingly). Pass `messages` (already in `page.tsx` scope, line 357) + the resolved `activityId` into it.
- Test: gallery renders N thumbnails from messages; materials list renders from a mocked fetch; empty state with neither.

**Acceptance:** in a group session, the workbench shows a Documents area with the student's uploads (full-size on click) and any teacher-marked-visible materials.

---

## Quality gates

- After M2a / M2b (backend touched): `cd backend && make lint && make test-fast`.
- After M2a / M1 (frontend touched): `cd frontend && npm run quality:check` (CI parity — tests + build).
- Commit per milestone to `dev` (AIPLA workflow); no PRs.

## Risks / unknowns

- **Workbench tab vs section (M1):** the workbench is a composed column today, not tabbed. "A new tab" may land as a collapsible Documents section first; a true tab bar is a larger refactor (note in the doc, don't over-build).
- **Materials display metadata (M2b):** `MaterialRef` caches `origin` but not `title`/`level`; resolving richer metadata may need a curriculum-doc lookup. Start with `origin` (already cached); enrich only if cheap.
- **No re-seed / deploy gotchas:** pure code (model field + endpoint + FE); no SKILL.md change → no seed needed.
