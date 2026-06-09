# AIPLA Build Sequence

> AIPLA-specific design and execution docs live under `docs/design/aipla/`,
> kept separate from the inherited template docs in `docs/design/v6.x.x/`.
> This is the **execution** layer. Architecture and strategy
> (ADRs 001–015, strand definitions, capability-floor eval framework)
> live in the **scoping site** at `~/Documents/clients/cph-uni`
> ([architecture.qmd](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd),
> [strands.qmd](file:///Users/mark/Documents/clients/cph-uni/strands.qmd),
> [timeline.qmd](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd),
> [evaluation.qmd](file:///Users/mark/Documents/clients/cph-uni/evaluation.qmd)).
> Cite ADRs from this repo's design docs — do not restate them.

## AIPLA versions

The 4-month contract has three product-version anchors. These are AIPLA's
own versions, **not** related to the template's `v6.x.x` versions.

| Version | Anchor date | Audience | Skill commitment |
|---|---|---|---|
| **v0.1.0-jutland** | 2026-05-27 (Wed) | JB + Aswin demo to ~2–3 Jutland stx teachers | Single physics-tutor skill, group-ID join, deployed dev URL |
| **v1.0.0-pilot** | 2026-08-14 (Fri) | Danish teacher pilot — 10 teachers + K | 5 skills + curated sim library + teacher config + multimodal + BigQuery logs + per-class budgets enforced + **teacher monitoring & analysis (session rubric)** |
| **v2.0.0-handover** | 2026-09-15 (Mon) | Final handover — co-owners run AIPLA after contract | v1 + runbooks + eval automation + DPIA + scoping-note Strand C delivered |

## Phase 0 — Jutland demo (v0.1.0)

**Status as of 2026-06-05:** Phase 0 shipped. v0.1 deployed 2026-05-20 (6 days ahead of the Jutland deadline); Boldkast over-deliver landed in the buffer window.

| Order | Doc | What it locks | Est | Status |
|-------|-----|---------------|-----|--------|
| 0.1 | [aipla/v0.1.0-jutland/jutland-demo.md](v0.1.0-jutland/jutland-demo.md) | First deployed AIPLA URL on `aipla-dev-2026`, anonymous group-ID join, `problem-set-hints` skill | 1d | ✅ Shipped 2026-05-20 (commit 1636038) — live at `aipla-v01-frontend-wgwhd7mspa-lz.a.run.app` |
| 0.2 | [aipla/v0.1.0-jutland/boldkast-mcp-app.md](v0.1.0-jutland/boldkast-mcp-app.md) | v0.1 over-deliver: hand-curated Boldkast projectile-motion sim in the `workspace` surface (library-bypass per ADR-013). Groundwork for 1.11 artefact-review pipeline | 1.5d | ✅ Shipped (buffer week 2026-05-20 → 27); `aipla-v01-sandbox` Cloud Run service serves the sandboxed iframes |

**v0.1 explicit non-goals** (deferred to v1.0.0-pilot):
- Teacher configuration UI
- Multimodal upload (photos, CSVs)
- A2UI dashboards
- MCP App surfaces
- Multi-class / multi-group dashboards
- BigQuery chat-log export
- Per-class budget surfacing (the enforcer ships; the UI does not)

## Phase 1 — After the cloud is stood up (v1.0.0-pilot critical path)

Once `aipla-dev-2026` is live and v0.1 is demoed, the docs below sequence
the build between **2026-05-28 (post-Jutland)** and **2026-08-14 (pilot
start)**. Order roughly follows the [scoping site
timeline](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd) and
respects the **mid-point review (2026-06-26)** + **holiday freeze
(2026-06-29 → 07-05)** gates.

> The order column is the *intended* ordering, but in practice 1.1 / 1.2 /
> 1.3 should kick off in parallel as soon as v0.1 ships — they're
> independent surfaces. 1.4 onwards depends on at least 1.1 + 1.2 being
> in-place.

### 1.x — Foundation (target: pre-mid-point review, 2026-06-26)

| # | Doc (planned) | Why | ADRs it implements | Est |
|---|---|---|---|---|
| **1.1** | `aipla-cloud-bootstrap.md` | Make the GCP provisioning of `aipla-{dev,test,prod}-2026` reproducible: terraform module, IAM cascade, Firebase Auth tenants, Vertex AI region pinning, Cloud Build triggers, secrets schema, BigQuery dataset for chat logs. Pulls the manual M0 work from v0.1 into a documented, repeatable form. | 006, 007 | 1.5d |
| **1.2** | [v1.0.0-pilot/implemented/chat-log-pipeline.md](v1.0.0-pilot/implemented/chat-log-pipeline.md) | **P0 KEYSTONE for teacher monitoring + analysis (promoted 2026-05-28).** OTel → BigQuery sink for group-ID-keyed chat logs (full prompt + response, no PII per ADR-001). Consent-form-driven retention defaults. Researcher access pattern (a saved BQ query + a thin Looker board, not a custom UI). **Everything cohort-scale analytical depends on this: the 2.5 rubric reads these tables, the teacher report's durable source becomes them, and research aggregation runs off them. If it slips, teacher analytics cannot be live for the pilot — so this is now the critical-path item to protect, not a parallel surface.** | 001, 005, 008 | 1.5d |
| **1.3** | `rag-pgvector-setup.md` | pgvector on Multivac Postgres for teacher-uploaded curriculum/problem-sets. Schema, chunking strategy, MCP server wrapping the retrieval, ACL by class/group. Excludes Strand C graph DB (deferred until C3 scoping recommends). **DECISION 2026-06-09: v1 defaults to managed ADK RAG (Vertex AI RAG Engine) — pgvector is the cost; this row is deferred to the Year-2 local/on-prem swap (`self-hosting.qmd`).** The 9 June [curriculum-library (1.1.25)](v1.1.0-feedback/curriculum-library.md) runs on **ADK RAG now**, behind a backend-agnostic retrieval interface, so it is **no longer gated on this row.** | 010 | 2d (Year-2) |
| **1.4** | `model-router-aipla-config.md` | Wire the four-tier router (cloud API · self-hosted server · server-local · on-device) to AIPLA-specific skill→model mappings. Capability-floor eval feeds the routing decisions. Initial mapping is conservative (`gemini-3.5-flash` via Vertex AI for everything in v0.1 → eval-derived per-skill mapping for v1; Sonnet 4.6 retained as cross-provider fallback per ADR-003). | 003, 008 | 1d |
| **1.5** | `capability-floor-eval-runner.md` | Concrete eval set, task taxonomy (T1–T8), model panel, BigQuery results sink, scheduled CI run. The eval framework is in the scoping site — this doc is the runner. Built so AR can iterate the rubric without touching code. | (eval framework — strands.qmd) | 2d |

### 1.6–1.9 — Teacher surface (target: post-holiday, weeks 8–12)

| # | Doc (planned) | Why | ADRs | Est |
|---|---|---|---|---|
| **1.A** | [aipla/v1.0.0-pilot/implemented/teacher-permission-model.md](v1.0.0-pilot/implemented/teacher-permission-model.md) | **Combined doc for rows 1.6 + 1.7.** Teacher Firebase auth (Google OAuth in v1; UCPH SSO is a v2 upgrade path — same data model) + `Class` entity (tag namespace `class:<uid>:<id>`, soft-delete) + Group → Class binding (group JWTs carry the class's `group_tags`) + tag-based lesson access via the existing 5-type `AccessControl` model. The `manage-class` skill is the teacher UX on top. | 001 (teacher-auth half), 014, 015 | 3-5d |
| **1.B** | [aipla/v1.0.0-pilot/implemented/lesson-picker.md](v1.0.0-pilot/implemented/lesson-picker.md) | Replace v0.1's hardcoded `POST_JOIN_REDIRECT` with a `/lessons` route that lists every skill the student can access. Pure FE; consumes the already-filtered `GET /api/skills`. Prerequisite for 1.C + 1.D being visible to students | — | 0.5d |
| **1.C** | [aipla/v1.0.0-pilot/implemented/led-planck-skill.md](v1.0.0-pilot/implemented/led-planck-skill.md) (technical execution); [`led-planck-skill-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/led-planck-skill-brief.md) in scoping site (pedagogical source-of-truth) | **Second physics skill.** Self-contained Danish stx artefact (~1855 LOC, zero external fetches). Procedural-virtual-lab artefact class — different form factor from Boldkast's phenomenon-sim. In-repo design doc covers file paths, axioms, ADR-013 scan, test plan; brief covers tutor prompt + lesson pedagogy | 013 | 1.5-2d |
| **1.D** | [aipla/v1.0.0-pilot/implemented/kinebot-migration.md](v1.0.0-pilot/implemented/kinebot-migration.md) (technical execution + runbook commitment); [`kinebot-migration-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/kinebot-migration-brief.md) in scoping site (audit + pedagogy) | **Third physics skill — canonical AIPLA migration runbook.** External AI artefact (1707 LOC) built by DK, has direct Anthropic API calls in browser that AIPLA must strip. NCERT/CBSE Class 11 kinematics, English. Beta cohort: ~100s of DK's Indian students. **The in-repo design doc commits to landing the migration as a permanent runbook section in `.claude/skills/mcp-app-artefact/` for future external-artefact onboarding** + adds `aiplatform artefact audit` CLI command for the dogfooding loop | 013, 014 | 2-3d |
| **1.E** | [aipla/v1.0.0-pilot/implemented/workbench-state-debounce.md](v1.0.0-pilot/implemented/workbench-state-debounce.md) (execution); [`workbench-state-debounce.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/workbench-state-debounce.md) (brief) | **Quick fix from 2026-05-25 meeting** — slider drags spam the chat with cards. Move debounce-at-host (500ms shipped in MCPAPP-SPEC) to debounce-at-artefact (800ms) + coalesce-by-field-at-host (300ms). Wire shape becomes minimal-delta (`{changed, value, unit}`) not full snapshot. Centralises in `StaticArtefactFrame` so future artefacts inherit | — | 0.5d |
| **1.F** | [aipla/v1.0.0-pilot/implemented/session-persistence.md](v1.0.0-pilot/implemented/session-persistence.md) (execution); [`session-persistence.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/session-persistence.md) (brief) | **Same group code resumes the same session for 30 days** — cross-device coherence, chat history + workbench state restored on rejoin. Adds `aipla:restore` artefact contract required by all current + future artefacts. Adds `aiplatform sessions resume / reset` CLI for ops parity | 001, 005 | 1.5-2d |
| **1.G** | [aipla/v1.0.0-pilot/implemented/teacher-ui.md](v1.0.0-pilot/implemented/teacher-ui.md) (execution, **phased**); [`teacher-ui-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/teacher-ui-brief.md) (brief) | **P0 — demo target Wed 3 June.** **Compressed via 3-phase split (2026-05-25 evening decision):** Phase 1 = static mockup ASAP (~0.5-1d, no backend), Phase 2 = wire to real backend with LOCAL_MODE teacher stub (~2-2.5d, Wed 3 June demo state), Phase 3 = Firebase + 1.A swap + stretch (~2-2.5d, post-demo). **Unblocks 1.A from being on the critical path** — 1.A now runs in parallel with Phase 2. See teacher-ui.md "Phased delivery" section for per-phase acceptance gates | 001, 005, 014, 015 | 5-6d (split) |
| **1.H** | [aipla/v1.0.0-pilot/audio-capture-and-tts.md](v1.0.0-pilot/audio-capture-and-tts.md) (execution); [`audio-capture.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/audio-capture.md) (brief) | **Split implementation.** TTS (tutor responses read aloud via `window.speechSynthesis`) ships independently — zero privacy gate, ~0.5d. Audio capture (opt-in group recording for research) blocked on **JB sign-off** on 5 consent / privacy / retention questions. Per-class teacher opt-in toggle in 1.G | 001, 005 | 0.5d + 2d |
| ~~1.6~~ | ~~`teacher-auth-ucph-sso.md`~~ | ~~Superseded — merged into 1.A. UCPH SSO is now a v2 upgrade path; v1 ships Google OAuth.~~ | — | — |
| ~~1.7~~ | ~~`class-and-group-management.md`~~ | ~~Superseded — merged into 1.A. The class + group management is in the unified permission-model doc.~~ | — | — |
| **1.7-ops** | [aipla/v0.1.0-jutland/group-tooling.md](v0.1.0-jutland/group-tooling.md) | `aiplatform group new/list/revoke` CLI + backend list/revoke admin endpoints. Replaces the v0.1 multi-step curl ritual with a single command. Ships alongside 1.7 (teacher GUI) so ops keeps a CLI fallback once teachers have the dashboard. Moved here from Phase 0 per user direction 2026-05-20 ("later in the sequence"). | 0.5d |
| **1.8** | `problem-set-helper-config-skill.md` | `problem-set-helper-config` (v1, teacher-facing) — teacher configures a tutor for a specific topic / problem set, pointing at one or more RAG-ingested documents. A2UI config form. | (skill catalogue — strands.qmd) | 2d |
| **1.9** | `concept-dialogue-config-skill.md` | `concept-dialogue-config` (v1) — standalone Socratic conceptual-exploration tutor for a topic. A2UI config form. | (skill catalogue) | 1.5d |

### 1.I–1.K — Artefact library expansion + pedagogy framework (target: post-holiday, weeks 8–12)

| # | Doc | Why | ADRs | Est |
|---|---|---|---|---|
| **1.I** | [aipla/v1.0.0-pilot/jitt-dk-artefacts.md](v1.0.0-pilot/jitt-dk-artefacts.md) | **Curated sim library expansion.** 23 free Danish physics apps by a Jutland teacher (jitt.dk). If iframe-compatible, each onboards in ~1 day. Priority order: Pendul (pendulum, activity 4) → Kredsløb (circuit, complements LED Planck) → Videoanalyse (video motion analysis, Type 4 workbench) → GPS Fart (real-device experiment, Type 3) → Frekvensanalysator (waves). ADR-013 scan + postMessage adapter + tutor system prompt per app. Each ships with a DRA map (AR + JB). Sensor apps (GPS Fart) blocked on Type 3 investigation from 1.K | 013 | 1–2d per app |
| **1.J** | [aipla/v1.0.0-pilot/expanded-workbench-types.md](v1.0.0-pilot/expanded-workbench-types.md) | **Workbench type system formalisation.** JB (2026-05-26): *"the workbench might include other stuff than apps."* Formalises 5 types: App (live), Drawing board (Excalidraw, Type 2, v1.1), Experiment tool (phone sensors, Type 3, v1.2), Video analysis (Type 4, v1.2 + privacy gate), Lab notebook (structured fields, Type 5, v1.1). Each type has a named postMessage contract, React wrapper component, and skill-config YAML field. Prerequisite: sensor sandbox investigation (0.5d) before any Type 3 work starts. **The 9 June [offline-lab-workbench (1.1.24)](v1.1.0-feedback/offline-lab-workbench.md) specializes Type 5 (lab-notebook) with teacher-supplied ground-truth checking — it consumes this type, sequence after.** | — | 1d spec + 2–3d per new type |
| **1.K** | [aipla/v1.0.0-pilot/dra-activity-framework.md](v1.0.0-pilot/dra-activity-framework.md) | **DRA (Disciplinary-Relevant Aspects) design standard.** Applies Linder et al. 2024 representational-competence framework (JB co-author) to all AIPLA activities. Every activity ships with a DRA map (AR writes physics content; JB reviews PER alignment) marking concept aspects as present vs appresent in the workbench. Drives: Socratic tutor question patterns, session-analytics-rubric vocabulary (2.5), capability-floor eval test cases (1.5). v1.1 adds `dra_map` YAML field to skill config + InstructionProvider injection for session DRA-coverage tracking | (eval framework — evaluation.qmd) | 0.5d standard + 1d YAML/injection |
| **1.L** | [aipla/v1.0.0-pilot/mcp-app-reliability-gate.md](v1.0.0-pilot/mcp-app-reliability-gate.md) | **Automated multi-width fit gate for sim artefacts.** Turns the `mcp-app-artefact` skill's *manual* "fits 700px, no horizontal scroll" check into an automated Playwright gate (renders each artefact at 360/700/1024/1440px, fails on `scrollWidth>clientWidth`), folds in the ADR-013 size cap, and runs **both** locally (`make check-artefacts`) and as a deploy block in `aipla-mcp-sandbox-deploy`. Adds a fluid-by-default authoring contract to the skill + `_template` + scaffold and backfills the 3 existing sims. Prompted by the KineBot widescreen overflow (2026-05-29) that passed the manual 700px check. Makes Axiom 11's viewport gate enforced, not hoped-for. | 013 | 1.5d |

### 1.10–1.12 — Document handling + budget surfacing (target: pre-pilot, week 12)

| # | Doc (planned) | Why | ADRs | Est |
|---|---|---|---|---|
| ~~**1.10**~~ | ~~`multimodal-ingestion-via-ailang-parse.md`~~ | **Superseded for the student slice** by [v1.1.0-feedback/student-multimodal-upload.md](v1.1.0-feedback/student-multimodal-upload.md). Teacher document ingestion (curriculum PDFs, problem sets via AILANG Parse's 13 deterministic formats) remains as a smaller follow-up reusing the v1.1 backend plumbing | 004, 011 | (folded into 1.1.7) |
| **1.11** | `artefact-review-pipeline.md` | The MCP server gating generated HTML/SVG before any iframe render. v1 ships with the **hand-curated sim library**, so this lands as infrastructure groundwork for Year-2 artefact generation; tested against a small fixture library. | 013 | 2d |
| ~~**1.12**~~ | ~~`budget-dashboard.md`~~ | **Superseded** by [v1.1.0-feedback/cost-dashboard.md](v1.1.0-feedback/cost-dashboard.md), which expands scope to cross-class researcher view + per-activity / per-group breakdown + projected monthly spend, driven by DK's Indian cohort scaling. The per-class enforcer (separate, already in tree) is unchanged | 014, 015 | (folded into 1.1.9) |

### 1.13 — Pilot readiness (target: 2026-08-08, one week before pilot)

| # | Doc (planned) | Why | ADRs | Est |
|---|---|---|---|---|
| **1.13** | `pilot-readiness-checklist.md` | Not a feature doc — a release checklist. DPIA scaffold, consent form sign-off (JB), capability-floor eval baseline locked, runbooks for "how to onboard a new teacher / class", smoke tests for the full v1 path, rollback procedures. | 005, 014 | 1d |

## Phase 1.1 — Post-3-June teacher check-in feedback (v1.1.0-feedback)

The batch began as nine items distilled from the 3 June 2026 teacher check-in (full brief at
[`june-03-feedback-sprint-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md)
in the scoping site), grew to **1.1.1–1.1.19** (voice + chat-polish + security + teacher-activity-authoring), and absorbed the **9 June 2026 teacher check-in** (brief at
[`june-09-feedback-sprint-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-09-feedback-sprint-brief.md))
as rows **1.1.20–1.1.25**. Per-item design docs, full ordering, and the **authoritative verified status** live in
[v1.1.0-feedback/SEQUENCE.md → Build status (verified 2026-06-08)](v1.1.0-feedback/SEQUENCE.md#build-status--verified-2026-06-08).

> **Status as of 2026-06-09: 9 SHIPPED · 1 PARTIAL · 15 OPEN** (6 OPEN rows added from the 9 June batch — all design/brief-only). The table below mirrors only the original nine; rows 1.1.10–1.1.25 and per-row evidence are in the child Build status + *9 June teacher check-in batch* sections.

> **⚠ One date-forced item from 9 June: [1.1.23 bidirectional voice](v1.1.0-feedback/bidirectional-voice-brief.md), target 2026-06-23** (sound in *and* out, ahead of the freeze). It is a **swap-shaped `voice_mode` config axis** (`gemini_live` duplex + `stt_tts_roundtrip` over the shipped 1.1.11 stack as **coexisting mode options**, mirroring ADR-003 model tiers) — not a pick-one build. **Decision-blocked, not engineering-blocked**: M gives the per-mode GDPR posture, JB picks the first-enabled mode. The axis + `stt_tts_roundtrip` guarantee something live; `gemini_live` slots in by config when LiveRunner + the audio review land. The rest of the 9-June batch is small Part-1 extensions (1.1.20–1.1.22) plus two post-mid-point Part-2 docs gated on existing infra: **1.1.24 offline-lab** on [1.J expanded-workbench-types](v1.0.0-pilot/expanded-workbench-types.md), **1.1.25 curriculum-library** on **1.3 rag-pgvector** below.

| # | Doc | Est | Status / Gate |
|---|-----|-----|---------------|
| 1.1.1 | [tutor-verbosity-fix.md](v1.1.0-feedback/implemented/tutor-verbosity-fix.md) | ~2h | **SHIPPED** (QUICK-WINS-V11) |
| 1.1.2 | [proactive-sim-reactive-tutor.md](v1.1.0-feedback/implemented/proactive-sim-reactive-tutor.md) | ~1d | **SHIPPED** — re-scoped [proactive-tutor.md](v1.0.0-pilot/proactive-tutor.md) Phase B idle-heartbeat → sim-event-reactive |
| 1.1.3 | [student-consent-prompt.md](v1.1.0-feedback/student-consent-prompt.md) | ~1d | **OPEN** — blocked on JB consent-wording sign-off |
| 1.1.4 | [session-report-summary-primary.md](v1.1.0-feedback/session-report-summary-primary.md) | ~1d | **OPEN** — independent; foundational for eventual audio inclusion |
| 1.1.5 | [researcher-role.md](v1.1.0-feedback/researcher-role.md) | ~1d | **OPEN** — new `role:researcher` Firebase claim above teacher tier |
| 1.1.6 | [group-code-school-year-ttl.md](v1.1.0-feedback/implemented/group-code-school-year-ttl.md) | ~2h | **SHIPPED** — rescoped mid-sprint to rename + 410-on-expiry (default stays 30d); per-code TTL choice split to 1.1.10 |
| 1.1.7 | [student-multimodal-upload.md](v1.1.0-feedback/student-multimodal-upload.md) | ~2d | **OPEN** — supersedes 1.10 student slice; ADR-008 ready; JB image-retention confirm |
| 1.1.8 | [exit-ticket.md](v1.1.0-feedback/exit-ticket.md) | ~1d | **OPEN** — blocked on JB/AR question set |
| 1.1.9 | [cost-dashboard.md](v1.1.0-feedback/cost-dashboard.md) | ~1d | **OPEN** — supersedes 1.12; per-class + cross-class researcher cost views |

**Total v1.1 estimate:** ~16.5–17.5d engineering across the full 1.1.1–1.1.18 set (the original nine were ~8.5d). Fits in the post-3-June → pilot-start window (2026-06-04 → 2026-08-14, ~10 weeks minus the 2026-06-29 → 07-05 freeze). Roughly half is shipped; several remaining items can land *before* the pilot, the rest absorb into pilot-iteration weeks.

**Human-gated items to tee up first:** JB consent wording (1.1.3), JB/AR exit-ticket question set (1.1.8), AR verbosity-prompt sign-off (1.1.1), JB image-retention posture (1.1.7).

## Phase 2 — Strand B + Strand C + roadmap signals (post-pilot, weeks 13–17)

These docs only get written if v1 is on track at the mid-point review.
Rows 2.3 and 2.4 are **roadmap signals**, not commitments — they capture
the direction so v1 design choices don't paint us into a corner. Both
have explicit decision criteria for "when would we actually build this."

> **Row 2.5 was promoted to committed v1 on 2026-05-28** — teacher
> monitoring + analysis was raised above its original scope. It is **no
> longer Phase-2-conditional**; it stays listed in this table only
> because its detailed framework analysis lives in the post-pilot doc.
> Its only gates are **1.2** (the BigQuery sink) and **JB/AR sign-off**
> on the framework brief landed 2026-06-03 in the scoping site
> ([`teacher-analytics-framework.md`](file:///Users/voightkampff/dev/sunholo-data/aipla/strand-a-pedagogical-bot/prototypes/teacher-analytics-framework.md)
> — DRA-led). Sign-off must land before the 2026-06-29 holiday freeze.
> See the *Teacher monitoring + analysis critical path* note under the
> dependency graph. **Note:** the framework brief targets **v1.2**, not
> v1.0 pilot — v1 ships chat + BigQuery logs, the DRA tagging pass +
> analytics chat layer in v1.2.

| # | Doc (planned) | Strand / target | Status |
|---|---|---|---|
| 2.1 | `strand-b-student-as-creator.md` | B | Stub; depends on v1 working in the pilot |
| 2.2 | `strand-c-scoping-note-plan.md` | C | The scoping note itself ships in the scoping site, not here. This doc is just the per-RQ investigation plan (model panel, AILANG benchmark probes, lit review). |
| 2.3 | [aipla/post-pilot/teacher-artefact-parameters.md](post-pilot/teacher-artefact-parameters.md) | v1.1 — post-pilot iteration | **Roadmap signal, not committed.** Bounded parameter editing for first-party artefacts (Boldkast, LED Planck) — sliders/toggles/enums driven by a schema, no code. Decision after 2026-08-14 pilot feedback |
| 2.4 | [aipla/post-pilot/teacher-artefact-authoring.md](post-pilot/teacher-artefact-authoring.md) | v2 / Year-2 — explicitly out of contract | **Roadmap signal, not committed.** Code-level artefact editing by teachers, AI-assisted via the `.claude/skills/mcp-app-artefact` skill, draft → review queue → publish. 6-10 weeks of focused engineering; tied to Year-2 research programme, not this contract |
| 2.5 | [aipla/post-pilot/session-analytics-rubric.md](post-pilot/session-analytics-rubric.md) | **Committed v1 — promoted 2026-05-28** (teacher monitoring + analysis raised above original scope; must be live *for* the pilot, not built on its aftermath). Gated on 1.2 + the JB/AR framework sign-off. | The analysis layer over the stored logs — turns "34 messages, 8 sim runs" into engagement + concept signal. **Framework direction settled 2026-06-03 in the scoping site's [`teacher-analytics-framework.md`](file:///Users/voightkampff/dev/sunholo-data/aipla/strand-a-pedagogical-bot/prototypes/teacher-analytics-framework.md) brief**: DRA-led (the (b) **CPS + DRA** stack from the earlier framing) — Linder/Bruun/Pohl/Priemer 2024 representational-competence framework, consuming the [1.K](v1.0.0-pilot/dra-activity-framework.md) DRA maps as machine-readable input. The scoping-site brief targets **v1.2 analytics chat**, not v1.0 pilot — which softens the original "must be live *for* the pilot" framing; v1 ships chat + BigQuery logs, v1.2 layers the DRA tagging pass + analytics chat. **R1 reframes** from "which framework" to JB/AR sign-off on: (i) the Boldkast DRA map (the brief proposes 4 DRAs; AR + JB to confirm/revise), (ii) the four open questions at the end of the brief (appresent priority, activation threshold, MAMCR research track). Lock before the 2026-06-29 holiday freeze so the post-freeze window can build against a fixed DRA contract. ~8 eng-days + ~3–4 JB/AR ped-days. |

## Phase 3 — Handover (weeks 16–17)

| # | Doc (planned) | Why |
|---|---|---|
| 3.1 | `handover-package.md` | Index of all runbooks, deep-dive sessions, sign-offs. Per the handover-fan-out table in [timeline.qmd](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd), each artefact has a named co-owner. This doc is the manifest. |

---

## Dependency graph (v0.1 → v1 critical path)

```
v0.1.0-jutland (1d) ──► 0.2 boldkast-mcp-app (1.5d, buffer-week over-deliver)
    │
    └─► 1.1 cloud-bootstrap ──┬─► 1.2 chat-log-pipeline ──┐
                              ├─► 1.3 rag-pgvector ────────┤
                              └─► 1.4 model-router ────────┤
                                                            ▼
                              1.5 capability-floor-eval ──► (mid-point review 2026-06-26)
                                                            │
                            ──── holiday freeze 2026-06-29 → 07-05 ────
                                                            │
                              1.G teacher-ui Ph1+Ph3 ✅────┐  Ph1 mockup + Ph3 Firebase
                                                            │  shipped; Ph2 LOCAL_MODE state
                                                            │  superseded by Ph3 swap
                                                            │
                              1.A teacher-permission ✅────┤  (shipped 2026-05; researcher
                                                            │   tier added in ADR-001 patch)
                              1.B lesson-picker ✅─────────┤  (shipped)
                              1.C LED Planck skill ✅──────┤  (shipped 2026-05-27)
                              1.D KineBot migration ✅─────┤  (shipped 2026-05-28)
                              1.E debounce ✅──────────────┤  (shipped; 2026-05-25 meeting fix)
                              1.F session persistence ✅───┤  (shipped; Vertex Agent Engine wired
                                                            │   for session/memory persistence)
                              1.H TTS Phase A ✅ / audio ⏳ │  (TTS shipped via 1.1.11; audio
                                                            │   capture pending JB consent)
                              1.8 problem-set-helper-cfg ⏳┼─► (planned; configurable variant
                              1.9 concept-dialogue-cfg ⏳──┘    of the live skill — depends on
                                                                1.3 rag-pgvector for source-doc
                                                                grounding; targets pre-pilot)
                                                            │
                              1.I jitt-dk-artefacts ───────┐
                              1.J workbench-types ─────────┤  (1.I type-3 apps need 1.J first)
                              1.K dra-framework ───────────┤
                              1.10 multimodal-ingestion ───┤
                              1.11 artefact-review ────────┤
                              1.12 budget-dashboard ───────┘
                                                            │
                              1.13 pilot-readiness ────────► (pilot start 2026-08-14)
                                                            │
                                          ┌─────────────────┴──────────────────┐
                                          ▼                                     ▼
                              2.1 strand-b-student-creator           2.2 strand-c-scoping-plan
                                          │                                     │
                                          └─────────────► 3.1 handover ◄────────┘
                                                            (final: 2026-09-15)
```

## Teacher monitoring + analysis critical path (committed v1 — promoted 2026-05-28)

Teacher monitoring + analysis was raised above its original scope: it must
be **live for the pilot**, not built on the pilot's aftermath. That makes
the following a committed v1 critical path, not a post-pilot signal:

```
1.1 cloud-bootstrap ──► creates chat_logs dataset + Log Router sink IAM
        │
        ▼
1.2 chat-log-pipeline ──► OTel → BigQuery sink (KEYSTONE)
        │                  durable, group-ID-keyed, no PII; teacher report's
        │                  durable source; the table the rubric reads
        ├───────────────► 2.5 session-analytics-rubric (the analysis layer; v1.2)
        │                     ▲   needs: JB/AR sign-off on framework brief
        │                     │          BEFORE the 2026-06-29 holiday freeze
        │                     │          (Boldkast DRA map + 4 open questions)
        │                     └── 1.K dra-activity-framework — supplies
        │                          machine-readable DRA maps for the tagging pass
        │
        └───────────────► teacher report (1.G) durable read + research aggregation

1.A teacher-permission-model ✅ ──► 1.G-Ph3 analytics-chat skill (the lighter
                                     "chat to the data" path, shipped; complements,
                                     does not replace, the structured 2.5 rubric)
```

**The two human/long-pole dependencies** (not in engineering's control, so
tee them up first):

1. **JB/AR sign-off on the framework brief (R1, reframed)** — the framework
   direction settled 2026-06-03 as DRA-led (CPS+DRA from the earlier framing).
   What's still open is JB/AR confirmation of the Boldkast DRA map (4 DRAs
   proposed in the brief) and the four open questions at the end of the brief
   (appresent priority, "not reached" threshold, MAMCR research-track scope).
   Needed before the holiday freeze so the rubric can be built in the post-freeze
   window (2026-07-06 → 08-14).
2. **Per-skill taxonomy + plain-language labels (R2, R7)** — JB/AR author the
   misconception/DRA vocabulary per skill and the Danish/English label
   translations. Stable once written; the cost is the initial pedagogical pass.

If sign-off cannot land before the freeze, the fallback that keeps *some*
analysis live for the pilot is the **1.G-Ph3 analytics-chat skill** ("chat to the
data" over the 1.2 tables), which needs no framework commitment.

## Estimating discipline

These estimates are **doc + implementation time combined** for the
referenced design doc's first draft + a v1-quality implementation. Per
[CLAUDE.md](../../../CLAUDE.md) AIPLA Fork Context, the inherited template
already provides the heavy lifting (auth, streaming, skills framework,
budget Protocol, etc.) — each AIPLA doc above is *configuration plus
domain glue*, not a from-scratch build. If an estimate balloons past 2×
the value above, surface to the user before continuing.

## Timeline anchors

- **2026-05-19** — Repo forked. v0.1 design doc landed (this commit).
- **2026-05-27** — Jutland v0.1 demo (Wed).
- **2026-06-09** — 9 June teacher check-in; v1.1 batch grew to 1.1.25 (rows 1.1.20–1.1.25 landed).
- **2026-06-23** — **⚠ Bidirectional-voice target ([1.1.23](v1.1.0-feedback/bidirectional-voice-brief.md))** — the one date-forced 9-June item; architecture + GDPR + owner must lock by ~2026-06-11.
- **2026-06-26** — Mid-point review (Fri). v1 critical-path 1.1–1.5 should be at-or-near complete.
- **2026-06-29 → 07-05** — Holiday freeze week 27. No new merges.
- **2026-07-06 → 08-14** — v1 build (1.6–1.13). Strand B and C scoping kickoff.
- **2026-08-14** — Teacher pilot starts.
- **2026-09-15** — Final handover.
