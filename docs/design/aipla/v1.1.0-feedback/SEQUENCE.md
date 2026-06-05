# v1.1.0-feedback Build Sequence

**Source brief:** [`june-03-feedback-sprint-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md) — 3 June 2026 teacher check-in
**Target window:** post-v1.0 / pilot-iteration (2026-06-04 → pilot start 2026-08-14, with continued iteration through 2026-09-15 handover)
**Parent roadmap:** [../SEQUENCE.md](../SEQUENCE.md)

This is the per-version sequence file for the **v1.1.0-feedback** batch — nine items distilled from the 3 June teacher check-in, in scoping-site priority order. The brief is the source of pedagogical / product truth; the docs here add the repo-specific technical execution layer (file paths, wire shapes, ADR alignment, acceptance gates).

> **v1.1, not v1.0.** Brief tags these as v1.1 priorities; they refine v1.0 surfaces rather than ship new strands. Many can land before the 2026-08-14 pilot, which is good — every item the pilot sees with confidence is one less thing the post-pilot iteration window has to absorb.

## Ordering

Brief priority is preserved; cross-cutting / blocking-dep ordering is noted in the dependency column.

| Order | Doc | Priority | Estimate | Dependencies / Gate | Notes |
|---|---|---|---|---|---|
| 1.1.1 | [tutor-verbosity-fix.md](tutor-verbosity-fix.md) — sprint: [quick-wins-v1.1-sprint.md](quick-wins-v1.1-sprint.md) (Track A) | **P0 IMMEDIATE** | ~2h | None | System-prompt-only delta across Boldkast, LED Planck, KineBot SKILL.md preambles. ≤3 sentences per turn unless explicitly asked; end every turn with a question. AR sign-off on the rewritten prompt block at PR review |
| 1.1.2 | [proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md) — sprint: [proactive-sim-reactive-tutor-sprint.md](proactive-sim-reactive-tutor-sprint.md) | **P1** | ~1d | [proactive-tutor.md](../v1.0.0-pilot/proactive-tutor.md) Phase A shipped; workbench-event stream from MCPAPP-SPEC | **Promotes / reshapes** the existing proactive-tutor Phase B (idle heartbeat → sim-event-reactive). Trigger on meaningful workbench events (sim run, step change, measurement commit) not slider drag. 90s cooldown, max 2 per session, short observation + question. Per-skill config. **Architecture (sprint plan, Path B):** FE-initiated AG-UI run via synthetic sentinel — backend owns the gate decision endpoint; FE kicks off the actual agent run via the existing `/api/chat/{skill_id}` AG-UI endpoint so the proactive turn rides the established protocol. Phase A's `/greet` REST shape becomes a follow-up refactor candidate after this lands |
| 1.1.3 | [student-consent-prompt.md](student-consent-prompt.md) | P1 | 0.5d FE + 0.5d BE | **JB sign-off on wording** (same approval gate as [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md)) | One-shot opt-in at session start. `consent_given: bool` on the session Firestore doc; declines → chat turns NOT written to BigQuery; teacher report shows `No research consent` badge. No change to ADR-001 anonymous-group auth |
| 1.1.4 | [session-report-summary-primary.md](session-report-summary-primary.md) | P1 | ~1d | None (teacher-insights-dashboard shipped) | Flip the session-report layout: AI summary primary; full transcript collapsed by default; CSV download for researcher use. Summary-generation prompt updated to produce 3-5 sentence narrative + concept/parameter/checklist bullets + "what next" line. Also the privacy strategy for eventual audio inclusion (summary has lower privacy profile than verbatim) |
| 1.1.5 | [researcher-role.md](researcher-role.md) | P1 | ~1d | [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) (1.A shipped) | New `role:researcher` Firebase custom claim; bypasses class-tag namespace; `--all-classes` flag on `aiplatform logs`; "Research view" toggle in teacher UI. Set manually by admin for JB, AR, M |
| 1.1.6 | [group-code-school-year-ttl.md](group-code-school-year-ttl.md) — sprint: [quick-wins-v1.1-sprint.md](quick-wins-v1.1-sprint.md) (Track B) | P1 | ~2h | [session-persistence.md](../v1.0.0-pilot/implemented/session-persistence.md) (1.F shipped) | **Rescoped 2026-06-03 mid-sprint.** Original "extend default to 300d" reshaped on privacy grounds (longer default = larger PII / consent surface on every code). This row now ships **rename** (`DEFAULT_TTL_DAYS` → `DEFAULT_GROUP_CODE_TTL_DAYS`, value stays 30) + **soft archival on expiry** (graceful 410 Gone; BQ rows retained). The per-code TTL choice moves to 1.1.10 below |
| 1.1.10 | [teacher-choice-ttl.md](teacher-choice-ttl.md) | P1 | ~0.5-1d | 1.1.6 (rename shipped); [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) (1.A shipped) | **New 2026-06-03** — split from 1.1.6. Teacher picks per-code TTL via preset dropdown (30/90/180/300d + custom 7-365d range) at group-code creation. Backend `mint_group(ttl_days=...)` already supports this; what's missing is route validation + teacher-UI form field + class-detail display + CLI `--ttl-days` parity. Preserves the brief's school-year ask as an opt-in per code rather than a platform-wide default |
| 1.1.7 | [student-multimodal-upload.md](student-multimodal-upload.md) | P1 | ~2d | ADR-008 (Gemini multimodal via AILANG Parse — ready); JB confirm on image-retention posture | **Was originally planned as 1.10** `multimodal-ingestion-via-ailang-parse.md` in the parent SEQUENCE — this doc supersedes that planned row. Most-requested student-facing item from 3 June. Paperclip upload, JPG/PNG/HEIC/PDF, image thumbnail in chat, Gemini multimodal call with image attached. Tutor handles handwritten diagrams, experimental-setup photos, draft answers per skill prompt |
| 1.1.8 | [exit-ticket.md](exit-ticket.md) | P1 | ~1d | **JB/AR providing the question set** | End-of-session modal with confidence emoji rating + free-text. Stored in Firestore session doc + BigQuery (`exit_ticket_rating`, `exit_ticket_text`, `exit_ticket_skipped`). Teacher session report shows the rating; researcher view aggregates |
| 1.1.9 | [cost-dashboard.md](cost-dashboard.md) | P1 | ~1d | [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (1.2 shipped — token counts already in BQ via OTel) | **Supersedes the originally-planned 1.12** `budget-dashboard.md`. Teacher class-detail "Budget" panel: this-month spend, per-activity / per-group breakdown, projected monthly. Researcher cross-class spend. Priority lifted by DK's Indian cohort scaling to ~100s of students |
| 1.1.11 | [voice-provider-abstraction.md](voice-provider-abstraction.md) — sprint: [voice-provider-abstraction-sprint.md](voice-provider-abstraction-sprint.md) | P1 | ~3.5-4d (Phase A ~1.75d + Phase B ~1.5-2d) | [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) (Part 1 shipped); 1.1.9 cost-dashboard for span surfacing; 1.G teacher UI for per-class toggle; 1.1.2 proactive-sim-reactive (auto-read toggle picks up proactive turns automatically) | **New 2026-06-03** — voice quality flagged today (choppy macOS Danish "Sara") + dictation requested as "lesson ease" accessibility upgrade. Server-side `TTSProvider`/`STTProvider` Protocols in `backend/voice/`, Cloud TTS (Standard spike → WaveNet upgrade) for Danish read-aloud + Cloud STT `latest_long` for Danish dictation, browser-native stays as default provider. Per-class teacher opt-in for the mic button. **Auto-read toggle**: student-side preference to auto-speak every assistant message (incl. proactive turns from 1.1.2) vs current click-to-read default. Designed swap-shaped (cloud → server-local → self-hosted Whisper on UCPH GPU per ADR-003 four-tier model). Defers Gemini Live / LiveRunner to a future conversational-tutor doc. **Phase A (TTS) ships independently** — fixes today's Sara issue without waiting for Phase B |
| 1.1.12 | [voice-personas.md](voice-personas.md) | P2 | ~3d | [voice-provider-abstraction.md](voice-provider-abstraction.md) (1.1.11 shipped 2026-06-04); 1.G teacher class-detail page for picker placement; optional 1.1.9 cost-dashboard for per-persona spend split; optional 1.1.5 researcher-role for `?debug=voice` without query param | **New 2026-06-04** — UX polish over 1.1.11. Teacher review found the technical voice picker ("gcp_chirp3hd / da-DK-Chirp3-HD-Aoede") opaque to non-engineers. New `Persona` model bundles avatar + name + title + language + voice; teachers pick a persona card instead of tier+voice dropdowns. Chat bubble shows persona avatar + name; new friendly status pill replaces the technical debug pill (technical mode behind `?debug=voice`). 4-6 default personas (Aoede/Charon/Kore/Puck/Frida/Daniel) ship as YAML in `backend/personas/`. Existing 1.1.11 raw voice config stays as "Custom voice (advanced)" expander. Net +7 axiom score; +1 USABLE BY DESIGN explicit win |
| 1.1.13 | [implemented/sim-onboarding-ergonomics.md](implemented/sim-onboarding-ergonomics.md) — sprint: [implemented/sim-onboarding-ergonomics-sprint.md](implemented/sim-onboarding-ergonomics-sprint.md) **shipped 2026-06-04** | **P1** | ~0.75d | [implemented/proactive-sim-reactive-tutor-sprint.md](implemented/proactive-sim-reactive-tutor-sprint.md) shipped | **Shipped 2026-06-04** — follow-up to 1.1.2. PROACTIVE-SIM-REACTIVE shipped over several iteration loops because per-artefact frames used an **allowlist** filter ("explicitly route each kind") which silently dropped multi-word hyphenated kinds (`kinebot.sim-run`, `led-planck.auto-run`) — proactive turns silently never fired. Inverts to **denylist** via new `useArtefactReportEvent` hook (drop noisy kinds, forward everything else with default-through `{kind}` shape). Refactored Boldkast / LED Planck / KineBot frames. 23 new vitest cases (8 unit + 7+10+6 integration) pin the regression bar. Hardened `_sim-template/` scaffold + cross-linked `mcp-app-artefact` skill so future sims (Pendul, Kredsløb, Videoanalyse, GPS Fart, Frekvensanalysator) onboard mechanically |
| 1.1.14 | [implemented/chat-history-flicker-on-token-refresh.md](implemented/chat-history-flicker-on-token-refresh.md) — sprint: [implemented/chat-history-flicker-on-token-refresh-sprint.md](implemented/chat-history-flicker-on-token-refresh-sprint.md) **shipped 2026-06-04** | **P1** | ~2-3h | [session-persistence.md](../v1.0.0-pilot/implemented/session-persistence.md) (1.F shipped) + Vertex Agent Engine session backend (Decision 13 in [bootstrap-aipla-dev.NOTES.md](../../../scripts/bootstrap-aipla-dev.NOTES.md)) | **Shipped 2026-06-04** — student-reported chat-bubble flicker (history disappears for ~400 ms then reappears) traced to `AGUIProvider` unmounting its subtree on Firebase ID-token refresh. Bug exists in the inherited template but is masked there by sub-50 ms in-region Agent Engine reads; surfaced on AIPLA by the cross-region (europe-north1 ↔ europe-west1) Vertex hop. Frontend-only fix: `hadTokenOnceRef` + gate `tokenResolved` blanking on **initial** load only, not on every `user`-ref change. 11 LOC impl + 3 new vitest cases in AGUIProvider + 1 defensive vitest in useSessionMessages. Filed as [upstream-feedback.md entry #31](../../../upstream-feedback.md) for the template |
| 1.1.15 | [implemented/chat-svg-streaming-placeholder.md](implemented/chat-svg-streaming-placeholder.md) — sprint: [implemented/chat-svg-streaming-placeholder-sprint.md](implemented/chat-svg-streaming-placeholder-sprint.md) **shipped 2026-06-04** | P2 | ~1.5h | None | **Shipped 2026-06-04** — student-reported SVG diagram flicker as the closing `</svg>` token arrives. Cause: `ChatMarkdown`'s pre-processor only matches a complete `<svg…</svg>`, so the partial is stripped via the `html()` handler until the closing tag arrives — at which point a 160 px placeholder appears suddenly (vertical jump), then the SVG fills it after DOMPurify resolves. Fix: added a tail-regex (`SVG_STREAMING_TAIL_RE`) that detects an open `<svg` without a close, reserves the same 160 px placeholder immediately. When `</svg>` lands, React reconciles the placeholder in-place with the rendered SVG — no second jump. 25 LOC impl + 5 new vitest cases (~100 LOC) in `ChatMarkdown.test.tsx`. Shared `SvgStreamingPlaceholder` export from `SVGBlock` keeps dimensions identical across the streaming/post-sanitise states |
| 1.1.16 | [security-monitoring-pipeline.md](security-monitoring-pipeline.md) — sprint: [implemented/security-monitoring-pipeline-sprint.md](implemented/security-monitoring-pipeline-sprint.md) **shipped 2026-06-05** | P1 | ~6h (M1+M2+M5 critical path, M3+M4 layered same-day) | None — additive on existing `ci.yml` | **Shipped 2026-06-05** — Prompted by the 20-alert dependabot pile (commits `084920b` + `1257c08` patched all 20). Three-layer pipeline now live: (1) `security-audit` job in [ci.yml](../../../../.github/workflows/ci.yml) runs `scripts/security-check.sh` (the single source of truth for the gate); fails PRs on new HIGH/CRITICAL production-dep CVEs. (2) [security-weekly.yml](../../../../.github/workflows/security-weekly.yml) cron Mon 09:00 UTC updates a rolling tracking issue with audit + dependabot summary. (3) [aipla-security-checkup skill](../../../../.claude/skills/aipla-security-checkup/SKILL.md) encodes the reachability rubric. Side effect of the sprint: closed 13 newly-discovered backend Python CVEs (litellm bump to 1.85.4, aiohttp/idna/mako/pyjwt/python-multipart/urllib3/authlib bumps via `uv lock --upgrade-package`) + 3 frontend high CVEs (undici→7, fast-uri→3.1.2, fast-xml-builder→1.2.0 via overrides). 1 documented ignore (starlette PYSEC-2026-161, blocked by fastapi<1.0.0). Frontend 911 tests + backend 1761 tests pass. Net axiom score +4 (SECURE BY CONSTRUCTION, EARNED TRUST, OBSERVABLE BY DEFAULT, PROTOCOL OVER CUSTOM all +1) |
| 1.1.17 | [student-engagement-signals.md](student-engagement-signals.md) | **P2** | ~1.5d | [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (1.2 shipped); 1.1.3 consent; 1.1.4 session-report surface; 1.1.5 researcher cohort view; JB/AR review of metric set + framing copy | **New 2026-06-06** — formative-not-sanctionary engagement signals on the teacher session report (paste ratio, revision count, turns-to-completion, abandonment point, re-ask rate). Framing is explicit: cohort signals → "rewrite problem N", not per-student sanction. Origin: 2026-06-05 chat with M re: anti-cheat — agreed *if the student is trying to cheat the battle is already lost*; instead these signals surface where the lesson needs improvement. Captures composition counts (not the keystream) FE-side, re-uses existing embedding for re-ask scoring BE-side, extends `chat_turns` BQ table with 4 columns + adds session-level aggregates to Firestore. Researcher view (per 1.1.5) gets a per-class "Engagement" tab with per-problem heatmap — the headline view for turning signals into actionable rewrites. Sits thematically near 1.1.4 (session report) and 1.1.9 (cost dashboard) on the teacher dashboard improvements axis |

## What's gated on human input

Tee these up first — engineering can't unblock them:

1. **JB sign-off on consent prompt wording** ([1.1.3](student-consent-prompt.md)) — gates the chat-log opt-in shipping
2. **JB/AR question set for the exit ticket** ([1.1.8](exit-ticket.md)) — gates the modal shipping
3. **AR sign-off on the verbosity-trimmed system prompt** ([1.1.1](tutor-verbosity-fix.md)) — gates the prompt change merge
4. **JB confirm on image-retention posture** ([1.1.7](student-multimodal-upload.md)) — gates multimodal upload; brief states "images sent to Gemini, not retained in BQ" but needs explicit JB OK

Items **1, 2, 4, 5, 6** have **no human dependency** and can start immediately.

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
| Portfolio download | Depends on [1.1.6](group-code-school-year-ttl.md) school-year TTL shipping first | Small follow-up sprint after 1.1.6 |
| Proactive cooldown event-banking | Tutor references the SEQUENCE of student actions during cooldown ("you tried 30°, 45°, 60° in the last 30s"), not just the latest. v1.1 ships with state-aware-but-not-history-aware reactive turns. Validate need from pilot session reviews first | [cooldown-event-banking.md](cooldown-event-banking.md) — roadmap signal, not committed |

## Total estimate

| Bucket | Engineering days |
|---|---|
| Quick wins (1.1.1, 1.1.6) | ~0.5d |
| Standard (1.1.2, 1.1.3, 1.1.4, 1.1.5, 1.1.8, 1.1.9, 1.1.10) | ~6.5-7d |
| Larger (1.1.7, 1.1.11) | ~5.5-6d |
| Polish (1.1.12, 1.1.14) | ~4d |
| **Total** | **~16.5-17.5d** |

Comfortably fits in the post-3-June → pilot-start window (2026-06-04 → 2026-08-14, ~10 weeks minus the 2026-06-29 → 07-05 holiday freeze). Several items can be live in time to be exercised *by* the pilot, not absorbed *after* the pilot.

## Timeline anchors

- **2026-06-03** — Brief delivered (3 June teacher check-in)
- **2026-06-04** — v1.1 design docs landed (this commit)
- **2026-06-26** — Mid-point review; quick wins (1.1.1, 1.1.6) and at least one larger item should be in flight
- **2026-06-29 → 07-05** — Holiday freeze
- **2026-07-06 → 08-14** — v1.1 build window (post-freeze, pre-pilot)
- **2026-08-14** — Pilot starts; ideally 1.1.1–1.1.6 + 1.1.9 live
- **2026-08-14 → 09-15** — Pilot iteration window for remaining items + portfolio-download follow-up

## Sprint status (2026-06-03)

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
