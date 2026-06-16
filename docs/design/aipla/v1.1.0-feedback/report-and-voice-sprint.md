# Sprint plan — dual-source report (1.1.36) + student audio turns (1.1.37)

**Design docs:** [session-report-dual-source-narrative.md](session-report-dual-source-narrative.md) (1.1.36) · [student-audio-turns.md](student-audio-turns.md) (1.1.37)
**Created:** 2026-06-16 · **Goal:** execute both in sequence — backend-testable cores first, frontend + infra flagged for browser/deploy verification.

## Execution order + status

Backend cores are TDD-able now; frontend (report inputs UI, audio composer) needs browser
verification (chrome-devtools); the Cloud Scheduler settle-job needs deploy config. Sequence:

| # | Milestone | Doc | Scope | Status |
|---|---|---|---|---|
| **A1** | Dual-source narrative: `SessionSummary.voice_transcript` + route attaches `_transcript_for_group` + prompt sends chat **and** transcript (labelled) | 1.1.36 | BE | **execute now (TDD)** |
| **A2** | Cache-on-both + 5-min debounce: regen when chat OR voice grew AND ≥5 min; `summaryBasedOnVoiceChars`; `report.narrative` span source sizes | 1.1.36 | BE | execute now (TDD) |
| **A3** | `inputs` block on the report response (chatTurns · audioMin · simEvents · model · generatedAt · state) | 1.1.36 | BE | execute now (TDD) |
| **A4** | Settle job: internal `POST /api/internal/warm-summaries` (settled+stale scan → resolve_narrative) + OIDC | 1.1.36 | BE | execute now (TDD); **Cloud Scheduler = deploy** |
| **A5** | Report page: render raw inputs immediately + browseable Chat/Recording/Sim sections + status banner | 1.1.36 | FE | **handoff (browser verify)** |
| **B1** | Backend: transcribe an audio turn (GeminiSTTProvider) → attach to turn for bubble + `emit_chat_turn` log | 1.1.37 | BE | execute after FE shape (depends on B2) |
| **B2** | `useAudioAttachment` + composer control (record → stage audio part), mirror `useImageAttachments`/`ImageComposer` | 1.1.37 | FE | **handoff (browser verify)** |
| **B3** | Send `AudioInputContent`; bubble = audio chip + transcript; remove dictation path | 1.1.37 | FE | handoff |
| **B4** | Retire `POST /api/voice/stt/transcribe` + tests | 1.1.37 | BE | execute with B1 |

## This pass (backend, TDD + commits)

A1–A4 (1.1.36 backend) are self-contained and testable → execute now. B1/B4 (1.1.37 backend)
depend on the audio-turn FE shape (B2/B3) to be meaningful, so they follow the FE.

## Handoff (focused FE/deploy pass)

- **A5, B2, B3** — frontend; verify with chrome-devtools (record → tutor hears → transcript shows;
  report inputs render before summary). The `aitana-frontend-verify` skill covers this.
- **A4 Cloud Scheduler** — deploy config (scheduler job + OIDC); first app scheduler; record side
  effects per the rule.

## Quality gates

- Backend per milestone: `cd backend && make lint && make test-fast`.
- Frontend (handoff): `cd frontend && npm run quality:check` + browser verify.

## Execution status — overnight 2026-06-16 → 06-17

**DONE (committed + pushed to dev, lint + test-fast green, 2017 backend tests):**
- **A1** `2c21e1b` — narrative summarises chat + audio transcript (both labelled).
- **A2** (in A2 commit) — regen on chat OR voice growth + 5-min debounce.
- **A3** — `inputs` block on the report response (turns · audio-min · sims · model · generatedAt · state).
- **A4** `9c4a327` — settle-job endpoint `POST /api/internal/warm-summaries` (settled+stale scan; token-guarded).

So **1.1.36 backend is feature-complete and tested.** The *existing* report UI already shows the
improved (dual-source) narrative — A5 is transparency polish on top.

**HANDOFF (needs a browser-verified session — `aitana-frontend-verify`):**
- **A5** — report page: render the `inputs` "what's included" line, name the inputs in the
  generating state, keep chat + recording transcript browseable beneath. Data is already on the
  API (A3). Lower risk (display logic).
- **1.1.37 B1–B4** — audio composer (record → `AudioInputContent` → send), bubble = audio +
  transcript, backend transcribe-for-log, retire `/stt/transcribe`. **Not shipped blind on
  purpose:** `MediaRecorder` + AG-UI audio-content wiring + "tutor actually hears the audio" can't
  be confirmed by static checks. B4 must land *with* the FE (removing the route before the FE
  would 404 the current dictation button).

**DEPLOY (to activate A4):**
- Set `WARM_SUMMARIES_TOKEN` on the backend service; add a **Cloud Scheduler** job (every ~10 min,
  OIDC) → `POST /api/internal/warm-summaries`. First app-level scheduler — record side effects.
  Knobs: `SUMMARY_SETTLE_MINUTES` (20), `SUMMARY_WARM_MAX_PER_RUN` (25), `SUMMARY_WARM_SCAN_LIMIT` (200).
