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
