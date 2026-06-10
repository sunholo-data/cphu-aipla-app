# v1.1.0-feedback Build Sequence

**Source briefs:** [`june-03-feedback-sprint-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md) — 3 June 2026 teacher check-in · [`june-09-feedback-sprint-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-09-feedback-sprint-brief.md) — 9 June 2026 teacher check-in (rows 1.1.20–1.1.25)
**Target window:** post-v1.0 / pilot-iteration (2026-06-04 → pilot start 2026-08-14, with continued iteration through 2026-09-15 handover)
**Parent roadmap:** [../SEQUENCE.md](../SEQUENCE.md)

This is the per-version sequence file for the **v1.1.0-feedback** batch. It began as nine items distilled from the 3 June teacher check-in (1.1.1–1.1.9), grew with voice/chat-polish/security follow-ups (1.1.10–1.1.19), and absorbed the **9 June teacher check-in** as rows **1.1.20–1.1.25** (see the *9 June teacher check-in batch* sub-table). The briefs are the source of pedagogical / product truth; the docs here add the repo-specific technical execution layer (file paths, wire shapes, ADR alignment, acceptance gates).

> **9 June headline:** the one date-forced item is **1.1.23 bidirectional voice (target 2026-06-23)**. Everything else in the 9-June batch is either a small Part-1 extension (1.1.20–1.1.22) or a post-mid-point Part-2 design doc gated on existing infra (1.1.24 on 1.J, 1.1.25 on 1.3).

> **v1.1, not v1.0.** Brief tags these as v1.1 priorities; they refine v1.0 surfaces rather than ship new strands. Many can land before the 2026-08-14 pilot, which is good — every item the pilot sees with confidence is one less thing the post-pilot iteration window has to absorb.

## Ordering

Brief priority is preserved; cross-cutting / blocking-dep ordering is noted in the dependency column.

> **Per-row build status (verified 2026-06-08): see [Build status](#build-status--verified-2026-06-08) below.** The inline "shipped" notes in the table rows are partial/stale; the Build status section is the authoritative source of done-vs-open, verified against code rather than doc placement.

| Order | Doc | Priority | Estimate | Dependencies / Gate | Notes |
|---|---|---|---|---|---|
| 1.1.1 | [tutor-verbosity-fix.md](implemented/tutor-verbosity-fix.md) — sprint: [quick-wins-v1.1-sprint.md](implemented/quick-wins-v1.1-sprint.md) (Track A) | **P0 IMMEDIATE** | ~2h | None | System-prompt-only delta across Boldkast, LED Planck, KineBot SKILL.md preambles. ≤3 sentences per turn unless explicitly asked; end every turn with a question. AR sign-off on the rewritten prompt block at PR review |
| 1.1.2 | [proactive-sim-reactive-tutor.md](implemented/proactive-sim-reactive-tutor.md) — sprint: [proactive-sim-reactive-tutor-sprint.md](implemented/proactive-sim-reactive-tutor-sprint.md) | **P1** | ~1d | [proactive-tutor.md](../v1.0.0-pilot/proactive-tutor.md) Phase A shipped; workbench-event stream from MCPAPP-SPEC | **Promotes / reshapes** the existing proactive-tutor Phase B (idle heartbeat → sim-event-reactive). Trigger on meaningful workbench events (sim run, step change, measurement commit) not slider drag. 90s cooldown, max 2 per session, short observation + question. Per-skill config. **Architecture (sprint plan, Path B):** FE-initiated AG-UI run via synthetic sentinel — backend owns the gate decision endpoint; FE kicks off the actual agent run via the existing `/api/chat/{skill_id}` AG-UI endpoint so the proactive turn rides the established protocol. Phase A's `/greet` REST shape becomes a follow-up refactor candidate after this lands |
| 1.1.3 | [student-consent-prompt.md](student-consent-prompt.md) | P1 | 0.5d FE + 0.5d BE | **JB sign-off on wording** (same approval gate as [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md)) | One-shot opt-in at session start. `consent_given: bool` on the session Firestore doc; declines → chat turns NOT written to BigQuery; teacher report shows `No research consent` badge. No change to ADR-001 anonymous-group auth |
| 1.1.4 | [session-report-summary-primary.md](session-report-summary-primary.md) | P1 | ~1d | None (teacher-insights-dashboard shipped) | Flip the session-report layout: AI summary primary; full transcript collapsed by default; CSV download for researcher use. Summary-generation prompt updated to produce 3-5 sentence narrative + concept/parameter/checklist bullets + "what next" line. Also the privacy strategy for eventual audio inclusion (summary has lower privacy profile than verbatim) |
| 1.1.5 | [researcher-role.md](researcher-role.md) | P1 | ~1d | [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) (1.A shipped) | New `role:researcher` Firebase custom claim; bypasses class-tag namespace; `--all-classes` flag on `aiplatform logs`; "Research view" toggle in teacher UI. Set manually by admin for JB, AR, M |
| 1.1.6 | [group-code-school-year-ttl.md](implemented/group-code-school-year-ttl.md) — sprint: [quick-wins-v1.1-sprint.md](implemented/quick-wins-v1.1-sprint.md) (Track B) | P1 | ~2h | [session-persistence.md](../v1.0.0-pilot/implemented/session-persistence.md) (1.F shipped) | **Rescoped 2026-06-03 mid-sprint.** Original "extend default to 300d" reshaped on privacy grounds (longer default = larger PII / consent surface on every code). This row now ships **rename** (`DEFAULT_TTL_DAYS` → `DEFAULT_GROUP_CODE_TTL_DAYS`, value stays 30) + **soft archival on expiry** (graceful 410 Gone; BQ rows retained). The per-code TTL choice moves to 1.1.10 below |
| 1.1.10 | [teacher-choice-ttl.md](teacher-choice-ttl.md) | P1 | ~0.5-1d | 1.1.6 (rename shipped); [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) (1.A shipped) | **New 2026-06-03** — split from 1.1.6. Teacher picks per-code TTL via preset dropdown (30/90/180/300d + custom 7-365d range) at group-code creation. Backend `mint_group(ttl_days=...)` already supports this; what's missing is route validation + teacher-UI form field + class-detail display + CLI `--ttl-days` parity. Preserves the brief's school-year ask as an opt-in per code rather than a platform-wide default |
| 1.1.7 | [student-multimodal-upload.md](student-multimodal-upload.md) | P1 | ~2d | ADR-008 (Gemini multimodal via AILANG Parse — ready); JB confirm on image-retention posture | **Was originally planned as 1.10** `multimodal-ingestion-via-ailang-parse.md` in the parent SEQUENCE — this doc supersedes that planned row. Most-requested student-facing item from 3 June. Paperclip upload, JPG/PNG/HEIC/PDF, image thumbnail in chat, Gemini multimodal call with image attached. Tutor handles handwritten diagrams, experimental-setup photos, draft answers per skill prompt |
| 1.1.8 | [exit-ticket.md](exit-ticket.md) | P1 | ~1d | **JB/AR providing the question set** | End-of-session modal with confidence emoji rating + free-text. Stored in Firestore session doc + BigQuery (`exit_ticket_rating`, `exit_ticket_text`, `exit_ticket_skipped`). Teacher session report shows the rating; researcher view aggregates |
| 1.1.9 | [cost-dashboard.md](cost-dashboard.md) | P1 | ~1d | [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (1.2 shipped — token counts already in BQ via OTel) | **Supersedes the originally-planned 1.12** `budget-dashboard.md`. Teacher class-detail "Budget" panel: this-month spend, per-activity / per-group breakdown, projected monthly. Researcher cross-class spend. Priority lifted by DK's Indian cohort scaling to ~100s of students |
| 1.1.11 | [voice-provider-abstraction.md](implemented/voice-provider-abstraction.md) — sprint: [voice-provider-abstraction-sprint.md](implemented/voice-provider-abstraction-sprint.md) | P1 | ~3.5-4d (Phase A ~1.75d + Phase B ~1.5-2d) | [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) (Part 1 shipped); 1.1.9 cost-dashboard for span surfacing; 1.G teacher UI for per-class toggle; 1.1.2 proactive-sim-reactive (auto-read toggle picks up proactive turns automatically) | **New 2026-06-03** — voice quality flagged today (choppy macOS Danish "Sara") + dictation requested as "lesson ease" accessibility upgrade. Server-side `TTSProvider`/`STTProvider` Protocols in `backend/voice/`, Cloud TTS (Standard spike → WaveNet upgrade) for Danish read-aloud + Cloud STT `latest_long` for Danish dictation, browser-native stays as default provider. Per-class teacher opt-in for the mic button. **Auto-read toggle**: student-side preference to auto-speak every assistant message (incl. proactive turns from 1.1.2) vs current click-to-read default. Designed swap-shaped (cloud → server-local → self-hosted Whisper on UCPH GPU per ADR-003 four-tier model). Defers Gemini Live / LiveRunner to a future conversational-tutor doc. **Phase A (TTS) ships independently** — fixes today's Sara issue without waiting for Phase B |
| 1.1.12 | [voice-personas.md](voice-personas.md) | P2 | ~3d | [voice-provider-abstraction.md](implemented/voice-provider-abstraction.md) (1.1.11 shipped 2026-06-04); 1.G teacher class-detail page for picker placement; optional 1.1.9 cost-dashboard for per-persona spend split; optional 1.1.5 researcher-role for `?debug=voice` without query param | **New 2026-06-04** — UX polish over 1.1.11. Teacher review found the technical voice picker ("gcp_chirp3hd / da-DK-Chirp3-HD-Aoede") opaque to non-engineers. New `Persona` model bundles avatar + name + title + language + voice; teachers pick a persona card instead of tier+voice dropdowns. Chat bubble shows persona avatar + name; new friendly status pill replaces the technical debug pill (technical mode behind `?debug=voice`). 4-6 default personas (Aoede/Charon/Kore/Puck/Frida/Daniel) ship as YAML in `backend/personas/`. Existing 1.1.11 raw voice config stays as "Custom voice (advanced)" expander. Net +7 axiom score; +1 USABLE BY DESIGN explicit win |
| 1.1.13 | [implemented/sim-onboarding-ergonomics.md](implemented/sim-onboarding-ergonomics.md) — sprint: [implemented/sim-onboarding-ergonomics-sprint.md](implemented/sim-onboarding-ergonomics-sprint.md) **shipped 2026-06-04** | **P1** | ~0.75d | [implemented/proactive-sim-reactive-tutor-sprint.md](implemented/proactive-sim-reactive-tutor-sprint.md) shipped | **Shipped 2026-06-04** — follow-up to 1.1.2. PROACTIVE-SIM-REACTIVE shipped over several iteration loops because per-artefact frames used an **allowlist** filter ("explicitly route each kind") which silently dropped multi-word hyphenated kinds (`kinebot.sim-run`, `led-planck.auto-run`) — proactive turns silently never fired. Inverts to **denylist** via new `useArtefactReportEvent` hook (drop noisy kinds, forward everything else with default-through `{kind}` shape). Refactored Boldkast / LED Planck / KineBot frames. 23 new vitest cases (8 unit + 7+10+6 integration) pin the regression bar. Hardened `_sim-template/` scaffold + cross-linked `mcp-app-artefact` skill so future sims (Pendul, Kredsløb, Videoanalyse, GPS Fart, Frekvensanalysator) onboard mechanically |
| 1.1.14 | [implemented/chat-history-flicker-on-token-refresh.md](implemented/chat-history-flicker-on-token-refresh.md) — sprint: [implemented/chat-history-flicker-on-token-refresh-sprint.md](implemented/chat-history-flicker-on-token-refresh-sprint.md) **shipped 2026-06-04** | **P1** | ~2-3h | [session-persistence.md](../v1.0.0-pilot/implemented/session-persistence.md) (1.F shipped) + Vertex Agent Engine session backend (Decision 13 in [bootstrap-aipla-dev.NOTES.md](../../../../scripts/bootstrap-aipla-dev.NOTES.md)) | **Shipped 2026-06-04** — student-reported chat-bubble flicker (history disappears for ~400 ms then reappears) traced to `AGUIProvider` unmounting its subtree on Firebase ID-token refresh. Bug exists in the inherited template but is masked there by sub-50 ms in-region Agent Engine reads; surfaced on AIPLA by the cross-region (europe-north1 ↔ europe-west1) Vertex hop. Frontend-only fix: `hadTokenOnceRef` + gate `tokenResolved` blanking on **initial** load only, not on every `user`-ref change. 11 LOC impl + 3 new vitest cases in AGUIProvider + 1 defensive vitest in useSessionMessages. Filed as [upstream-feedback.md entry #31](../../../upstream-feedback.md) for the template |
| 1.1.15 | [implemented/chat-svg-streaming-placeholder.md](implemented/chat-svg-streaming-placeholder.md) — sprint: [implemented/chat-svg-streaming-placeholder-sprint.md](implemented/chat-svg-streaming-placeholder-sprint.md) **shipped 2026-06-04** | P2 | ~1.5h | None | **Shipped 2026-06-04** — student-reported SVG diagram flicker as the closing `</svg>` token arrives. Cause: `ChatMarkdown`'s pre-processor only matches a complete `<svg…</svg>`, so the partial is stripped via the `html()` handler until the closing tag arrives — at which point a 160 px placeholder appears suddenly (vertical jump), then the SVG fills it after DOMPurify resolves. Fix: added a tail-regex (`SVG_STREAMING_TAIL_RE`) that detects an open `<svg` without a close, reserves the same 160 px placeholder immediately. When `</svg>` lands, React reconciles the placeholder in-place with the rendered SVG — no second jump. 25 LOC impl + 5 new vitest cases (~100 LOC) in `ChatMarkdown.test.tsx`. Shared `SvgStreamingPlaceholder` export from `SVGBlock` keeps dimensions identical across the streaming/post-sanitise states |
| 1.1.16 | [security-monitoring-pipeline.md](implemented/security-monitoring-pipeline.md) — sprint: [implemented/security-monitoring-pipeline-sprint.md](implemented/security-monitoring-pipeline-sprint.md) **shipped 2026-06-05** | P1 | ~6h (M1+M2+M5 critical path, M3+M4 layered same-day) | None — additive on existing `ci.yml` | **Shipped 2026-06-05** — Prompted by the 20-alert dependabot pile (commits `084920b` + `1257c08` patched all 20). Three-layer pipeline now live: (1) `security-audit` job in [ci.yml](../../../../.github/workflows/ci.yml) runs `scripts/security-check.sh` (the single source of truth for the gate); fails PRs on new HIGH/CRITICAL production-dep CVEs. (2) [security-weekly.yml](../../../../.github/workflows/security-weekly.yml) cron Mon 09:00 UTC updates a rolling tracking issue with audit + dependabot summary. (3) [aipla-security-checkup skill](../../../../.claude/skills/aipla-security-checkup/SKILL.md) encodes the reachability rubric. Side effect of the sprint: closed 13 newly-discovered backend Python CVEs (litellm bump to 1.85.4, aiohttp/idna/mako/pyjwt/python-multipart/urllib3/authlib bumps via `uv lock --upgrade-package`) + 3 frontend high CVEs (undici→7, fast-uri→3.1.2, fast-xml-builder→1.2.0 via overrides). 1 documented ignore (starlette PYSEC-2026-161, blocked by fastapi<1.0.0). Frontend 911 tests + backend 1761 tests pass. Net axiom score +4 (SECURE BY CONSTRUCTION, EARNED TRUST, OBSERVABLE BY DEFAULT, PROTOCOL OVER CUSTOM all +1) |
| 1.1.17 | [student-engagement-signals.md](student-engagement-signals.md) | **P2** | ~1.5d | [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (1.2 shipped); 1.1.3 consent; 1.1.4 session-report surface; 1.1.5 researcher cohort view; JB/AR review of metric set + framing copy | **New 2026-06-06** — formative-not-sanctionary engagement signals on the teacher session report (paste ratio, revision count, turns-to-completion, abandonment point, re-ask rate). Framing is explicit: cohort signals → "rewrite problem N", not per-student sanction. Origin: 2026-06-05 chat with M re: anti-cheat — agreed *if the student is trying to cheat the battle is already lost*; instead these signals surface where the lesson needs improvement. Captures composition counts (not the keystream) FE-side, re-uses existing embedding for re-ask scoring BE-side, extends `chat_turns` BQ table with 4 columns + adds session-level aggregates to Firestore. Researcher view (per 1.1.5) gets a per-class "Engagement" tab with per-problem heatmap — the headline view for turning signals into actionable rewrites. Sits thematically near 1.1.4 (session report) and 1.1.9 (cost dashboard) on the teacher dashboard improvements axis |
| 1.1.19 | [teacher-activity-authoring.md](teacher-activity-authoring.md) | **P1** | ~6–8d full / ~1.5d M0 thin slice | [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) (Ph2 ActivityConfig shipped); [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) (1.J); **JB/AR on quiz format (M2) + first workbench type (M4)** | **New 2026-06-08** — the umbrella for *"teacher creates activities from scratch, non-sim first class"* — recorded as **the primary design priority in the 3 June check-in** (scoping site `strands.qmd`). Unifies the three authoring tiers (tier-1 forms shipped; tier-2 params + tier-3 code are the post-pilot stubs) and fills two gaps: teacher-authorable **non-sim activities** (quiz/notebook/drawing/none) via **A2UI**, and a **teacher-authored declarative MCQ** quiz (distinct from KineBot's tutor-driven adaptive quiz). MCP Apps stay the rail for complex sims (ADR-013). Extends `ActivityConfig` with `workbench_type`/`checklist`/`quiz`/`materials`; generalizes the shipped `ProgressChecklist`. **9 June adds M6 (equipment co-design) + the curriculum-library `materials` picker (split to 1.1.25).** **Aggressive v1.1 target, phased** — M0 (no-workbench concept activity, ~1.5d) lands pre-freeze and is independently valuable; M1–M6 are individually shippable through pilot iteration. Realism: largest open item, competes with the other P1s + freeze — phasing is the descope discipline |

### 9 June teacher check-in batch (added 2026-06-09)

Source: [`june-09-feedback-sprint-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-09-feedback-sprint-brief.md) + [`notes/2026-06-09-curriculum-content-uses.md`](file:///Users/mark/Documents/clients/cph-uni/notes/2026-06-09-curriculum-content-uses.md). Part 1 (§1–3) extends shipped/in-flight work; Part 2 (§A–C) are new design docs; Part 2 §D (friction/timing analytics) is **R1-gated** (analytics-framework decision due before the 29 June freeze) and is **not** a new app row — it folds into [`teacher-analytics-framework`](../post-pilot/session-analytics-rubric.md) / 2.5 once R1 lands. **The one urgent new date is 1.1.23 (bidirectional voice, 2026-06-23).**

> **Prioritisation lens — breadth over depth (9 June meeting; memory `aipla-breadth-over-depth`).** Year 1 favours **coverage of the interface possibility-space over depth/polish on any single feature** — many thin probes, not a few deep builds. Read the batch through it: 1.1.20 personas, 1.1.22 notes-summary, 1.1.23 voice modes, 1.1.24 offline-lab are each **new-interface probes** (good for breadth); **1.1.25 curriculum-library is the breadth *multiplier*** — it drops the marginal cost of every new activity (grounding + rubric + level-calibration for free). Two curriculum uses are **pulled forward** because they *operationalise* the strategy: **auto-drafted rubrics (#4)** keep each probe measurable, and the **coverage/gap map (#6)** says where to probe next (these live in 1.1.19 M7/M8, sourced from 1.1.25).

| Order | Doc | Priority | Estimate | Dependencies / Gate | Notes |
|---|---|---|---|---|---|
| 1.1.20 | [tutor-personas.md](tutor-personas.md) | **P1** | ~1d | [tutor-verbosity-fix.md](implemented/tutor-verbosity-fix.md) (1.1.1 — Socratic preset generalized); **AR sign-off per preset prompt**; rides 1.1.19 activity-config surface | **New 2026-06-09 (§3)** — per-activity teaching-style presets (Socratic default / concise-directive / rigorous "hardcore" / warm). **Resolves the apparent 1.1.1-vs-9-June conflict**: "end every turn with a question" is the *Socratic preset*, not a global law. Field `interaction_style` — deliberately named to avoid the 1.1.12 `persona` (voice/avatar) collision; the two are orthogonal axes. Gated only on AR prompt sign-off |
| 1.1.21 | folded into [student-multimodal-upload.md](student-multimodal-upload.md) (1.1.7) | **P1** | ~1d + ~2h | **1.1.7 must land first**; **M (GDPR)** on guardrail detection approach (on-device vs Gemini-vision pre-check) | **New 2026-06-09 (§1)** — no-person-in-frame guardrail (pre-upload notice + person/face block-and-retake) + units loop ("what are the units?" before other feedback). Keeps uploads' consent profile low (concern is *only* a person in frame). Extends the 1.1.7 doc rather than a new doc; tracked here for sequencing |
| 1.1.22 | [end-of-class-notes-summary.md](end-of-class-notes-summary.md) | **P1** | ~1d (on top of 1.1.7 + 1.1.8) | **1.1.7 (upload) + 1.1.8 (exit ticket)** + 1.K DRA goals; JB note-retention (reuse 1.1.7) | **New 2026-06-09 (§2)** — no-laptop reality: student photographs handwritten notes at class end → AI summary measured against the activity's learning goals (captured / missing / one revisit). Composes 1.1.7 path + 1.1.8 surface; formative, non-retained, shared-phone |
| 1.1.23 | [bidirectional-voice-brief.md](bidirectional-voice-brief.md) | **P1 — URGENT (target 2026-06-23)** | axis ~0.5d + per mode: `stt_tts_roundtrip` ~0.5–1.5d, `gemini_live` ~3–5d | **1.1.11 voice-provider-abstraction (shipped)**; **M per-mode GDPR + JB first-enabled mode — resolve immediately**; ADR-003/005/007 | **New 2026-06-09 (§C) — the one urgent new date.** Sound in AND out as a **swap-shaped `voice_mode` config axis** (same pattern as ADR-003 model tiers): **`gemini_live` (duplex/LiveRunner) and `stt_tts_roundtrip` (turn-based over shipped 1.1.11) are coexisting mode *options*, not a pick-one build.** Ships the axis + ≥1 mode for the date (`stt_tts_roundtrip` certain; `gemini_live` enabled by config when LiveRunner + audio review land). GDPR gate lives **on the mode** (`gemini_live` = full audio review), not the axis |
| 1.1.24 | [offline-lab-workbench.md](offline-lab-workbench.md) | **P1** | ~3–4d | [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) (1.J Type 5 lab-notebook); 1.1.19 (`notebook` activity); [curriculum-library.md](curriculum-library.md) (procedure PDFs); **JB/AR ground-truth model + 2 real experiments** | **New 2026-06-09 (§B)** — Haka/matematikfysik labs are offline PDFs: teacher sets up the experiment, students run it physically + enter readings, AI checks entered data for mistakes in chat. **Crux: teacher-supplied ground truth (ranges/relationships); the AI never invents expected values** (anti-hallucination eval = ship gate). Deterministic-check-first, model-explains-second. Post-mid-point build |
| 1.1.26 | [teacher-ui-consolidation.md](teacher-ui-consolidation.md) | **P1 — enabler** | ~5–7d phased (P1 primitives ~1.5d first) | None (frontend-only; no API change) | **New 2026-06-09 (M)** — the teacher surface is a *mess of configs* accreted page-by-page (716-LOC class page, 3 parallel analytics surfaces, half-stub builder tabs, no nav); make it as simple/polished as the student UI. Ships a **teacher design system + IA + progressive-disclosure config pattern** so each new config is a one-line `SettingRow`, not a bespoke panel. **A breadth multiplier on the teacher side** — lowers the cost of every future teacher config. **P1 (primitives) should precede the config-heavy 9-June rows** (personas/voice/TTL/budget/quiz) so they land clean, not into the mess + refactor twice |
| 1.1.25 | [curriculum-library.md](curriculum-library.md) | **P1 — breadth multiplier** | ~3–4d (**ADK RAG — no vector-DB build**) | **ADK RAG (managed) — un-gated from pgvector (2026-06-09)**; ADR-004 (AILANG Parse) + ADR-010; **JB/M copyright clearance** for shared corpus; B/C corpus parsed (base note) | **New 2026-06-09 (§A library half + `curriculum-content-uses` note)** — referenceable A/B/C corpus (uvm.dk + uploads). **One store, 11 uses** (citation, currency, rubrics #4, level-cal #5, coverage-map #6, exam-format #7, equipment-match #8, misconception #9, terminology #10, eval domain #11). **The breadth multiplier**: drops the marginal cost of every new activity. **Retrieval backend swap-shaped: ADK RAG now, pgvector/local as Year-2 migration** — so this is *no longer blocked on 1.3* and can land much earlier/cheaper. #4/#5/#6 logic lives in 1.1.19 (M7/M8); this is their source. Split out of 1.1.19; co-design stays 1.1.19 M6. ACL deny-by-default, copyright-gated. 2010 exam archive stays **out** (Strand C) |

## Build status — verified 2026-06-08

Verified by code inspection on 2026-06-08 (not by doc placement, which lags). Legend: **SHIPPED** (in `dev`, evidence cited) · **PARTIAL** · **OPEN** (designed, not built).

| Row | Item | Status | Evidence / still-to-do |
|---|---|---|---|
| 1.1.1 | tutor-verbosity-fix | **SHIPPED** | SKILL.md constraint blocks across 3 tutors + pytest guard (QUICK-WINS-V11, `9d03c61`) |
| 1.1.2 | proactive-sim-reactive-tutor | **SHIPPED** | `/proactive-event-check` gate + FE sentinel, M1–M10 (2026-06-03) |
| 1.1.3 | student-consent-prompt | **OPEN** | no `consent_given` in code. Gated on JB wording |
| 1.1.4 | session-report summary-primary | **OPEN** | report page exists (`teacher/reports/groups/[groupId]`); layout-flip + summary-prompt rewrite not done |
| 1.1.5 | researcher-role | **OPEN** | no Firebase claim, no `--all-classes` flag, no Research-view toggle |
| 1.1.6 | group-code-ttl rename + archival | **SHIPPED** | `DEFAULT_GROUP_CODE_TTL_DAYS` + 410-on-expiry (QUICK-WINS-V11) |
| 1.1.7 | student-multimodal-upload | **OPEN** | most-requested student feature; gated on JB image-retention posture |
| 1.1.8 | exit-ticket | **OPEN** | gated on JB/AR question set |
| 1.1.9 | cost-dashboard | **OPEN** | no BudgetPanel; BQ token data already present via OTel |
| 1.1.10 | teacher-choice-ttl | **OPEN** | backend `mint_group(ttl_days)` pre-existed; route-validation + teacher-UI form field + CLI `--ttl-days` not built |
| 1.1.11 | voice-provider-abstraction | **SHIPPED** | `backend/voice/` (base, providers/, registry, cache, cost) |
| 1.1.12 | voice-personas | **PARTIAL** | `VoiceStatusPill` shipped; Persona model + persona-card picker + `backend/personas/` YAML not built |
| 1.1.13 | sim-onboarding-ergonomics | **SHIPPED** | `useArtefactReportEvent` denylist (2026-06-04) |
| 1.1.14 | chat-history-flicker-on-token-refresh | **SHIPPED** | AGUIProvider gate fix (2026-06-04) |
| 1.1.15 | chat-svg-streaming-placeholder | **SHIPPED** | `SVG_STREAMING_TAIL_RE` (2026-06-04) |
| 1.1.16 | security-monitoring-pipeline | **SHIPPED** | ci.yml `security-audit` + weekly cron + skill (2026-06-05) |
| 1.1.17 | student-engagement-signals | **OPEN** | design-only (2026-06-06); no BQ `paste_ratio`/`revision_count` columns. Gated on JB/AR metric review |
| 1.1.18 | voice-pronunciation-config | **SHIPPED** | `frontend/src/lib/voice-pronunciation/` — see Numbering note below |
| 1.1.19 | teacher-activity-authoring | **OPEN** | design-only (2026-06-08). Umbrella for non-sim teacher activity creation; aggressive v1.1, phased (M0 ~1.5d pre-freeze). M2 quiz / M4 workbench-type gated on JB/AR. **M6 equipment co-design + curriculum `materials` picker added 2026-06-09** |
| 1.1.20 | tutor-personas | **SHIPPED (core)** | 2026-06-10 — `interaction_style` field (socratic default / concise / rigorous / warm) end-to-end: override-preamble injection in the agent chain (socratic = passthrough, zero regression) + builder picker. Commits `d1015c1` + `5eb6d0a`; 8 BE + 1 FE tests. **Follow-ups:** AR's final concise/rigorous/warm wording, OTel `tutor.interaction_style`, socratic SKILL.md extraction. A persona (1.1.12) will resolve down to this field |
| 1.1.21 | multimodal guardrail + units loop | **OPEN** | design-only (2026-06-09); folded into 1.1.7 doc. Blocked behind 1.1.7 landing + M GDPR call on detection approach |
| 1.1.22 | end-of-class-notes-summary | **OPEN** | design-only (2026-06-09). Composes 1.1.7 + 1.1.8; sequenced after both |
| 1.1.23 | bidirectional-voice-brief | **OPEN — URGENT** | brief-only (2026-06-09). **Target 2026-06-23.** Blocking: A/B architecture + GDPR delta + owner (M/JB) — resolve immediately |
| 1.1.24 | offline-lab-workbench | **OPEN** | design-only (2026-06-09). Gated on JB/AR ground-truth model + 2 real experiments; depends on 1.J Type 5 |
| 1.1.25 | curriculum-library | **OPEN** | design-only (2026-06-09). **ADK RAG (managed) — un-gated from pgvector**; JB/M copyright clearance for shared corpus; B/C corpus parsed |
| 1.1.26 | teacher-ui-consolidation | **SHIPPED (P1–P5)** | 2026-06-09 — full foundation: P1 primitives (`components/teacher/ui/`), P2 by-breakpoint nav (`TeacherNav`), P3 class-detail onto primitives + "Class settings", P4 real Activities library, P5 Insights unification (`InsightsTabs`). Commits `6bb33af`→`d4692ee`; 958 FE tests. **Builder Essential/Advanced section-model intentionally deferred** to when its config features (1.1.20/1.1.23) are built into it |

**Tally (incl. 9 June batch): 11 SHIPPED · 1 PARTIAL · 14 OPEN.** (1.1.26 + 1.1.20 shipped 2026-06-09/10.)

### Still to do (priority order)

**⚠ Urgent / time-boxed (resolve this week):**

0. **1.1.23 bidirectional voice — TARGET 2026-06-23.** It is a **swap-shaped `voice_mode` config axis** (`gemini_live` + `stt_tts_roundtrip` as coexisting mode options, ADR-003 pattern), not a pick-one build. Decision-blocked, not engineering-blocked: M gives the **per-mode GDPR posture**, JB picks the **first-enabled mode**. The axis + `stt_tts_roundtrip` guarantee something live; `gemini_live` slots in by config when LiveRunner + the audio review land. 14 days out.

**Human-gated** (tee up first — engineering can't unblock):

1. 1.1.3 consent prompt — JB wording
2. 1.1.7 multimodal upload — JB image-retention posture **+ 1.1.21 guardrail: M (GDPR) on on-device vs Gemini-vision person detection**
3. 1.1.8 exit-ticket — JB/AR question set
4. 1.1.17 engagement signals — JB/AR metric set review
5. 1.1.19 teacher-activity-authoring — M2 quiz format + M4 first workbench type (JB/AR); **M0 is not gated**
6. **1.1.20 tutor-personas — AR sign-off on each preset prompt (concise / rigorous / warm); Socratic is the signed 1.1.1 block**
7. **1.1.24 offline-lab-workbench — JB/AR ground-truth model + 2 real Haka/matematikfysik experiments to model the spec**
8. **1.1.25 curriculum-library — JB/M copyright clearance for the shared A/B/C corpus (aligns with the Strand-C exam-archive thread)**
9. **Part 2 §D (friction/timing analytics) — R1 analytics-framework decision (due before the 2026-06-29 freeze).** Not an app row; folds into 2.5 / teacher-analytics-framework once R1 lands. **Do not instrument friction/timing before R1.**

**No human dependency** (can start now):

- **1.1.26 teacher-UI-consolidation P1 (design-system primitives)** — frontend-only, ~1.5d. **DECIDED FIRST (M, 2026-06-09): a hard prerequisite, not soft** — "in place first before we add more complexity to it." P1 + the class-detail (P3) + builder (P4) refactors land **before** the config-heavy rows (personas 1.1.20, voice 1.1.23, TTL 1.1.10, budget 1.1.9, quiz/materials 1.1.19 M2–M8) so each new config slots into the pattern, not the old mess (no refactor-twice).
- **1.1.19 teacher-activity-authoring M0** — no-workbench concept activity, end-to-end (~1.5d, lands pre-freeze; the 3-June headline ask). **M0+M1 already shipped (commits 3f65f97 → baeaae5).**
- 1.1.4 session-report summary-primary (~1d)
- 1.1.9 cost-dashboard (~1d)
- 1.1.5 researcher-role (~1d)
- 1.1.10 teacher-choice-ttl (~0.5–1d)
- 1.1.12 voice-personas — finish Persona model + cards (~2d remaining)
- **1.1.22 end-of-class-notes-summary** (~1d) — *but sequence after 1.1.7 lands* (composes its upload path)

**Sequencing note:** 1.1.24 offline-lab depends on 1.J (Type 5) so stays **post-mid-point**. 1.1.25 curriculum-library was *de-gated 2026-06-09* — on **managed ADK RAG** (not pgvector) it no longer waits on 1.3, so it (and its M7/M8 pull-forwards) can land earlier; the only remaining input is the B/C corpus being parsed + copyright clearance. 1.1.20–1.1.22 are small and interleave with the existing P1s before the freeze; 1.1.23 is the only date-forced item.

### Numbering note (1.1.14 collision)

Commits `18f382e` / `62c9205` registered **voice-pronunciation-config** as 1.1.14, but the ordering table later assigned 1.1.14 to **chat-history-flicker-on-token-refresh**. Resolved here: chat-history-flicker keeps **1.1.14** (matches the table); voice-pronunciation-config becomes **1.1.18**.

### Doc-location hygiene (follow-up — not done in this pass)

Per the Cross-version convention below, these SHIPPED design docs should move to `implemented/` alongside their sprints: `tutor-verbosity-fix`, `proactive-sim-reactive-tutor`, `group-code-school-year-ttl`, `voice-provider-abstraction` (+sprint), `voice-pronunciation-config`, `security-monitoring-pipeline`. Deferred deliberately: each is referenced by 3–8 docs at differing relative depths (plus pre-existing rot from the sprint docs already moved without inbound-link updates), so the relocation is a dedicated link-migration pass, not part of a status fix. Tracked as the next hygiene task.

## What's gated on human input

Tee these up first — engineering can't unblock them:

1. **JB sign-off on consent prompt wording** ([1.1.3](student-consent-prompt.md)) — gates the chat-log opt-in shipping
2. **JB/AR question set for the exit ticket** ([1.1.8](exit-ticket.md)) — gates the modal shipping
3. **AR sign-off on the verbosity-trimmed system prompt** ([1.1.1](implemented/tutor-verbosity-fix.md)) — gates the prompt change merge
4. **JB confirm on image-retention posture** ([1.1.7](student-multimodal-upload.md)) — gates multimodal upload; brief states "images sent to Gemini, not retained in BQ" but needs explicit JB OK

**Added 2026-06-09 (9 June batch):**

5. **M/JB — bidirectional voice: per-mode GDPR + first-enabled mode** ([1.1.23](bidirectional-voice-brief.md)) — **time-boxed to 2026-06-23**; the most urgent gate in the batch. M: per-mode posture (`gemini_live` = full audio review, `stt_tts_roundtrip` = delta); JB: which mode demos first. Not "who owns a build" — it's a config axis. Resolve today.
6. **M (GDPR) — person-detection approach** for the upload guardrail ([1.1.21](student-multimodal-upload.md)) — on-device (no pre-check egress) vs Gemini-vision pre-check
7. **AR — per-preset persona prompts** ([1.1.20](tutor-personas.md)) — `concise` / `rigorous` / `warm` wording (Socratic = the signed 1.1.1 block)
8. **JB/AR — offline-lab ground-truth model + 2 real experiments** ([1.1.24](offline-lab-workbench.md)) — confirms "ranges + relationships, no symbolic-math engine" and seeds the anti-hallucination spec
9. **JB/M — curriculum-corpus copyright clearance** ([1.1.25](curriculum-library.md)) — only `cleared` material enters the shared A/B/C library; same thread as the Strand-C 2010 exam archive
10. **R1 analytics-framework decision** (ICAP+FCI vs CPS+DRA), due before the 2026-06-29 freeze — gates Part 2 §D friction/timing analytics (not an app row; folds into 2.5)

Items with **no human dependency** can start immediately (see *Still to do → No human dependency*).

## Items that can ship in parallel

The dependency graph is shallow — most of these are independent surfaces:

```
Independent (start any time, in any order):
  1.1.1 verbosity         (2h)   ───┐
  1.1.2 sim-reactive      (1d)   ───┤
  1.1.4 summary primary   (1d)   ───┼─► no blockers; parallelisable
  1.1.5 researcher role   (1d)   ───┤
  1.1.6 TTL extension     (2h)   ───┘

Human-gated:
  1.1.3 consent prompt    (1d)    ◄── JB wording approval
  1.1.8 exit ticket       (1d)    ◄── JB/AR question set

Larger / more cross-cutting:
  1.1.7  multimodal upload         (2d)   ◄── ADR-008 ready; JB image-retention confirm
  1.1.9  cost dashboard            (1d)   ◄── 1.2 BQ tables shipped; uses existing OTel
  1.1.11 voice provider abstraction (3.5-4d) ◄── 1.0 TTS shipped; 1.1.2 proactive (auto-read picks up); 1.1.9 spans; 1.G toggle
  1.1.12 voice personas             (3d)   ◄── 1.1.11 shipped; 1.G picker placement; optional 1.1.9 + 1.1.5
  1.1.14 voice pronunciation config (1d)   ◄── 1.1.11 shipped; cc8507f inline list to extract; ships in parallel with 1.1.12
```

## Items the brief explicitly excluded (future)

From the brief's "Not in this brief" section — captured here so they don't get lost:

| Item | Why not now | Where it goes |
|---|---|---|
| Bidirectional voice (student speaks → STT → tutor responds) | Significant UX change; needs a research angle baked in | Separate post-v1.1 sprint; partly overlaps [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) |
| Teacher activity creation from scratch (Parameters tab scope expansion) | Significant feature — beyond bounded knobs | Separate design doc; overlaps [post-pilot/teacher-artefact-parameters.md](../post-pilot/teacher-artefact-parameters.md) |
| Activity branching / marketplace | Needs ≥10 activities to be useful | Separate sprint, post-pilot |
| Oral exam prep skill | New skill brief — DRA map per topic + voice mode | New skill brief in scoping site |
| Student note-taking skill | New skill brief | New skill brief in scoping site |
| Portfolio download | Depends on [1.1.6](implemented/group-code-school-year-ttl.md) school-year TTL shipping first | Small follow-up sprint after 1.1.6 |
| Proactive cooldown event-banking | Tutor references the SEQUENCE of student actions during cooldown ("you tried 30°, 45°, 60° in the last 30s"), not just the latest. v1.1 ships with state-aware-but-not-history-aware reactive turns. Validate need from pilot session reviews first | [cooldown-event-banking.md](cooldown-event-banking.md) — roadmap signal, not committed |

## Total estimate

| Bucket | Engineering days |
|---|---|
| Quick wins (1.1.1, 1.1.6) | ~0.5d |
| Standard (1.1.2, 1.1.3, 1.1.4, 1.1.5, 1.1.8, 1.1.9, 1.1.10) | ~6.5-7d |
| Larger (1.1.7, 1.1.11) | ~5.5-6d |
| Polish (1.1.12, 1.1.14) | ~4d |
| 3-June batch subtotal | **~16.5-17.5d** |
| **9-June Part 1** (1.1.20 personas ~1d, 1.1.21 guardrail+units ~1.25d, 1.1.22 notes-summary ~1d) | ~3.25d |
| **9-June urgent** (1.1.23 `voice_mode` axis ~0.5d + `stt_tts_roundtrip` ~0.5–1.5d; `gemini_live` mode +~3–5d when enabled) | ~1–2d for the date; +3–5d for the live mode |
| **9-June Part 2** (1.1.24 offline-lab ~3-4d *post-mid-point, on 1.J*; 1.1.25 curriculum-library ~3-4d *ADK RAG — un-gated, can land earlier*) | ~6-8d |
| **Breadth pull-forwards** (1.1.19 M7 auto-rubrics ~2d + M8 coverage-map ~1-1.5d) — *consume 1.1.25; high-value-as-unblocked* | ~3-3.5d |
| **Total (incl. 9-June batch)** | **~30-36d** |

The 3-June subtotal comfortably fit the window. The 9-June batch adds **~14-18d**, of which only Part 1 (~3.25d) + the urgent 1.1.23 axis+cheap-mode (~1-2d) target the pre-freeze / pre-pilot window; the Part-2 docs + breadth pull-forwards (~9-11.5d) are **post-mid-point, gated on 1.J + 1.3**, and absorb into 2026-07-06 → 08-14 + pilot iteration. The batch does **not** fit before the freeze in full — Part 1 + 1.1.23 are the realistic pre-freeze slice. **Under breadth-over-depth, the curriculum multiplier (1.1.25) + its pull-forwards (M7/M8) are the highest-leverage post-freeze work** — they make every subsequent probe cheaper.

## Timeline anchors

- **2026-06-03** — Brief delivered (3 June teacher check-in)
- **2026-06-04** — v1.1 design docs landed
- **2026-06-09** — 9 June teacher check-in; batch 1.1.20–1.1.25 design docs landed (this commit)
- **2026-06-23** — **⚠ Bidirectional-voice target (1.1.23)** — the one date-forced item; ahead of the freeze. Architecture + GDPR + owner must be locked by ~2026-06-11 to hold it
- **2026-06-26** — Mid-point review; quick wins (1.1.1, 1.1.6) shipped, 1.1.19 M0+M1 shipped, ≥1 larger item in flight
- **2026-06-29 → 07-05** — Holiday freeze. R1 analytics decision must land before this (gates Part 2 §D)
- **2026-07-06 → 08-14** — v1.1 build window (post-freeze, pre-pilot). Part-2 docs 1.1.24 (offline-lab, after 1.J) + 1.1.25 (curriculum-library, after 1.3) build here
- **2026-08-14** — Pilot starts; ideally 1.1.1–1.1.6 + 1.1.9 + 1.1.20–1.1.23 live
- **2026-08-14 → 09-15** — Pilot iteration window for remaining items + portfolio-download follow-up

## Sprint status — historical sprint narrative (2026-06-03)

> **Superseded for status-tracking** by [Build status — verified 2026-06-08](#build-status--verified-2026-06-08) above. Retained below for the QUICK-WINS-V11 / PROACTIVE-SIM-REACTIVE sprint detail (test counts, recon findings).

**Shipped (merged to `dev`):**

- ✓ **QUICK-WINS-V11** — 1.1.1 verbosity + 1.1.6 rename-and-archival bundled sprint. Track A: 3 commits (constraint block in 3 SKILL.md files; pytest regression guard; slow-marked LLM smoke). Track B: 3 commits (constant rename, archive-on-expiry + 410 Gone, value-revert to 30d after mid-sprint privacy rethink). Plus M7 archival integration tests (3 cases). Shipped 2026-06-03 at `9d03c61`. Sprint doc moved to [implemented/quick-wins-v1.1-sprint.md](implemented/quick-wins-v1.1-sprint.md). Backend test count went 1637 → 1645 (+8 net).
  - **Mid-sprint rescope**: original 1.1.6 plan to lift platform default 30d→300d was reshaped on privacy grounds. Default stays 30d; the per-code teacher-choice path becomes [1.1.10 teacher-choice-ttl.md](teacher-choice-ttl.md). Both 1.1.6 design doc and v1.1 SEQUENCE updated to reflect this.
- ✓ **PROACTIVE-SIM-REACTIVE** — 1.1.2 sim-event-reactive tutor (Phase B, Path B confirmed). 10 milestones M1–M10 shipped same-day 2026-06-03. Backend test count went 1645 → 1695 (+50 net: 7 from M2 SkillConfig fields, 7 from M3 inject_reactive_guidance, 2 from M4 session counters, 16 from M5 endpoint, 3 from M6 SKILL.md templates, 15 from M7 OTel). Frontend test count went 798 → 827 (+29 net: 12 from sentinel detector, 17 from event-check client). Architecture: backend `/proactive-event-check` is a pure gate decision; frontend kicks off the AG-UI run via `useSkillAgent.sendMessage` with a `[event_reactive:<kind>]` sentinel so the proactive turn rides the established AG-UI protocol. Sentinel suppression in `toSkillMessage` keeps the trigger from rendering as a student bubble.
  - **M1 recon finding**: `useSkillAgent.sendMessage` was confirmed as the FE programmatic trigger API; Path B proceeded as planned.
  - **M7 recon finding**: the `tutor.proactive_kind` OTel attribute mentioned in Phase A's docstring was aspirational and never implemented. M7 created the seam fresh (`backend/adk/proactive_telemetry.py`) covering both Phase A's `[session_start]` and Phase B's `[event_reactive:*]` uniformly.
  - **Sprint doc** to be moved to [implemented/proactive-sim-reactive-tutor-sprint.md](implemented/proactive-sim-reactive-tutor-sprint.md).

**Pending (M4 manual sanity for the verbosity prompt):**

- LOCAL_MODE chat against `led-planck-tutor`: confirm first 5 tutor turns each ≤3 sentences and end with `?`. Counter-test: `"forklar i detaljer"` → next turn allowed to be longer. Same against `kinebot-kinematics-tutor` in English. Non-blocking — M2 + M3 self-tests are the regression bar.

**Filed follow-ups (smaller post-sprint items):**

- [proactive-greet-refactor-to-path-b.md](proactive-greet-refactor-to-path-b.md) — refactor Phase A `/greet` onto the Path B rail Phase B now establishes. ~0.5d. Land after Phase B has been exercised through a few pilot sessions.
- **ProgressChecklist proactive-trigger hook** — checklist toggle → `step_advance` event. Deferred from PROACTIVE-SIM-REACTIVE M8 because it requires threading `onChatMessage` through a mount path that doesn't currently have it. Lower priority than the MCPAppToolCallRouter sim-run path which already covers Boldkast (the primary case). ~0.25d when it lands.

## Cross-version updates

When these ship, mark them in this file's `Sprint status` section (mirroring the v1.0 pattern) and move docs into a sibling `implemented/` directory.
