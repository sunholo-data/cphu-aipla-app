# Sprint Plan: RSCH-EDIT-1 — a researcher can fix a teacher's class, and the page says so (1.1.123 M0–M3)

## Summary

JB asked whether he can edit a teacher's class or make their first activity. The
backend has said "yes" for activities since June with no UI on it, "no" for
classes, and "yes" for set-tutor only. This sprint makes one answer true
everywhere: **a researcher may edit any class or activity (not delete a class),
every page says whose resource it is, and every such edit is attributed.**

**Status:** ✅ **SHIPPED dev 2026-09-21** — all four milestones, ~1d actual (backend `221a41e3`, frontend `e5191518`). Left for the browser check after deploy: JB on prod after the next promote.
**Duration:** ~1.5d (actual ~1d) · **Scope:** Fullstack · **Design doc:** [1.1.123](researcher-acts-for-teacher.md)
**Follows:** [RSCH-ONBOARD-1](teacher-onboarding-scaffold.md) (1.1.124) then [TEACHER-IA-1](teacher-surface-consolidation.md) (1.1.125) — both depend on M2 here.

## Velocity

Last 14 days on `dev`: ~30 commits, three fullstack features of this size shipped
in a day each (1.1.118 notation strip 1d actual vs 1d est; 1.1.122 upload routing;
1.1.120/121 fixes). Estimates below carry no buffer beyond the design doc's — the
work is small and the code paths are already mapped.

## The one sequencing decision

The design doc's M0 had an interim step — *disable* owner-only controls until M2
lands. M0 and M2 ship in the same sprint, so the interim is skipped: M2 goes first
on the backend, then M0's banner lands on pages whose controls already work.

## Milestones

### M2 — Class writes admit a researcher · backend · ~0.4d · ~120 LOC + ~150 test
- [ ] `classes_routes.py`: add `_load_editable(class_id, user)` — owner OR researcher, span-tagged `auth.researcher_bypass` (the write twin of `_load_readable`). Switch `PATCH /{id}`, `PATCH /{id}/lessons`, `PATCH /{id}/activities`, `POST /{id}/groups`, `DELETE /{id}/groups/{code}`, `POST …/reset-session` to it. **`DELETE /{id}` stays `_load_owned`** — the existing `test_researcher_cannot_delete_other_teachers_class` keeps passing unchanged.
- [ ] `PATCH /{id}/activities` add-path: today it checks `activity.owner_uid == user.uid`. For a researcher acting on a teacher's class, the activity must belong to the **class owner** (or be one of the researcher's own — adopt-into semantics are out of scope; reject with 404 as today).
- [ ] `activity_routes.py` `POST /api/activities` with `classId`: class check via the same editable rule; **the created activity's `owner_uid` is the class owner's**, not the caller's. Log line names both.
- [ ] Tests (`test_classes_route.py`, `test_activity_routes.py`), each with the real dispatcher fixtures already there: researcher can rename / mint / add-activity / reset on another teacher's class; plain teacher 404s on each; activity created inside another teacher's class lists under that teacher's `owner=me` and not under the researcher's; `DELETE` still 404s.

**Acceptance:** every write on `/api/classes/{id}/*` except delete returns 200 for a researcher on another teacher's class and 404 for a non-owner teacher.

### M3 — Attribution · fullstack · ~0.35d · ~100 LOC + ~60 test
- [ ] `Class` and `Activity` gain `last_edited_by: LastEdit | None` (`{uid, at}`, alias `lastEditedBy`). Stamped by the write routes **whenever `user.uid != owner_uid`** — the passive line the design recommends (option 1); the notice (option 2) stays open for JB.
- [ ] Class GET and activity GET enrich with `lastEditedByLabel` via `resolve_owner_labels` (already best-effort).
- [ ] Class page "Class settings" card and the activity History panel render *"Last edited by {label}, {relative time}"* when present.
- [ ] Tests: a researcher PATCH stamps; an owner PATCH does not; label resolves.

### M0 — Ownership-aware pages · frontend · ~0.5d · ~150 LOC + ~60 test
- [ ] `components/teacher/ActingForOwnerBanner.tsx` — `copy` object per 1.1.108 M4; props `{ownerLabel, kind: "class" | "activity"}`; renders nothing when the viewer is the owner. Viewer uid from `useTeacherAuth().user?.uid`.
- [ ] Mount on `/teacher/classes/[id]` and `/teacher/activities/[id]`.
- [ ] `/teacher/classes` All scope: activity titles become editor links again (delete the stale "isn't editable" comment).
- [ ] Research list + detail: drop the *read-only* claims. `r1-researcher-onboarding.md`: replace *"you do not edit their work"* with what is true and how it is attributed.
- [ ] Test: banner renders for a non-owner and not for the owner (component test with a mocked `useTeacherAuth`).

### M1 — Wire the M3b writes that already exist · frontend · ~0.25d · ~60 LOC
- [ ] Research detail page actions: **Open in editor** → `/teacher/activities/[id]`; the Private ↔ Shared toggle the library already renders (`VisibilityToggle` from `activities/page.tsx`, lifted to `activityDisplay.tsx` if it is not already shared).
- [ ] Test: the detail renders both actions for a researcher.

## Day plan

| Half-day | Work |
|---|---|
| 1 | M2 backend + tests · M3 backend + tests · `make lint && make test-fast` |
| 2 | M3 frontend · M0 banner + list links + copy removals · M1 actions · `npm run quality:check` |
| tail | guide r1 wording, commit, dev deploy check in the browser as a researcher |

## Acceptance for the sprint

- JB, on prod after promote, can open any teacher's class in All scope, rename
  it, add an activity, mint a code, and the page tells him whose it is and who
  last touched it.
- No change of any kind for a teacher on their own class.
- Guards: `make check-auth-dispatcher`, existing `test_dual_auth_rejection` and
  `test_class_tutor_reaches_the_student` unchanged and green.

## Out of scope (deliberately)

Class delete by a researcher · a notice to the teacher (open question, JB) ·
copilots acting cross-owner (works for free after M2; test in RSCH-ONBOARD-1) ·
the stage column and checklist (next sprint).
