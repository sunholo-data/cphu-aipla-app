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
| 1.E | [workbench-state-debounce.md](workbench-state-debounce.md) — *brief:* [`workbench-state-debounce.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/workbench-state-debounce.md) | P1 | 0.5d | None (overlaps with shipped MCPAPP-SPEC 500ms debounce; this is the delta to 800ms+coalesce architecture) | **Quick fix flagged in 2026-05-25 teacher review.** Move debounce-by-time-window (host) to debounce-at-source (artefact) + coalesce-by-field (host). Wire shape becomes minimal-delta. Centralises in `StaticArtefactFrame` so future artefacts inherit |
| 1.F | [session-persistence.md](session-persistence.md) — *brief:* [`session-persistence.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/session-persistence.md) | P1 | 1.5-2d | None at the data-layer level; soft dep on 1.A for the teacher reset button surface | **Group code = session key.** Same code resumes the same session for 30 days. Chat history + workbench state restored on rejoin. Cross-device coherence. Adds `aipla:restore` artefact contract — required by all current + future artefacts |
| 1.G | [teacher-ui.md](teacher-ui.md) — *brief:* [`teacher-ui-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/teacher-ui-brief.md) | **P0** | 5-6d total **split into 3 phases** | Phase 1: none; Phase 2: none on critical path; Phase 3: 1.A | **Demo target Wed 3 June.** **Phased per 2026-05-25 compression**: Phase 1 = static mockup (~0.5-1d, hardcoded data, no backend, LOCAL_MODE bypass — JB can iterate visually within 48h); Phase 2 = wire to real backend with LOCAL_MODE teacher stub (~2-2.5d, ships Wed 3 June); Phase 3 = swap to Firebase auth + 1.A `Class` entity + analytics chat + CLI parity (~2-2.5d, post-demo). Teacher UI doc has full phase split + acceptance gates per phase |
| 1.G-Ph1 | (sub-row) Static mockup | **P0 ASAP** | ~0.5-1d | None | Cloud-agent-ready. Branches from `dev`. All five `/teacher/*` routes render with hardcoded data. No backend, no Firebase. Acceptance: M+JB visual sign-off |
| 1.G-Ph2 | (sub-row) Wire to real backend, LOCAL_MODE teacher auth | P0 | ~2-2.5d | 1.G-Ph1 complete | Real `ActivityConfig` Firestore writes; real session-summary aggregator; one seeded demo class. **Wed 3 June demo runs against this state** |
| 1.G-Ph3 | (sub-row) Firebase auth + 1.A swap + stretch | P1 | ~2-2.5d | 1.A complete, 1.G-Ph2 complete | Swap LOCAL_MODE teacher stub for Firebase; multi-class; analytics chat skill; opt-in share; CLI parity |
| 1.H | [audio-capture-and-tts.md](audio-capture-and-tts.md) — *brief:* [`audio-capture.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/audio-capture.md) | P2 | 0.5d TTS + 2d audio | TTS none; audio capture gated on **JB sign-off (5 consent / privacy questions)** + 1.A for per-class opt-in | **Split implementation.** TTS (browser-native `speechSynthesis`) ships independently — zero privacy gate, ~0.5d. Audio capture (opt-in group recording for research) blocked on JB consent / institutional approval sign-off — five questions in the brief must be answered before any code merges. Audio embodies SECURE-BY-CONSTRUCTION by structurally refusing to ship without consent decisions |

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

**UX hardening + teacher demo (1.E–1.H, from 2026-05-25 meeting):**
- **Teacher UI (1.G)** — phased per 2026-05-25 evening compression decision. **Phase 1 mockup starts NOW** (cloud agent branched from `dev`, ~0.5-1d hardcoded screens). Phase 2 wires to real backend with LOCAL_MODE teacher auth (~2-2.5d, ships Wed 3 June demo). Phase 3 swaps Firebase auth + 1.A + adds analytics chat + opt-in share + CLI (~2-2.5d, post-demo).
- **Workbench state debounce (1.E)** — slider events don't spam chat or context. Quick win, anytime.
- **Session persistence (1.F)** — same group code resumes the same session for 30 days, cross-device. **Deferred ~1 week** behind teacher UI demo.
- **TTS + audio capture (1.H)** — TTS ships anytime (zero privacy gate); audio capture blocked on JB sign-off.

**Deferred behind the teacher UI compression:**

- 1.C LED Planck (~1 week delay)
- 1.D KineBot (~2 weeks delay)
- 1.F session persistence (~1 week delay)

v1.0.0-pilot still ships by 2026-08-14 with comfortable margin (~12 weeks of work in a 14-week window).

## What does NOT ship in v1.0.0-pilot

See [../SEQUENCE.md](../SEQUENCE.md) Phase 2 / 3 for the post-pilot scope (Strand B student-as-creator, Strand C scoping note, full handover package).

Specifically deferred from this version:
- Per-class budget surfacing UI (enforcer ships in 1.12 separately; the *display* lands later)
- Strand B (student-as-creator) skills
- Multi-school / institutional admin (UCPH-level admin roles above teachers)
- **Teacher control over artefact parameters** (roadmap signal — see [../post-pilot/teacher-artefact-parameters.md](../post-pilot/teacher-artefact-parameters.md)). v1 ships free-text teaching goal only. Parameter-level configurability is a v1.1 candidate, decision after pilot feedback. Surfaced as a wireframe "Parameters" tab on the activity-config screen so JB/AR can react to the affordance.
- **Teacher artefact authoring (code-level editing)** (roadmap signal — see [../post-pilot/teacher-artefact-authoring.md](../post-pilot/teacher-artefact-authoring.md)). v2 / Year-2 explicit scope — outside the contract window. Surfaced as wireframe "Code" + "History" tabs on the activity-config screen so the v1 design doesn't paint us into a corner.
- **Pedagogical rubrics over chat logs** (roadmap signal — see [../post-pilot/session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md)). The Phase 2 report screen shows surface metrics (duration, messages, sim runs). It does **not** yet apply a pedagogical framework — ICAP for engagement quality, FCI taxonomy for misconception tracking, NGSS 3D-LAP for competency rubrics. Gated on 1.2 BigQuery sink + JB/AR framework pick. Recommended initial build: ICAP + FCI two-lens stack.

## Risks

| Risk | Mitigation |
|---|---|
| UCPH SSO integration timing — IT department response cycle could exceed the pre-mid-point window | Default to Firebase federated auth with Google OAuth provider; UCPH SSO becomes a v2 upgrade path. The permission model itself is auth-mechanism-agnostic |
| Tag-namespace collisions between teachers | Mandatory namespace prefix `class:<teacher_uid>:<class_id>` — enforced in the `Class` creation path; impossible to construct a colliding tag |
| Group-code lifecycle confusion when classes are deleted | Soft-delete only; revoked classes flip a flag rather than dropping the Firestore doc. Group JWTs validate against the live flag at every request |

## Next

After v1.0.0-pilot lands, work proceeds against [../SEQUENCE.md](../SEQUENCE.md) Phase 2 (Strand-B + Strand-C scoping work) and Phase 3 (handover).
