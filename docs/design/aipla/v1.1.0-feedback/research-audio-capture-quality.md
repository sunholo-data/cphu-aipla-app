# Research-audio capture & transcription quality (+ retention TTL capability)

**Status:** Planned — born from the **16 June Jutland demo**; first execution doc off that demo's data
**Priority:** P1 — the research-audio strand produced near-unusable transcripts at the first real classroom scale; it must work before the **2026-08-14 teacher pilot**
**Estimated:** ~2.5–4d phased — Phase A (Gemini transcription + capture robustness) ~1.5d ships first; Phase B (retention TTL capability) ~0.5d; Phase C (fidelity archive) ~1–2d, gated
**Scope:** Backend (STT request config in `backend/voice/providers/gcp_stt.py`, re-transcribe path in `backend/protocols/recording_routes.py`); frontend (recorder lifecycle in `frontend/src/lib/audioCapture.ts` + `LessonRecordingPanel.tsx`); infra (config-driven bucket lifecycle in `infrastructure/modules/voice/main.tf`); CLI (`aiplatform audio retranscribe`)
**Dependencies:** [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) (1.H — the parent doc; **the as-built pipeline diverged from it**, see below); [voice-provider-abstraction.md](implemented/voice-provider-abstraction.md) (1.1.11 — the `STTProvider` registry this extends); [bidirectional-voice-brief.md](bidirectional-voice-brief.md) (1.1.23 — shares the STT provider but is a *different* audio path); ADR-001 (anonymous group IDs), ADR-003 (swap-shaped provider tiers), ADR-005/007 (EU residency)
**Source (demo evidence):** `demo-captures/2026-06-16/DEBRIEF.md` (gitignored) + the live log/GCS/Firestore/BigQuery capture from the 16 June demo
**Last Updated:** 2026-06-16

> **Why this doc exists.** The 16 June demo was the first time the "Record this class"
> research-audio pipeline ran at real classroom scale. The chat record was complete and
> the service was healthy, but the **transcripts were largely unusable**: ~40% of segments
> came back empty and the rest were garbled fragments. **Listening back to the raw
> recordings (M, 2026-06-16) confirmed the audio is clear and easily transcribable — so the
> failure is in transcription, not capture.** A separate, secondary problem: recording
> **stopped ~16 min into 40+ min sessions** (a coverage gap), and only 2 of 4 active groups
> recorded at all. This doc turns that evidence into fixes — **STT quality first.** It also
> adds the **retention TTL capability** M asked for — dev keeps everything (waivered
> teacher/dev students), but test/prod need a switchable expiry, which the parent doc
> deferred ("Lifecycle policy: per retention decision").

> **As-built reality diverges from the parent doc.** [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md)
> specced 10 s `webm/opus` chunks under `{group_id}/{activity_id}/{ts}.webm` with **no
> transcription in v1**. What actually shipped (and ran on 16 June): **50 s WAV / PCM-16 /
> 16 kHz / mono** segments under `{classId}/{groupId}/{uuid}.wav`, with **live Cloud STT
> `latest_long`** transcribing each segment in a background task. This doc documents the
> divergence and builds on the *as-built* pipeline, not the parent's original plan.

## Problem Statement

The pipeline works end-to-end — and **listening to the raw recordings confirms the audio is
clear and transcribable; the bottleneck is the transcription step, not capture.** Measured
from the 16 June demo:

| Group | Chat window | Audio captured | Transcript | `empty` segments |
|---|---|---|---|---|
| eager-stork-72 | 11:25–12:07 (42 min) | 11:27–11:44 (~18 min, 22 seg) | **171 chars** of fragments | 9 / 22 (41%) |
| tiny-beetle-46 | 11:25–12:11 (46 min) | 11:29–11:45 (~16 min, 20 seg) | 428 chars, garbled | 7 / 20 (35%) |
| stout-kettle-32 | 11:23–11:44 | 1 seg (~50 s) | 0 | 1 / 1 |
| minty-pencil-36 | 08:22–12:11 | 1 demo seg | 0 | — |

Four findings. The first three are **transcription** (the primary problem — the audio is fine,
confirmed by listening to `tiny-beetle` directly); the fourth is **capture coverage** (secondary):

1. **We chopped the conversation into 50 s slices for speed — and lost accuracy.** Capture cuts
   fixed 50 s segments (`SEGMENT_MS = 50_000`) so a transcript can grow *live* during the lesson.
   That segmentation was driven by Cloud STT's **sync** ~1-min cap — but the backend transcribes
   with **long-running** recognize, which has **no such cap**. So we pay the accuracy cost of
   slicing (words split at boundaries, no cross-segment context, each clip too short for the
   long-form model to do its best) for a live-ness we don't actually need — M: the transcript
   appearing at end of class is fine, accuracy is the must. This is the over-optimisation.

2. **STT garbles Danish↔English code-switching and returns empty on English-dominant audio.**
   Every recording is tagged a single `lang="da"` with **no `alternative_language_codes`**
   ([gcp_stt.py:126](../../../../backend/voice/providers/gcp_stt.py#L126)), so English physics
   terms are mangled (*"y-axis"→"why access"*, *"linear"→"lenia"*) and segments that are mostly
   English come back **empty** (Cloud STT returns no result rather than a wrong-language guess).
   Students code-switch constantly — the tutor and physics vocabulary are English, the
   discussion Danish.

3. **~40% of segments return empty — on clear audio.** Because the recordings are intelligible,
   these are **not** acoustic dropouts. They are mostly (a) the language-mismatch empties from
   #2 and (b) genuinely quiet stretches that 50 s slicing isolates. Whole-session multi-language
   transcription (A1) addresses both; A3's re-transcription measures exactly how much.

4. **Capture truncates mid-session (coverage, not quality).** Where audio ran it was gap-free,
   but it **stopped ~16–18 min before the conversation ended** — the recorder dies when the chat
   tab is closed/navigated/backgrounded. The captured audio is good; there's just less of it
   than the full session. Secondary to the transcription fixes.

**The audio is sound — proof:** M listened to the 16 June recordings (e.g. `tiny-beetle`) and the
conversation is clearly audible; and the same code on clean audio (`soft-orchard-13`) produced
**8,251 chars of clean Danish** (26/27 `done`). The delta is the **transcription config**
(slicing + single language), not the audio. Separately, the longest recording (`tilted-petal-71`,
**134 min**) was **never transcribed** (`transcriptStatus` unset) — there is no path today to
transcribe already-captured audio.

**Current State (as-built, file-grounded):**

- Capture: AudioWorklet pinned to 16 kHz mono ([audioCapture.ts:93](../../../../frontend/src/lib/audioCapture.ts#L93)), fixed 50 s segments (`SEGMENT_MS = 50_000`, [audioCapture.ts:253](../../../../frontend/src/lib/audioCapture.ts#L253)), fire-and-forget upload ([LessonRecordingPanel.tsx:74-90](../../../../frontend/src/components/chat/LessonRecordingPanel.tsx#L74-L90)). Recorder lives in the chat page; dies with the tab.
- STT: Cloud Speech-to-Text v1 `latest_long`, per-segment long-running recognize in a FastAPI BackgroundTask ([recording_routes.py:161](../../../../backend/protocols/recording_routes.py#L161)); single `language_code` ([gcp_stt.py:113-136](../../../../backend/voice/providers/gcp_stt.py#L113-L136)).
- Storage: `gs://{project}-research-audio/{classId}/{groupId}/{uuid}.wav` ([recording_store.py:72-75](../../../../backend/voice/recording_store.py#L72-L75)). **No lifecycle rule** — kept forever (only the TTS-cache bucket has a 90 d rule, `infrastructure/modules/voice/main.tf`).
- Gating: `Class.recording_enabled` default OFF + consent attestation ([class_.py:96-101](../../../../backend/db/models/class_.py#L96-L101)); student presses "Record this class" → mic permission.

**Impact:** The research-audio strand is a contract deliverable ("how do groups reason
aloud?"). At pilot scale (many classrooms, no researcher in the room) the 16 June quality
would yield a corpus that is mostly empty or untrustworthy. This is the gap between "the
feature ships" and "the research data is usable."

## Goals

**Primary:** Raise research-audio from "mostly empty/garbled" to "a usable Danish/English
classroom-discussion corpus" — **accuracy over speed** — by (a) transcribing each session as
**one whole-recording, end-of-class job using Gemini** (not 50 s single-language live slices),
(b) keeping the recorder alive for the whole session (coverage), (c) tracking transcription cost
per class, and (d) making audio retention switchable per environment.

**Success metrics:**

- **Capture coverage:** for a recording-started group, audio spans ≥90% of the session
  (recorder survives reload/navigation/background; resumes or warns). No silent truncation.
- **Transcription yield:** `empty`-segment rate <15% (from ~40%) and a readable joined
  transcript on the 16 June `tiny-beetle`/`eager-stork` audio re-run — Danish *and* English
  terms correct (re-transcription is the eval harness).
- **Retention capability:** a single config var sets per-environment audio TTL; dev = no
  expiry (default), test/prod = a JB-set period — with **no code change**, only Terraform var.
- **Recoverability:** an operator can re-transcribe any already-captured group (recovers
  `tilted-petal-71`'s 134 min and re-runs after any STT config change).

**Non-Goals:**

- Speaker diarization / per-student attribution (group-scoped only, per ADR-001).
- Real-time transcription as the *authoritative* record — the canonical transcript is a whole-session pass at end of class; the live per-segment preview is best-effort only.
- The **tutor voice loop** (`stt_tts_roundtrip` / `gemini_live`) — that is [1.1.23](bidirectional-voice-brief.md), a different audio path; this doc is the *research recording* path only. They share the `STTProvider` registry and benefit from the same multi-language fix.
- Video capture (deferred per parent doc).
- Changing the consent model (paper forms, teacher attestation — unchanged).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Research capture is background; not on the interactive latency path. Recorder-alive work adds a heartbeat, not blocking UI. |
| 2 | EARNED TRUST | +1 | Honest capture state (no false "we recorded it"); and because Gemini can paraphrase, the transcript is pinned to **verbatim**, the **raw audio is retained as ground truth**, and Gemini↔Cloud-STT cross-check is available (A3). |
| 3 | SKILLS, NOT FEATURES | 0 | Platform-level research affordance, not a skill. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | **The core fit.** Spike: Gemini most accurate *and* ~8–16× cheaper than Cloud STT; engine swap-shaped per ADR-003 (Gemini only now — Cloud STT removed; Whisper a future self-host option). |
| 5 | GRACEFUL DEGRADATION | +1 | No Cloud STT fallback (removed) — degradation is audio-first: the audio is always retained even if Gemini fails and is re-transcribed later; the recorder survives reload/resumes instead of dying silently. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Reuses the shipped `STTProvider` registry + Cloud STT + GCS lifecycle primitives; no new protocol. (Capture is a bespoke research pipeline by necessity — see framework-native check.) |
| 7 | API FIRST | +1 | Re-transcribe is an API/CLI operation over the same `recordings` store; no channel-specific logic. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Adds `voice.stt.cost` (engine/model/minutes/tokens/$) + yield + capture-coverage spans → BigQuery, so transcription spend and "% empty this week" are dashboard lines (joining the 1.1.11 `voice.*` spans). |
| 9 | SECURE BY CONSTRUCTION | +1 | Retention TTL is enforced by a GCS lifecycle rule (architecture, not discipline); GDPR erasure-by-group already exists; no new egress (Cloud STT is in-project, EU). |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Recorder-lifecycle fix is necessarily client-side (the mic lives in the browser), but stays UI/transport only — no business logic added. |
| 11 | USABLE BY DESIGN | +1 | A visible, honest recording state + "still recording / resumed" feedback for the shared-tablet holder; no ambiguous always-listening or silent-stopped states. |
| | **Net Score** | **+8** | Threshold ≥ +4. |

**Conflict Justifications:** none at −1.

## Framework-Native Capability Check (5b-ter)

Before adding plumbing, confirm the stack doesn't already do it:

- **Transcription engine:** Gemini is already wired (`google-genai`, used by tutor + narrative) and takes a GCS audio `Part` natively — *no new transport*. Cloud STT was removed entirely (it garbled the audio). A new engine (e.g. Whisper) is a new registered provider name — *no new abstraction*. Reuse, don't rebuild.
- **Re-transcription:** the `recordings` Firestore docs already carry `gcsUri` + `transcriptStatus`; the background-transcribe function already exists ([recording_routes.py](../../../../backend/protocols/recording_routes.py)). Re-transcribe is **re-invoking the existing function over stored rows**, not a new pipeline.
- **Retention:** GCS **bucket lifecycle rules** are the native TTL primitive (already used for the TTS-cache bucket in `infrastructure/modules/voice/main.tf`). No custom expiry job — just parameterize the existing Terraform pattern.
- **Capture (genuinely custom, justified):** this is far-field group-discussion recording to a research bucket — it is **not** the tutor turn, so AG-UI/ADK media transport does not apply (those carry *interaction* audio into the model; this is *ambient research* audio that never enters a model turn). The bespoke recorder is necessary; the fix keeps it minimal (lifecycle robustness, not a new transport).

## Design

Three workstreams, independently shippable. Phase A is the high-value fix.

### A1 — Transcribe the whole recording with Gemini, at end of class (the fix)

A 16 June spike on `tiny-beetle-46.wav` (the same audio M listened to) settles the engine. Three
on the identical 16-min file:

| Engine | Output | Quality |
|---|---|---|
| Cloud STT v1 `latest_long`, **`da` only** (production today) | **360 chars** | gibberish — the demo failure reproduced |
| Cloud STT v1 `latest_long`, **`da`+`en`** | 10,806 chars | readable, but ASR errors (*angle→"ankle"*, *trajectory→"traditionary"*) |
| **Gemini 2.5 Flash** (whole file, grounded prompt) | **12,005 chars** | accurate, punctuated, speaker-separated; physics terms + the tutor's turns correct |

Root cause exposed: the group spoke **mostly English** (a demo with observers) and production
hard-tagged it `da-DK` → 360 chars of garbage. The fix is to **decouple transcription from the
50 s capture slicing and transcribe the whole recording with Gemini at end of class** (M:
end-of-class is fine; accuracy is the must). (Chirp 2 / STT v2 was also spiked and **rejected** —
accurate but with a repetition-loop artifact, ~8–16× Gemini's cost, and active regional
deprecation; the engine is **Gemini, full stop**.)

**A1a — Gemini whole-file transcription (primary).** On recording stop / an end-of-class job, pass
the full GCS audio to Gemini (`gemini-2.5-flash`, an audio `Part` from the GCS URI) with a
grounding prompt (Danish+English physics lesson; transcribe verbatim; keep each phrase in the
language spoken; punctuate; one speaker turn per line). This is the **authoritative** transcript —
full-conversation context, no slice boundaries. Already in our stack (tutor + narrative use Gemini)
and **~$0.06–0.12 / hr audio** (batch/standard) — ~8–16× cheaper than Cloud STT ($0.96/hr).
The per-50 s live transcription stays a best-effort preview (or is dropped to save cost); capture
keeps 50 s chunks only for upload resilience.

**A1b — No fallback (Cloud STT removed 2026-06-16).** The spike showed Cloud STT garbled the audio
even with multi-language enabled, so it is **removed entirely** — Gemini is the only STT engine
(registry `_build_stt` knows only `gemini_*`; `gcp_stt.py` deleted). Graceful degradation is
*audio-first*: on a Gemini outage the audio is retained (the durable research record) and
re-transcribed later (A3/M6), rather than falling back to an engine we've rejected. Record `model`
+ version on the transcript doc.

**Cost tracking (a must, per M).** Every transcription emits a `voice.stt.cost` span —
`{engine, model, audio_seconds, input_tokens, output_tokens, usd}` → BigQuery, joining the shipped
`voice.*` cost spans (1.1.11) on the cost-dashboard (1.1.9), so per-class / per-pilot transcription
spend is a dashboard line. Spike rates: **Gemini 2.5 Flash ~$0.06–0.12/hr** audio (batch/standard);
**Cloud STT $0.96/hr** — the engine is also an ~8–16× cost lever, made visible.

### A2 — Capture: keep the recorder alive for the whole session (coverage — secondary)

Secondary to A1 — the audio we *do* capture is fine; this is about capturing *more* of the
session, not better quality. The recorder
([`SegmentedRecorder`](../../../../frontend/src/lib/audioCapture.ts#L261-L331)) is mounted in the
chat page and dies on unmount/tab-close/background — the 16 June truncation. Fixes, smallest-first:

- **`beforeunload` / `visibilitychange` guard:** flush the in-flight segment on hide, warn
  before unload while recording ("This lesson is still recording — stop before leaving?").
- **Resume on reload:** persist `recordingActive` + `seq` in `sessionStorage`; on chat-page
  mount, if a recording was active for this group, auto-resume (mic permission already
  granted) and continue the seq. The group device reloading mid-lesson is the common case.
- **Honest state:** the persistent recording indicator (already required by the parent doc)
  shows `● Recording · NN min` and a distinct `Resumed` / `Paused (tab hidden)` state so the
  device-holder can tell capture is actually running — never a silent stop (Axiom 11).
- **Heartbeat span:** emit `recording.heartbeat` every segment → BigQuery, so a stalled
  recorder is visible as a coverage gap, not discovered weeks later.

### A3 — Whole-session re-transcription (recovery + the eval harness)

The same end-of-session full pass (A1a), runnable on demand over any group's stored audio:
assemble segments → full GCS WAV → Gemini whole-file transcribe → overwrite the transcript.
It is A1a applied retroactively, so it:

- recovers `tilted-petal-71` (134 min, never transcribed) and re-runs any garbled/empty group;
- is the **evaluation harness** — re-transcribe the 16 June `tiny-beetle`/`eager-stork` audio
  (already stitched in `demo-captures/research-audio/dev/_stitched/`) and diff yield across
  **today** (50 s slices, single-language) → **A1** (Gemini whole-file). The accuracy gain is
  measured, and the stitched files are literally the test input;
- makes every STT config change retroactive, not forward-only.

Exposed as `POST /api/voice/recording/group/{group_id}/retranscribe` (researcher/owner-teacher
auth) + the CLI command below.

### B — Retention: a switchable TTL capability (dev keeps all)

Parameterize the research-audio bucket's lifecycle in `infrastructure/modules/voice/main.tf`
(mirroring the TTS-cache rule already there):

```hcl
variable "research_audio_retention_days" {
  description = "Days before research audio auto-deletes. 0/null = keep forever."
  type        = number
  default     = 0          # dev: keep everything (waivered teacher/dev students)
}

resource "google_storage_bucket" "research_audio" {
  # ...
  dynamic "lifecycle_rule" {
    for_each = var.research_audio_retention_days > 0 ? [1] : []
    content {
      condition { age = var.research_audio_retention_days }
      action    { type = "Delete" }
    }
  }
}
```

Dev sets nothing (keeps all). Test/prod set `research_audio_retention_days` per JB's data-
management plan. The GDPR erasure-by-group path
([recording_routes.py:241-257](../../../../backend/protocols/recording_routes.py#L241-L257))
is unchanged and independent — TTL is *automatic* expiry; erasure is *on-request* deletion.

### C — Fidelity (likely unnecessary — recordings confirmed adequate)

M listened to the 16 June recordings (e.g. `tiny-beetle`) and the audio is clear and
transcribable — so capture fidelity is **probably not** the constraint. Keep this only as a
fallback if, after A1 (Gemini whole-file), transcription yield is still
*audio*-limited rather than *config*-limited. Options if so:

- **Archive higher-fidelity, transcribe downsampled:** capture at 48 kHz for the *research
  archive* (humans can listen to a clearer record) while sending a 16 kHz copy to STT.
  Trade-off: ~3× storage + a client-side downsample. Decide against the re-transcription
  yield from A3 — if 16 kHz + multi-language is enough, skip this.
- **Capture guidance:** in-app hint to place the tablet centrally / reduce table noise; a
  one-line "recording quality: tap to test mic" check before a lesson.

## CLI Surface

The parent doc specced `aiplatform audio list/delete/stats` (as-built status to confirm).
This adds:

| Command | Purpose |
|---|---|
| `aiplatform audio retranscribe --group <group_id> [--env dev]` | Re-run STT over a group's stored recordings with the current config (recovery + A1/C eval). |
| `aiplatform audio coverage --class <id>` | Per-group segment count, span, `empty`-rate, transcript chars — the yield/coverage report (productionises the 16 June ad-hoc analysis). |

Backlink: [local-dev-cli.md](../../../v6.1.0/local-dev-cli.md). Estimate ~0.3d.

## Testing Strategy

- **pytest `gemini_stt`:** mocked genai client — assert the audio Part + grounding prompt reach
  Gemini, `transcribe_long` delegates, size cap + error wrapping, registry builds `gemini_*`.
- **pytest re-transcribe route:** iterates a group's docs, overwrites transcript, auth-gated
  (researcher/owner-teacher → 200; other → 403).
- **vitest recorder lifecycle:** `visibilitychange`/`beforeunload` flush; `sessionStorage`
  resume restores `seq` and continues; indicator shows resumed/paused states.
- **Terraform:** `research_audio_retention_days=0` → no lifecycle rule; `>0` → Delete rule at
  N days (plan assertion).
- **Eval (the real test):** re-transcribe the 16 June `tiny-beetle`/`eager-stork` audio
  (in `demo-captures/research-audio/dev/_stitched/`) before/after A1; assert empty-rate drop
  and Danish+English terms correct. This is the ship gate for A1.

## Implementation Plan

| Phase | Step | Est |
|---|---|---|
| **A** | A1a — Gemini whole-file transcription (GCS audio Part + grounding prompt) + end-of-session trigger + `voice.stt.cost` span | 0.75d |
| **A** | A1b — REMOVED: Cloud STT deleted entirely (`gcp_stt.py` gone; registry knows only `gemini_*`); Gemini only, no fallback | done |
| **A** | A3 — re-transcribe route + CLI `audio retranscribe` (shares A1a) + test | 0.25d |
| **A** | A1 eval — re-transcribe 16 June audio; diff today (slice/single-lang) → Gemini whole-file; tune | 0.25d |
| **A** | A2 — recorder survive-reload (coverage; guard + sessionStorage resume + honest state + heartbeat) | 0.5d |
| **B** | Retention TTL Terraform var + plan test + record per-env values (JB) | 0.5d |
| **C** | `coverage` CLI + dashboard span | 0.25d |
| **C** | Fidelity archive — **only if A1/A2 insufficient** (decide on A3 evidence) | 1–2d (gated) |
| | **Phase A+B subtotal (the committed work)** | **~2.5d** |

## Success Criteria

- [ ] The authoritative transcript is a **whole-recording Gemini pass** at end of class (GCS audio → grounded prompt); per-segment STT is preview-only; raw audio retained as ground truth.
- [x] Cloud STT removed entirely; Gemini is the only STT engine (registry knows only `gemini_*`).
- [ ] Every transcription emits a `voice.stt.cost` span (engine/model/minutes/tokens/$) → BigQuery cost dashboard.
- [ ] Re-transcribing the 16 June `tiny-beetle`/`eager-stork` audio renders correct Danish+English physics terms (spike already shows Gemini 12k chars vs today's 360).
- [ ] `tilted-petal-71` (134 min) is transcribed via the re-transcribe path.
- [ ] Recorder survives a chat-page reload mid-lesson (resumes, continues `seq`) and warns on unload; coverage ≥90% of session in a manual end-to-end.
- [ ] `research_audio_retention_days` controls bucket TTL by env; dev = keep-all (no rule); a test value produces a Delete lifecycle rule. Per-env values recorded with JB.
- [ ] `aiplatform audio retranscribe` + `audio coverage` work end-to-end.
- [ ] Yield/coverage spans land in BigQuery (empty-rate + coverage queryable).

## Open Questions

- **Q1 (JB) — retention periods per env.** What `research_audio_retention_days` for test and
  prod? (Dev = 0 / keep-all is decided.) Feeds the data-management plan.
- **Q2 — Gemini model tier?** Spike used `gemini-2.5-flash` (best accuracy + cheapest, no
  repetition-loop). Open: Flash vs Flash-Lite (cheaper) vs Pro (if accuracy demands), standard vs
  batch tier. Decide from a small multi-group eval. (Engine settled: Gemini, full stop.)
- **Q3 (M) — higher-fidelity archive?** Likely **no** — recordings confirmed adequate by
  listening (2026-06-16). Keep only if A3 shows yield is audio-limited, not config-limited.
- **Q4 — single-device-per-group is by design** (one tablet records the discussion), but the
  16 June data shows it's fragile (one closed tab = no record). Confirm with M whether a
  second device should redundantly record, or A2's resume is sufficient.

## Related Documents

- [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) — **parent doc** (1.H); this documents the as-built divergence and adds the deferred retention decision.
- [voice-provider-abstraction.md](implemented/voice-provider-abstraction.md) — 1.1.11; the `STTProvider` registry the multi-language + recognizer-swap work extends.
- [bidirectional-voice-brief.md](bidirectional-voice-brief.md) — 1.1.23; the *tutor voice loop* (different audio path) that shares the STT provider and inherits the multi-language fix.
- [june-15-feedback.md](june-15-feedback.md) — the prior feedback map; this is the 16-June-demo successor (the "will get UI feedback from the 16 June demo" item, materialised).
- `demo-captures/2026-06-16/DEBRIEF.md` — the demo evidence base (gitignored — research-participant transcript fragments).
- `scripts/capture-demo-logs.sh`, `scripts/sync-research-audio.sh` — the capture/sync tooling built during the demo; reuse for the August pilot.
- ADR-001 (anonymous group IDs), ADR-003 (swap-shaped provider tiers), ADR-005/007 (EU residency) — scoping-site `architecture.qmd`.
- SEQUENCE.md row **1.1.35**.
