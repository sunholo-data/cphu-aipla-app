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
| 1.B | [lesson-picker.md](lesson-picker.md) | P1 | 0.5d | None (FE-only; uses existing `GET /api/skills` filter) | Replace v0.1's hardcoded `POST_JOIN_REDIRECT` with a `/lessons` route that lists all skills the student can access. Validates the multi-lesson UX shape before classes ship; works trivially with classes when 1.A lands. **Prerequisite for 1.C + 1.D being visible to students.** Tiny scope; doc + impl in one sprint |
| 1.C | [led-planck-skill.md](led-planck-skill.md) — *pedagogical source-of-truth:* [`led-planck-skill-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/led-planck-skill-brief.md) in scoping site | P1 | 1.5-2d | 1.B (lesson picker so students can find it), ADR-013 pipeline | **Second physics skill.** Self-contained Danish stx artefact (1855 LOC, zero external fetches). Procedural-virtual-lab class — different form factor from Boldkast's phenomenon-sim. The in-repo design doc covers the **technical execution** (file paths in this repo, axiom scoring, ADR-013 compliance check, test plans, CLI surface). The scoping-site brief covers the **pedagogy** (Danish Socratic tutor prompt, three teaching phases, accuracy notes vs H_TRUE) |
| 1.D | [kinebot-migration.md](kinebot-migration.md) — *pedagogical source-of-truth + migration brief:* [`kinebot-migration-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/kinebot-migration-brief.md) in scoping site | P1 | 2-3d | 1.C complete (LED Planck establishes second-artefact-through-pipeline pattern), ADR-013 pipeline | **Third physics skill — and canonical AIPLA migration runbook.** External AI artefact (1707 LOC) built by DK with direct Anthropic API calls + student-supplied API key UI; AIPLA must strip those and route through the backend. NCERT/CBSE Class 11 (English, kinematics). Beta cohort = DK's Indian students (~100s available). The **in-repo design doc adds the technical-execution layer** + commits to landing the migration as a documented runbook section in the `.claude/skills/mcp-app-artefact/` skill so future external-artefact onboarding follows the same checklist |

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

**Permission + auth (1.A):**
- **Teacher Firebase auth** (sign in to a `/teacher` route, not just join via group code)
- **`Class` entity** in Firestore — teacher-owned, defines the tag namespace for that class
- **Group → Class binding** — student group codes are minted under a Class and inherit its tags via JWT
- **Tag-based skill access** — teachers pick which skills (lessons) a class can use; access enforced by the existing 5-type `AccessControl` model
- **`manage-class` skill** (teacher-facing) — A2UI form to create classes, mint group codes, pick lessons
- **Lesson UX label** — `Skill` stays the technical term; "Lesson" is the surface label when teachers / students see it

**Lesson surface (1.B):**
- **`/lessons` route** — replaces v0.1's hardcoded `POST_JOIN_REDIRECT`; lists all skills the student can access, cards link to `/chat/<skill>`

**Physics skill library (1.C, 1.D):**
- **LED Planck virtual lab** — Danish stx physics-A, procedural-lab artefact class, paired with a Danish Socratic tutor (full prompt in the brief)
- **KineBot kinematics tutor** — English NCERT/CBSE Class 11, migration of DK's existing AI artefact onto AIPLA-compliant rails. Also establishes the runbook for any future external-artefact onboarding

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
