# v1.0.0-pilot Build Sequence

**Anchor date:** 2026-08-14 (Fri) — Danish teacher pilot starts (10 teachers + K).
**Mid-point review:** 2026-06-26 (Fri, week 6) — before the M+JB holiday freeze 2026-06-29 → 07-05.
**Phase 1 work window:** 2026-05-28 (post-Jutland) → 2026-08-14.

This is the per-version sequence file for v1.0.0-pilot. The top-level
roadmap lives at [../SEQUENCE.md](../SEQUENCE.md) — that file is the
canonical phase ordering across versions; this file is the detail layer
for v1.

## Ordering

| Order | Doc | Priority | Estimate | Dependencies | Notes |
|---|---|---|---|---|---|
| 1.A | [teacher-permission-model.md](teacher-permission-model.md) | P1 | 3-5d | v0.1 shipped; AccessControl 5-type model (already in tree) | Foundation for the whole teacher-facing surface. Combines the originally-planned 1.6 (`teacher-auth-ucph-sso`) + 1.7 (`class-and-group-management`) into one coherent permission story — they were always going to land together. Tag-based access via the existing `AccessControl.type: "tagged"` primitive; new `Class` entity owns a tag namespace; teacher Firebase auth path extends `AnonymousGroupAuthProvider` |

## Timeline estimate

| Phase | Date | Status |
|---|---|---|
| Design doc landed | 2026-05-24 (Sat) | ✅ |
| Sprint plan landed | TBD (post-Jutland) | Pending |
| Implementation | post-Jutland (2026-05-28 → 2026-06-26 ideally) | Pending |
| Mid-point review check | 2026-06-26 (Fri) | Gate |
| Holiday freeze | 2026-06-29 → 07-05 | — |
| Teacher pilot ready | 2026-08-14 (Fri) | Target |

## What ships in v1.0.0-pilot

- **Teacher Firebase auth** (sign in to a `/teacher` route, not just join via group code)
- **`Class` entity** in Firestore — teacher-owned, defines the tag namespace for that class
- **Group → Class binding** — student group codes are minted under a Class and inherit its tags via JWT
- **Tag-based skill access** — teachers pick which skills (lessons) a class can use; access enforced by the existing 5-type `AccessControl` model
- **`manage-class` skill** (teacher-facing) — A2UI form to create classes, mint group codes, pick lessons
- **Lesson UX label** — `Skill` stays the technical term; "Lesson" is the surface label when teachers / students see it

## What does NOT ship in v1.0.0-pilot

See [../SEQUENCE.md](../SEQUENCE.md) Phase 2 / 3 for the post-pilot scope (Strand B student-as-creator, Strand C scoping note, full handover package).

Specifically deferred from this version:
- Per-class budget surfacing UI (enforcer ships in 1.12 separately; the *display* lands later)
- Strand B (student-as-creator) skills
- Multi-school / institutional admin (UCPH-level admin roles above teachers)

## Risks

| Risk | Mitigation |
|---|---|
| UCPH SSO integration timing — IT department response cycle could exceed the pre-mid-point window | Default to Firebase federated auth with Google OAuth provider; UCPH SSO becomes a v2 upgrade path. The permission model itself is auth-mechanism-agnostic |
| Tag-namespace collisions between teachers | Mandatory namespace prefix `class:<teacher_uid>:<class_id>` — enforced in the `Class` creation path; impossible to construct a colliding tag |
| Group-code lifecycle confusion when classes are deleted | Soft-delete only; revoked classes flip a flag rather than dropping the Firestore doc. Group JWTs validate against the live flag at every request |

## Next

After v1.0.0-pilot lands, work proceeds against [../SEQUENCE.md](../SEQUENCE.md) Phase 2 (Strand-B + Strand-C scoping work) and Phase 3 (handover).
