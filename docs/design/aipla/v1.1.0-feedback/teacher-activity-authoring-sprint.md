# Sprint plan — TEACHER-ACTIVITY-AUTHORING (M0 + M1)

**Sprint ID:** `TAA-1`
**Design doc:** [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19)
**Scope:** Milestones **M0 + M1 only** — defer M2 quiz / M3 branching / M4 workbench-types / M5 observability to later sprints
**Target:** ~2.5 engineering days; **fully shippable before the 2026-06-29 freeze**
**Created:** 2026-06-08
**Workflow:** TDD (pytest + vitest); CI-parity gates each milestone; **no PRs — ff-merge to `dev`**

## Goal

A teacher creates a **no-workbench Socratic concept activity** from scratch and a student has a real session against it — plus a **teacher-authored progress checklist** generalised from the shipped Boldkast one. This is the standalone, independently-valuable foundation of 1.1.19; everything richer (quiz, branching, drawing/notebook) builds on it later.

## Velocity basis

Recent sprints (SIM-ERGONOMICS M1–M10, PROACTIVE-SIM-REACTIVE M1–M10) each landed same-day. ~2.5d for two milestones of this size is realistic-to-conservative. Buffer is held in the M0.5 / M1.2 integration tasks (the riskiest seams).

## Reality reconciliation (vs the design doc's API sketch)

The design doc sketched `POST /api/activities`. **Reality:** the surface already exists as `backend/protocols/activity_config_routes.py` → `/api/activity-configs` (composite-key `{teacher_uid}:{class_id}:{activity_id}` upsert; POST=201, PATCH, DELETE; body `ActivityConfigUpsert` has `extra="forbid"`; owner-only via `_assert_owns`). **Decision:** M0 **extends the existing `/api/activity-configs` upsert** (add fields to the body + `upsert_activity_config` helper) and adds **activity-id minting** for teacher-created activities, rather than introducing a parallel `/api/activities` route. Day-1 task M0.0 updates the design doc's API section to match. (Q1 in the doc — "promote `ActivityConfig`" — is hereby answered **(A)** for v1.1.)

## Milestone breakdown

### M0 — No-workbench concept activity, end-to-end · `fullstack` · ~1.5d

| Task | Scope | Files | Est (impl+test) |
|---|---|---|---|
| **M0.0** Reconcile API in design doc; confirm `(A)` model promotion | docs | teacher-activity-authoring.md | 10 LOC |
| **M0.1** (test-first) Extend `ActivityConfig`: `workbench_type: Literal[...]="none"`, `source_activity_id: str\|None`. Legacy back-compat + `paired_workbench`-set → `app` backfill rule | backend | `backend/db/models/activity_config.py`; `tests/unit/test_activity_config*.py` | 30 + 50 |
| **M0.2** (test-first) Extend `ActivityConfigUpsert` body + `upsert_activity_config` helper + route to accept `workbench_type`; **mint `activity_id`** when teacher creates (POST without id → mint slug). Owner-only auth already present | backend | `backend/protocols/activity_config_routes.py`, `backend/db/activity_configs.py`; `tests/api_tests/` | 70 + 90 |
| **M0.3** (test-first) CLI `aiplatform activity new --type none [--class]` + `activity list` | cli | new `cli/aiplatform/commands/activity.py` (model on `class_.py`); register in CLI root; `cli` unit test | 90 + 40 |
| **M0.4** (test-first) Teacher builder: form (name / language / difficulty / lesson-prompt) + workbench-type select defaulting `none` + **first-run concept-dialogue default**; save → POST. **Designed empty/loading/error states** (Axiom 11) | frontend | `frontend/src/app/teacher/activities/new/page.tsx`, extend `…/[id]/page.tsx`; `__tests__/` | 150 + 90 |
| **M0.5** (test-first) Student renders chat-only when `workbench_type=none` (no workbench pane; lesson prompt drives tutor); activity→skill resolution wired | frontend | `frontend/src/app/chat/[...path]/page.tsx`, `useSkillMeta.ts`; `__tests__/` | 50 + 60 |

**M0 acceptance gate (manual, LOCAL_MODE):** teacher creates a no-workbench activity in **< 5 min**, mints a group code, an anonymous student joins and has a Socratic chat. Plus: `cd backend && make lint && make test-fast` green; `cd frontend && npm run quality:check` green.

### M1 — Teacher-authored progress checklist · `fullstack` · ~1d

| Task | Scope | Files | Est (impl+test) |
|---|---|---|---|
| **M1.1** (test-first) Add `checklist: list[ChecklistItem]` to `ActivityConfig` + upsert body/helper | backend | `backend/db/models/activity_config.py`, routes; `tests/` | 30 + 40 |
| **M1.2** (test-first) Generalise checklist sourcing: replace hardcoded `BOLDKAST_SUBPARTS` (`chat/[...path]/page.tsx:1089`) with items from activity config via `useSkillMeta`; **seed Boldkast config with the same a/b/c/d so the regression stays green**; builder checklist editor (add/remove rows) | frontend | `frontend/src/app/chat/[...path]/page.tsx`, `BoldkastWorkbench.tsx`, `useSkillMeta.ts`, builder; `__tests__/` | 120 + 100 |

**M1 acceptance gate:** teacher authors checklist items → student sees them; **Boldkast hardcoded path stays green** (regression vitest); both CI-parity gates green; ff-merge to `dev`.

## Day-by-day

**Day 1 — M0 backend + CLI (M0.0–M0.3).** Land the data model, the extended upsert + activity-id minting, and the CLI. End-of-day gate: `make lint && make test-fast`. **Pause point 1** — review the API/model shape before building UI on it.

**Day 2 — M0 frontend + acceptance (M0.4–M0.5).** Teacher builder + student chat-only render, with designed empty/loading/error states. Gate: `npm run quality:check`. Run the **M0 manual acceptance** (create→join→chat). **Pause point 2** — demo the end-to-end no-workbench activity.

**Day 2.5–3 — M1 checklist (M1.1–M1.2).** Backend field + generalise `ProgressChecklist` sourcing + builder editor, Boldkast regression green. Both gates. **M1 acceptance**, then **ff-merge to `dev`**. **Pause point 3** — sprint review.

## Success metrics

- Backend test count up by ~12–16 (model + routes + CLI); frontend up by ~14–18 (builder + checklist + regression).
- Both CI-parity gates green at each milestone (not the fast variants — full `quality:check` + `make lint && make test-fast`).
- Every new student-facing surface has an explicit empty / loading / error state (Axiom 11 hard-fail guard).
- No new external protocol introduced (Axiom 6); grading/logic stays backend (Axiom 10).
- M0 manual acceptance recorded; Boldkast checklist regression test added and green.

## Risks / guards

- **Activity-id minting collision** with platform-seeded skill ids — mint under a `teacher:` slug namespace; assert no clash in M0.2 tests.
- **`extra="forbid"` on the upsert body** — every new field must be added to `ActivityConfigUpsert` or requests 422; covered by M0.2 / M1.1 tests.
- **Boldkast regression** is the M1 tripwire — seed its config from the existing constant and keep `BoldkastWorkbench.test.tsx` green.
- **Scope creep into M2 (quiz)** — explicitly out; if a quiz field is tempting, stop and note it for sprint 2.

## Out of scope (later sprints)

M2 quiz (declarative MCQ) · M3 branching + materials · M4 drawing/notebook workbench types · M5 observability/engagement wiring. All gated or larger; M2/M4 need JB/AR input.
