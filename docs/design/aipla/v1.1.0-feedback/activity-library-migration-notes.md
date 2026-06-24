# ALS-1 M0.2 — activity backfill migration notes

Records every Firestore side effect of the `activity_configs → activities`
backfill, so test/prod cutover is a known recipe (the side-effects discipline).

**Script:** [`backend/scripts/backfill_activities.py`](../../../backend/scripts/backfill_activities.py)
**Status:** code-complete + tested (in-memory). **APPLIED to `aipla-dev-2026` on 2026-06-24**, then **re-run with `--reset` after a dedup + teacher-only fix** (see below). Final dev state: **12 activities across 5 teachers, no per-owner duplicates, `manage-class` excluded.** **test/prod NOT yet run.**

### Dedup + teacher-only fix (2026-06-24, second pass)

The first pass minted bare-lesson activities per `(owner, class, skill)`, so a sim
added to N classes became N copies, and a `role:teacher` skill (`manage-class`)
leaked into the student library. Fixed:
- **Bare lessons dedupe per `(owner, skill)`** (`bare:{owner}:{skill}` key) → ONE
  library activity per sim, assigned to all the owner's classes that ran it.
  (Authored configs stay per `(teacher, class, activity)` — they may have diverged.)
- **Teacher-only skills skipped** (`role:teacher` tag) — never wrapped.
- `--reset` flag hard-deletes prior `act-mig-*` activities + strips them from
  classes' `activityIds`, for a clean re-run: `… --reset --apply`.

Re-run result: reset 17 → 12 (4 configs + 8 deduped bare), 1 teacher-only skipped.

## What the backfill does (additive only — no deletes)

| # | Source | Effect |
|---|---|---|
| 1 | each `activity_configs/{teacher}:{class}:{activity}` | create `activities/{act-mig-…}` (owner=teacher, content copied, `visibility=private`) + append its id to `classes/{class}.activityIds` |
| 2 | each `Class.lessons` skill id with **no** config (bare lesson — a sim / bare concept-dialogue added via old "Add from catalogue") | create a minimal wrapping `activities/{act-mig-…}` (title = skill displayName, `artefactId` if the skill is a known sim) + append to `activityIds` |

**Idempotency:** the migrated id is `act-mig-{sha1(teacher:class:activity)[:16]}` — deterministic, so a re-run re-targets the same doc and skips already-migrated rows. `add_activities` dedupes the class array.

## Firestore side effects (the Terraform-recipe record)

- **Writes:** collection `activities` (new docs only).
- **Updates:** `classes/{id}.activityIds` (array append, deduped).
- **Reads:** `activity_configs`, `classes`.
- **Deletes:** none. `activity_configs` and `Class.lessons` are left intact — the
  dual-read window ([`adk/teacher_focus.py`](../../../backend/adk/teacher_focus.py)
  `resolve_active_config`) needs them until cutover.
- **No new indexes** required (the backfill uses full-collection scans + doc-id gets).

## Dual-read window

`resolve_active_config` resolves an `act-…` id from the new `activities` store
first, and **falls through to the legacy composite `activity_configs` lookup** when
absent. So a mid-session student still carrying a legacy skill-id keeps resolving
through cutover. Retire `Class.lessons` *writes* in M1.3; retire the legacy *reads*
only after the dual-read window closes (post-pilot), never under load.

## Cutover runbook (do NOT skip the dry-run)

```bash
cd backend
# 1. DRY-RUN against the target project — eyeball the counts, no writes.
GOOGLE_CLOUD_PROJECT=aipla-dev-2026 uv run python -m scripts.backfill_activities
# 2. Verify: configs→activities count == number of activity_configs rows;
#    bare-lessons count == lessons with no config; no surprises.
# 3. APPLY.
GOOGLE_CLOUD_PROJECT=aipla-dev-2026 uv run python -m scripts.backfill_activities --apply
```

**Before prod / `curly-goose-50`:** run the dry-run against a data **copy** first
(per the sprint plan). Confirm the cutover window — ideally before the 2026-06-29
holiday freeze. Re-running is safe (idempotent) if interrupted.

## Test coverage

[`backend/tests/api_tests/test_backfill_activities.py`](../../../backend/tests/api_tests/test_backfill_activities.py)
— dry-run writes nothing; config→activity + class assignment; bare-lesson wrap;
idempotency; additive (legacy config + lessons survive).
