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
| 1.A | [teacher-permission-model.md](implemented/teacher-permission-model.md) | P1 | 3-5d | v0.1 shipped; AccessControl 5-type model (already in tree) | Foundation for the whole teacher-facing surface. Combines the originally-planned 1.6 (`teacher-auth-ucph-sso`) + 1.7 (`class-and-group-management`) into one coherent permission story — they were always going to land together. Tag-based access via the existing `AccessControl.type: "tagged"` primitive; new `Class` entity owns a tag namespace; teacher Firebase auth path extends `AnonymousGroupAuthProvider` |
| 1.B | [lesson-picker.md](implemented/lesson-picker.md) | P1 | 0.5d | None (FE-only; uses existing `GET /api/skills` filter) | Replace v0.1's hardcoded `POST_JOIN_REDIRECT` with a `/lessons` route that lists all skills the student can access. Validates the multi-lesson UX shape before classes ship; works trivially with classes when 1.A lands. **Prerequisite for 1.C + 1.D being visible to students.** Tiny scope; doc + impl in one sprint |
| 1.C | [led-planck-skill.md](implemented/led-planck-skill.md) — *pedagogical source-of-truth:* [`led-planck-skill-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/led-planck-skill-brief.md) in scoping site | P1 | 1.5-2d | 1.B (lesson picker so students can find it), ADR-013 pipeline | **Second physics skill.** Self-contained Danish stx artefact (1855 LOC, zero external fetches). Procedural-virtual-lab class — different form factor from Boldkast's phenomenon-sim. The in-repo design doc covers the **technical execution** (file paths in this repo, axiom scoring, ADR-013 compliance check, test plans, CLI surface). The scoping-site brief covers the **pedagogy** (Danish Socratic tutor prompt, three teaching phases, accuracy notes vs H_TRUE) |
| 1.D | [kinebot-migration.md](implemented/kinebot-migration.md) — *pedagogical source-of-truth + migration brief:* [`kinebot-migration-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/kinebot-migration-brief.md) in scoping site | P1 | 2-3d | 1.C complete (LED Planck establishes second-artefact-through-pipeline pattern), ADR-013 pipeline | **Third physics skill — and canonical AIPLA migration runbook.** External AI artefact (1707 LOC) built by DK with direct Anthropic API calls + student-supplied API key UI; AIPLA must strip those and route through the backend. NCERT/CBSE Class 11 (English, kinematics). Beta cohort = DK's Indian students (~100s available). The **in-repo design doc adds the technical-execution layer** + commits to landing the migration as a documented runbook section in the `.claude/skills/mcp-app-artefact/` skill so future external-artefact onboarding follows the same checklist |
| 1.E | [workbench-state-debounce.md](implemented/workbench-state-debounce.md) — *brief:* [`workbench-state-debounce.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/workbench-state-debounce.md) | P1 | 0.5d | None (overlaps with shipped MCPAPP-SPEC 500ms debounce; this is the delta to 800ms+coalesce architecture) | **Quick fix flagged in 2026-05-25 teacher review.** Move debounce-by-time-window (host) to debounce-at-source (artefact) + coalesce-by-field (host). Wire shape becomes minimal-delta. Centralises in `StaticArtefactFrame` so future artefacts inherit |
| 1.E-Ph2 | [workbench-state-debounce.md](implemented/workbench-state-debounce.md) §Phase 2 commit-on-submit | P1 | ~0.55d | 1.E Phase 1 shipped (debounce architecture in place) | **AR 2026-05-26 feedback:** *"only record when the student presses Afspil."* Phase 1 still emits every settled value while a student explores. Phase 2 holds slider changes locally and only flushes on commit signals (Play button OR chat-submit). Parallel-able with 1.A follow-ups + 1.G-Ph3 — touches MCP App artefact + host frame, zero overlap with teacher-permission surface |
| 1.F | [session-persistence.md](implemented/session-persistence.md) — *brief:* [`session-persistence.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/session-persistence.md) | P1 | 1.5-2d | None at the data-layer level; soft dep on 1.A for the teacher reset button surface | **Group code = session key.** Same code resumes the same session for 30 days. Chat history + workbench state restored on rejoin. Cross-device coherence. Adds `aipla:restore` artefact contract — required by all current + future artefacts |
| 1.G | [teacher-ui.md](implemented/teacher-ui.md) — *brief:* [`teacher-ui-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/teacher-ui-brief.md) | **P0** | 5-6d total **split into 3 phases** | Phase 1: none; Phase 2: none on critical path; Phase 3: 1.A | **Demo target Wed 3 June.** **Phased per 2026-05-25 compression**: Phase 1 = static mockup (~0.5-1d, hardcoded data, no backend, LOCAL_MODE bypass — JB can iterate visually within 48h); Phase 2 = wire to real backend with LOCAL_MODE teacher stub (~2-2.5d, ships Wed 3 June); Phase 3 = swap to Firebase auth + 1.A `Class` entity + analytics chat + CLI parity (~2-2.5d, post-demo). Teacher UI doc has full phase split + acceptance gates per phase |
| 1.G-Ph1 | (sub-row) Static mockup | **P0 ASAP** | ~0.5-1d | None | Cloud-agent-ready. Branches from `dev`. All five `/teacher/*` routes render with hardcoded data. No backend, no Firebase. Acceptance: M+JB visual sign-off |
| 1.G-Ph2 | (sub-row) Wire to real backend, LOCAL_MODE teacher auth | P0 | ~2-2.5d | 1.G-Ph1 complete | Real `ActivityConfig` Firestore writes; real session-summary aggregator; one seeded demo class. **Wed 3 June demo runs against this state** |
| 1.G-Ph3 | (sub-row) Firebase auth + 1.A swap + stretch | P1 | ~2-2.5d | 1.A complete, 1.G-Ph2 complete | Swap LOCAL_MODE teacher stub for Firebase; multi-class; analytics chat skill; opt-in share; CLI parity |
| 1.H | [audio-capture-and-tts.md](audio-capture-and-tts.md) — *brief:* [`audio-capture.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/audio-capture.md) | P2 | 0.5d TTS + 2d audio | TTS none; audio capture gated on **JB sign-off (5 consent / privacy questions)** + 1.A for per-class opt-in | **Split implementation.** TTS (browser-native `speechSynthesis`) ships independently — zero privacy gate, ~0.5d. Audio capture (opt-in group recording for research) blocked on JB consent / institutional approval sign-off — five questions in the brief must be answered before any code merges. Audio embodies SECURE-BY-CONSTRUCTION by structurally refusing to ship without consent decisions |
| 1.I | [proactive-tutor.md](proactive-tutor.md) | **P1** | Phase A ~0.5-1d (shipped); ~~Phase B ~1.5-2d~~ | Soft dep on [teacher-ui.md](implemented/teacher-ui.md) Phase 2 (`{teacher_focus}` injection) so the auto-greet reflects the teacher's intent | **UX gap from 2026-05-25 live student test.** Phase A = auto-greet on join (shipped). **Phase B (idle-heartbeat) RETIRED 2026-06-03** — superseded by [v1.1.2 proactive-sim-reactive-tutor](../v1.1.0-feedback/proactive-sim-reactive-tutor.md) (Path A: sim-event-reactive trigger replaces idle-heartbeat as the higher-value affordance per 3 June teacher feedback). Adds per-skill `proactive_greet` field |

## Analytics critical path (committed v1 — promoted 2026-05-28)

Teacher monitoring + analysis was raised above its original scope: it must
be **live for the pilot**, not built on its aftermath. These rows are owned
by the parent [../SEQUENCE.md](../SEQUENCE.md) (foundation + post-pilot
phases) but are pulled into this detail layer because they are now committed
v1 and need day-to-day sprint tracking alongside the teacher surface.

| Order | Doc | Priority | Estimate | Dependencies | Notes |
|---|---|---|---|---|---|
| 1.1 | [aipla-cloud-bootstrap.md](aipla-cloud-bootstrap.md) | P1-infra | 1.5d | — | Creates the `chat_logs` BigQuery dataset + Log Router sink IAM that 1.2 needs. Doc exists; not built. Can be partially applied (`terraform apply -target`) to land just the dataset + sink ahead of the full module |
| 1.2 | [chat-log-pipeline.md](implemented/chat-log-pipeline.md) | **P0 KEYSTONE** | 1.5d | 1.1 (dataset + sink IAM) | OTel → BigQuery sink. Durable group-ID-keyed turns + workbench events; BQ-backed `summarize_session`; exact `sim_run_count`. **Everything analytical depends on this.** Doc landed 2026-05-28 |
| 1.K | [dra-activity-framework.md](dra-activity-framework.md) | P1 | 0.5d standard + 1d YAML/injection | — | Supplies machine-readable DRA maps. On the analytics path **only if** the DRA lens is chosen in R1. Doc exists; not built |
| 1.L | [analytics-chat-tools.md](implemented/analytics-chat-tools.md) | P1 | 4-5d | 1.2 (BQ tables live), 1.A (teacher auth + `Class` entity), teacher-ui-ph3 M6 (skill template shipped) | **Wires the analytics-chat skill.** Six narrow `FunctionTool`s over the 1.2 BQ tables + per-tool `assert_caller_owns` for multi-tenant isolation; replaces the disabled `/teacher/analytics` mock with an AG-UI chat. Explicitly rejects ADK's built-in raw-SQL `BigQuery` toolset for axiom-9 reasons. Independent of R1 — ships the "chat to the data" path so analytics is live for the pilot even if 2.5 slips. Doc landed 2026-06-02; not built |
| 1.M | [teacher-insights-dashboard.md](implemented/teacher-insights-dashboard.md) | P1 | 3-4d (+1d if 1.L Phase 1-2 hasn't landed) | 1.L Phase 1-2 (shared `backend/analytics/queries.py` + `auth.py`), 1.2, 1.A | **The "glance" surface companion to 1.L.** KPI cards + cross-class comparison + per-group breakdown on `/teacher/classes`, `/teacher/classes/[id]`, and a new `/teacher/insights` page. Reuses 1.L's BQ query + authorization layer (single implementation, two surfaces). Engagement signals only — explicitly not the 2.5 pedagogical lens. `recharts` is the chosen viz library (~50 KB gzipped, code-split off the student bundle). Doc landed 2026-06-02; not built |
| 2.5 | [session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) | **P0** | ~8 eng-d + 3-4 JB/AR ped-d | 1.2 + R1 framework pick (+ 1.K if DRA lens) | The analysis layer. Promoted from roadmap signal. **R1 (JB/AR framework pick: ICAP+FCI vs CPS+DRA) must lock before the 2026-06-29 freeze.** Build runs in the post-freeze window (2026-07-06 → 08-14) |

**The long pole is human, not engineering.** R1 (framework pick) + R2/R7
(per-skill taxonomy + Danish/English labels) need JB/AR time. Tee them up
before the mid-point review (2026-06-26). If R1 can't land before the
freeze, [1.L analytics-chat-tools](implemented/analytics-chat-tools.md) ("chat to the
data" over the 1.2 tables) is the fallback that keeps *some* analysis live
for the pilot without a framework commitment. The 1.G-Ph3 M6 work shipped
the inert skill template; 1.L wires its query tools + per-teacher
authorization + frontend chat.

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

**Teacher monitoring + analysis (1.1, 1.2, 2.5) — promoted to committed v1 on 2026-05-28:**
- **Chat-log pipeline (1.2)** — durable, group-ID-keyed turns + workbench events in BigQuery; the teacher report's durable source; exact `sim_run_count`. The keystone everything analytical depends on.
- **Session-analytics rubric (2.5)** — the pedagogical layer over those logs (engagement + concept signal, not just message counts). Gated on 1.2 + the JB/AR framework pick (R1). See *Analytics critical path* above.
- **`analytics-chat` skill (1.G-Ph3)** — the lighter "chat to the data" path; the fallback if R1 slips.

**Deferred behind the teacher UI compression (since recovered):**

- 1.C LED Planck — shipped on schedule after teacher UI Phase 2 cleared
- 1.D KineBot — shipped
- 1.F session persistence — shipped 2026-06-01

v1.0.0-pilot ships by 2026-08-14 with comfortable margin. As of 2026-06-02, the analytics critical path is fully live (chat turns + workbench events flowing to BigQuery and surfaced in the teacher UI); the remaining gates are R1 (framework pick) + R2/R7 (taxonomy/labels), which are human-time, not engineering-time.

## What does NOT ship in v1.0.0-pilot

See [../SEQUENCE.md](../SEQUENCE.md) Phase 2 / 3 for the post-pilot scope (Strand B student-as-creator, Strand C scoping note, full handover package).

Specifically deferred from this version:
- Per-class budget surfacing UI (enforcer ships in 1.12 separately; the *display* lands later)
- Strand B (student-as-creator) skills
- Multi-school / institutional admin (UCPH-level admin roles above teachers)
- **Teacher control over artefact parameters** (roadmap signal — see [../post-pilot/teacher-artefact-parameters.md](../post-pilot/teacher-artefact-parameters.md)). v1 ships free-text teaching goal only. Parameter-level configurability is a v1.1 candidate, decision after pilot feedback. Surfaced as a wireframe "Parameters" tab on the activity-config screen so JB/AR can react to the affordance.
- **Teacher artefact authoring (code-level editing)** (roadmap signal — see [../post-pilot/teacher-artefact-authoring.md](../post-pilot/teacher-artefact-authoring.md)). v2 / Year-2 explicit scope — outside the contract window. Surfaced as wireframe "Code" + "History" tabs on the activity-config screen so the v1 design doesn't paint us into a corner.
- ~~**Pedagogical rubrics over chat logs**~~ — **PROMOTED to committed v1 on 2026-05-28** (no longer deferred). Teacher monitoring + analysis was raised above its original scope; the rubric layer (2.5) is now on the committed analytics critical path. See *Analytics critical path* above + [../post-pilot/session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md). The framework pick (ICAP+FCI vs CPS+DRA) is the open JB/AR decision (R1), to lock before the 2026-06-29 freeze.

## Risks

| Risk | Mitigation |
|---|---|
| UCPH SSO integration timing — IT department response cycle could exceed the pre-mid-point window | Default to Firebase federated auth with Google OAuth provider; UCPH SSO becomes a v2 upgrade path. The permission model itself is auth-mechanism-agnostic |
| Tag-namespace collisions between teachers | Mandatory namespace prefix `class:<teacher_uid>:<class_id>` — enforced in the `Class` creation path; impossible to construct a colliding tag |
| Group-code lifecycle confusion when classes are deleted | Soft-delete only; revoked classes flip a flag rather than dropping the Firestore doc. Group JWTs validate against the live flag at every request |

## Sprint status (2026-06-02)

**Shipped (merged to `dev`):**

- ✓ 1.G-Ph1 — Teacher UI static mockup
- ✓ 1.G-Ph2 — Teacher UI wired to real backend (LOCAL_MODE teacher stub)
- ✓ 1.E — Workbench state debounce (Phase 1)
- ✓ 1.H-TTS — Browser-native TTS button
- ✓ 1.I-PhA — Proactive tutor auto-greet
- ✓ 1.A — Teacher permission model (Firebase backend + Class entity + tag-based access + manage-class skill + CLI). Shipped as `997a85b`. Docs moved to [implemented/teacher-permission-model.md](implemented/teacher-permission-model.md) + [implemented/teacher-permission-1a-sprint.md](implemented/teacher-permission-1a-sprint.md).
- ✓ 1.E-Ph2 — Workbench commit-on-submit gating. Shipped as `c0d2870`. Docs in [implemented/workbench-state-debounce.md](implemented/workbench-state-debounce.md).
- ✓ 1.B — Lesson picker `/lessons` route. Docs in [implemented/lesson-picker.md](implemented/lesson-picker.md).
- ✓ 1.F — Session persistence (group code = session key for 30 days). Shipped 2026-06-01. Docs in [implemented/session-persistence.md](implemented/session-persistence.md).
- ✓ STUDENT-LESSON-VIEW — Live skill_ids resolve at join + class banner on `/lessons`. Docs in [implemented/student-lesson-view.md](implemented/student-lesson-view.md).
- ✓ 1.1 — Cloud bootstrap (BQ dataset + Log Router sink IAM, Terraform-managed).
- ✓ 1.2 — Chat-log pipeline (BQ sink for chat turns + workbench events; BQ-backed `summarize_session`). Docs in [implemented/chat-log-pipeline.md](implemented/chat-log-pipeline.md) + [implemented/chat-log-pipeline-sprint.md](implemented/chat-log-pipeline-sprint.md) + [implemented/chat-log-pipeline-verification.md](implemented/chat-log-pipeline-verification.md).
- ✓ 1.C — LED Planck virtual lab + Danish Socratic tutor. Docs in [implemented/led-planck-skill.md](implemented/led-planck-skill.md).
- ✓ 1.D — KineBot kinematics tutor (NCERT/CBSE Class 11, AIPLA-rails migration). Docs in [implemented/kinebot-migration.md](implemented/kinebot-migration.md).
- ✓ TEACHER-UI-PH3 — Firebase OAuth swap + multi-class + analytics-chat skill template + opt-in share + CLI parity. M1-M4 + M6-M9 shipped (M5 deliberately skipped — per-class detail view replaced the dropdown). M6's analytics-chat wiring completed via the ANALYTICS-CHAT-AND-INSIGHTS sprint 2026-06-02. Docs moved to [implemented/teacher-ui-ph3-sprint.md](implemented/teacher-ui-ph3-sprint.md) 2026-06-03.

**Recently shipped (post 2026-05-26, no dedicated sprint doc):**

- Teacher dashboard now shows real session activity at three zoom levels (main dashboard, class detail per-group stats + activity feed, session report with workbench-activity list). Backend `list_sessions_for_group_codes` switched to ownerUid prefix matching so pre-`groupCode`-backfill sessions are also visible. Shipped 2026-06-02 as `29908dc` + `868e3db`.
- `AIPLA_TEACHER_MOCK_AUTH` bypass + demo-class seeder + frontend demoRole helpers removed now that Firebase teacher auth works end-to-end. Shipped 2026-06-02 as `ae2723e`.
- `backend/adk/callbacks.py` (807 LOC) split into `callbacks/{permission,document,session,large_output}.py` submodules with `__init__.py` re-exports. No import changes anywhere else. Shipped 2026-06-02 as `c68a67f`.

**Queued (plans + JSON state ready; not started):**

_(None as of 2026-06-03 — TEACHER-UI-PH3 close-out shipped; v1.1 work is sequenced separately under [../v1.1.0-feedback/SEQUENCE.md](../v1.1.0-feedback/SEQUENCE.md).)_

**Analytics critical path (committed v1 2026-05-28):**

| # | Item | Doc | State | Gate |
|---|---|---|---|---|
| 1.1 | cloud-bootstrap (BQ dataset + sink IAM) | infra repo | **shipped** (Terraform applied; sink IAM wired) | — |
| 1.2 | chat-log-pipeline (BQ sink — **KEYSTONE**) | [implemented/chat-log-pipeline.md](implemented/chat-log-pipeline.md) | **shipped** 2026-05-28 → 2026-06-01; teacher UI display of workbench events added 2026-06-02 (`868e3db`) | — |
| 1.K | dra-activity-framework (DRA maps) | [dra-activity-framework.md](dra-activity-framework.md) | doc ready, not built | only if DRA lens chosen in R1 |
| 2.5 | session-analytics-rubric (analysis layer) | [../post-pilot/session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) | doc ready (promoted), not built | 1.2 + R1 framework pick |

**Blocked on JB/AR sign-off:**

- 1.H-audio (consent + privacy questions)
- ~~1.I-PhB idle heartbeat (copy + timing)~~ — **retired 2026-06-03**; superseded by [v1.1.2 proactive-sim-reactive-tutor](../v1.1.0-feedback/proactive-sim-reactive-tutor.md)
- **R1 — analytics framework pick** (ICAP+FCI vs CPS+DRA) — gates all of 2.5; lock before the 2026-06-29 freeze
- **R2 / R7 — per-skill taxonomy + Danish/English label translations** — needed before 2.5's concept-tracking lens ships

See [../v1.1.0-feedback/SEQUENCE.md](../v1.1.0-feedback/SEQUENCE.md) for the v1.1 feedback batch (9 items from the 3 June teacher check-in) and its own JB/AR gating list.

## Next

After v1.0.0-pilot lands, work proceeds against [../SEQUENCE.md](../SEQUENCE.md) Phase 2 (Strand-B + Strand-C scoping work) and Phase 3 (handover).
