# Sprint Plan: ALS-SHARE — cross-teacher activity sharing (M2 + M3 + M3b + light History)

## Summary
The remaining **share** half of [activity-library-sharing.md](activity-library-sharing.md):
take the class-independent `Activity` (shipped in ALS-1 M0+M1) and add **duplicate /
branch** (M2), **publish + a cross-teacher shared catalogue + adopt-by-copy** (M3),
**researcher CRUD-over-all** moderation (M3b), and a small **provenance/lifecycle
History panel** that rides on the fields M3 introduces. After this sprint a teacher can
publish an activity, another teacher can browse the shared catalogue and adopt a copy
into their own library, and a researcher can moderate any activity.

**Duration:** ~4–5 working days (M2 ≈ 1d · M3 ≈ 2–3d · M3b ≈ 0.5d · History ≈ 0.5d)
**Scope:** Fullstack — backend endpoints (duplicate / publish / unpublish / catalogue /
adopt / researcher-bypass) + the activities-library "Shared activities" UI + a real
History tab.
**Design doc:** [activity-library-sharing.md](activity-library-sharing.md) (1.1.43) — the
**sharing-scope decision is RESOLVED** (2026-06-24): open trusted-set sharing,
copy-on-adopt, no pre-publish gate, researcher = post-hoc moderation.
**Status:** Planned — awaiting review.

## What's already shipped (build on, do NOT rebuild)
- **M0** — class-independent `Activity` (`act-…` ids), student resolution by activity id.
- **M1** — `PATCH /classes/{id}/activities` many-class assignment, the **Your activities**
  library page (composition cards, chip-toggle assign, Edit/Delete), the re-pointed
  class-detail picker.
- **Researcher `scope=all`** read view (classes + activities), `resolve_owner_labels`
  (owner uid → name via `firebaseauth.viewer`), `_assert_teacher`.
- The **`Activity` model already carries** `visibility: draft|private|published`,
  `source_activity_id` / `source_owner_uid`, `created_at` / `updated_at`. `PATCH` already
  round-trips `visibility` and preserves provenance/identity.

So the share sprint is **endpoints + UI on top of an already-shaped model** — not a data
migration. The only model touch is the validators/guards for the new transitions.

## Current endpoint surface (the delta to fill)
| Endpoint | Today | This sprint |
|---|---|---|
| `GET /api/activities?owner=me` | ✅ own library | — |
| `GET /api/activities?scope=all` | ✅ researcher-only | — |
| `GET /api/activities?published=true` | ❌ 400s | **M3.2** — cross-teacher catalogue |
| `POST /api/activities/{id}/duplicate` | ❌ | **M2.1** |
| `POST /api/activities/{id}/adopt` | ❌ | **M3.3** (copy a *published* one) |
| `POST /api/activities/{id}/publish` · `/unpublish` | ❌ | **M3.1** |
| `PATCH` / `DELETE /api/activities/{id}` | ✅ owner-only | **M3b** — + researcher bypass |

## Milestones

### M2 — Duplicate / branch ("edit on top of an existing one")  · ~1d · backend + frontend
**M2.1 — `POST /api/activities/{id}/duplicate` (backend).** Copy the source into the
caller's library: mint a fresh `act-…`, `owner_uid = caller`, `source_activity_id` +
`source_owner_uid` set, `visibility = draft`, content (skill/artefact/elements/materials)
deep-copied, `activity_ids` assignment NOT carried (a fresh copy is unassigned). Source
must be **the caller's own OR `published`** (else 404 — don't leak existence). Reuses
`create_activity` + the existing `_serialize`. (~80 LOC + tests)
**M2.2 — Duplicate affordance (frontend).** A **Duplicate** action on each *own* activity
card (`teacherApi.duplicateActivity(id)`) → refresh the list; and a **New → from an
existing one** entry point. (~50 LOC + tests)
**Acceptance:** duplicating an own activity yields a new `draft` with `source_*` set,
unassigned, independently editable; duplicating a non-owned non-published id → 404.

### M3 — Publish + shared catalogue + adopt  · ~2–3d · backend + frontend
**M3.1 — Publish / unpublish (backend).** `POST /api/activities/{id}/publish` (→
`published`) and `/unpublish` (→ `private`). Owner **or researcher** (M3b shares the
guard). Validate the transition set (`draft→private`, `draft→published`, `private↔
published`); unpublish never touches already-adopted copies. (~60 LOC + tests)
**M3.2 — Shared catalogue endpoint (backend).** `GET /api/activities?published=true` →
every teacher's `published` activities, **enriched with `ownerLabel`** (reuse
`resolve_owner_labels`) so the UI can group by owner. Distinct from researcher
`scope=all` (this is open to any teacher, published-only, read-only). (~50 LOC + tests)
**M3.3 — Adopt-by-copy (backend).** `POST /api/activities/{id}/adopt` — copy a
**published** activity into the caller's library (same copy semantics as duplicate;
`source_*` provenance, `visibility = draft`). Rejects adopting a non-published activity
you don't own (404). May share the copy helper with M2.1. (~40 LOC + tests)
**M3.4 — Shared activities UI + publish toggle (frontend).** On the activities library:
a **Shared activities** section (grouped by owner teacher, attribution shown) with a
**Use / adapt** action → adopt-copy → lands in *Your activities* as a `draft`; a
**Publish / Unpublish** control + a visibility badge on own cards. Reuses the existing
My/All toggle scaffolding + composition cards. Teacher-auth throughout
(`fetchWithTeacherAuth`). (~180 LOC + tests)
**Acceptance:** publish makes an activity appear in another teacher's shared catalogue
grouped under your name; Use/adapt copies it into their library as a `draft` with
provenance; unpublish removes it from the catalogue but leaves existing copies intact;
a teacher cannot edit or assign another teacher's activity directly.

### M3b — Researcher CRUD-over-all (moderation)  · ~0.5d · backend
Extend the shipped researcher **read**-bypass to **write/delete** on the `activities`
collection only: a `role:researcher` may `PATCH` / `DELETE` / `publish` / `unpublish`
**any** teacher's activity. Guard on `User.is_researcher`, OTel-span
`auth.researcher_bypass` (mirror the class read-bypass). Scoped to activities — not a
general write-bypass. (~50 LOC + tests)
**Acceptance:** a researcher can unpublish/edit/delete another teacher's activity (200);
a non-researcher non-owner still gets 404 on the same.

### M-HIST — Light History panel (provenance + lifecycle)  · ~0.5d · frontend (+ tiny backend)
Replace the History tab roadmap stub with a **read-only** panel: "Adapted from
{sourceOwnerLabel}'s activity" (when `source_*` set), current visibility, and
created / updated timestamps. Backend: ensure the activity GET payload carries
`sourceOwnerLabel` (resolve the source owner uid) + the timestamps (mostly present).
NOT the version-timeline+rollback (that stays Year-2 teacher-artefact-authoring v2).
(~70 LOC + tests)
**Acceptance:** opening an adopted activity's History shows its provenance + lifecycle;
a from-scratch activity shows created/updated + visibility, no provenance line.

### M4 — *(optional, deferred)* Attribution display + "most-adopted" research signal
Out of this sprint unless time allows post-M3b.

## Day plan (front-load before the week-27 freeze, 2026-06-29 → 07-05)
1. **Day 1** — M2.1 + M2.2 (duplicate, full-stack) → ship. Start M3.1 (publish/unpublish).
2. **Day 2** — M3.1 + M3.2 (publish + catalogue endpoint) → ship backend. M3.3 (adopt).
3. **Day 3** — M3.4 (Shared activities UI + publish toggle) → ship the cross-teacher flow.
4. **Day 4** — M3b (researcher CRUD) + M-HIST (History panel) → ship.
5. **Buffer / M4** — attribution + most-adopted if time; else defer.
Backend milestones (M2.1, M3.1–3.3, M3b) are the freeze-critical path; the UI (M2.2,
M3.4, History) can land either side.

## Quality gates
```bash
cd backend && make lint && make test-fast      # ruff + pytest (CI parity)
cd frontend && npm run quality:check           # lint + typecheck + vitest + build
```
Browser-verify the cross-teacher flow per `aitana-frontend-verify`: teacher A publishes →
teacher B sees it in Shared activities under A's name → Use/adapt → appears in B's library
as a draft → B edits + assigns → A unpublishing doesn't change B's copy.

## Success metrics
- [ ] Duplicate / publish / unpublish / catalogue / adopt endpoints + CLI parity, tested.
- [ ] Shared activities section (grouped by owner) + Use/adapt + publish toggle.
- [ ] Researcher can moderate (edit/unpublish/delete) any activity; non-researcher cannot.
- [ ] History tab shows provenance + lifecycle (read-only).
- [ ] Owner-only edit/assign invariant holds; adopt is the only cross-teacher path (copy).
- [ ] Backend + frontend CI green; no migration (model already shaped).

## Risks
- **Copy fidelity** — duplicate/adopt must deep-copy content (elements/materials/artefact)
  without carrying assignment or identity. Mitigation: one shared `_copy_activity` helper,
  unit-tested for field-by-field provenance + reset.
- **Researcher write-bypass blast radius** — it's the one departure from owner-only.
  Mitigation: scope strictly to the `activities` collection, guard + span exactly like the
  read path, test the non-researcher-still-404 case.
- **Catalogue auth confusion** — `?published=true` (any teacher) vs `?scope=all`
  (researcher-only) are different gates. Mitigation: explicit per-mode tests; never a
  silent fallback.
