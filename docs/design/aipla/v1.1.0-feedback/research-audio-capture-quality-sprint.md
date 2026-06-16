# Sprint plan — research-audio capture/transcription quality (RAQ-1)

**Design doc:** [research-audio-capture-quality.md](research-audio-capture-quality.md) · SEQUENCE **1.1.35**
**Created:** 2026-06-16 · **Goal:** make research-audio transcription actually work (Gemini engine), end-to-end testable.

## Milestones

| M | Title | Scope | Status | Notes |
|---|---|---|---|---|
| **M1** | Gemini STT provider | backend | **in progress** | `gemini_stt.py` + registry `gemini_*` branch. Routes the recording transcribe path through Gemini (the spike-proven fix). Unit-tested with a mocked genai client. **The core deliverable.** |
| **M2** | Cloud STT multi-language fallback | backend | **planned** | `alternative_language_codes` (da↔en) in `gcp_stt.py` so the fallback path stops garbling/emptying on code-switched audio. |
| **M3** | STT cost/engine span | backend | **planned** | `voice.stt` span on the background-transcribe path (engine + bytes + status) → BigQuery. Full $-from-tokens is a follow-up. |
| **M4** | Retention TTL capability | infra | **deferred** | The research-audio bucket is **not Terraform-managed** (script-created per `bootstrap-aipla-dev.NOTES.md`), so the design's `infrastructure/modules/voice/main.tf` var doesn't apply as written. Needs a bucket-management decision (import to TF vs a `gsutil lifecycle` script). Surfaced; not executed this sprint. |
| **M5** | Recorder survive-reload | frontend | **planned** | `audioCapture.ts` / `LessonRecordingPanel.tsx`: `sessionStorage` resume + `beforeunload` guard + honest state. Coverage fix (secondary to transcription). Vitest. |
| **M6** | Whole-file re-transcription route + CLI | backend | **planned** | `POST /api/voice/recording/group/{id}/retranscribe` — assemble a group's segments → one GCS file → Gemini whole-file → overwrite. Recovers `tilted-petal-71`; the eval harness. Larger (GCS assembly). |

## Execution order

M1 (core fix) → M2 (fallback) → M3 (cost span) this session, each TDD + committed. M5/M6 follow;
M4 needs the bucket-management decision first.

## Quality gates

- Backend per milestone: `cd backend && make lint && make test-fast`.
- Frontend (M5): `cd frontend && npm run quality:check`.

## Success (this sprint)

- [ ] `VOICE_STT_PROVIDER=gemini_2.5-flash` routes recording transcription through Gemini (M1).
- [ ] Cloud STT fallback carries `alternative_language_codes` (M2).
- [ ] Transcribe path emits an engine/bytes span (M3).
- [ ] `make test-fast` green; registry knows `gemini_*`.
