# Student audio turns — voice as a native multimodal message (replaces dictation)

**Status:** Planned — **consent CLEARED** (signed paper waivers for the demos/pilot, same posture as the lesson recording); **replaces** the broken dictation (1.1.11); framework-native path confirmed — ready to build
**Priority:** P1 — the dictation button is in the UI now and doesn't work; this replaces it
**Estimated:** ~2–2.5d — FE audio composer (mirror 1.1.7 ImageComposer) ~1d; BE transcribe-for-display/log + dictation removal ~0.7d; tests + verify ~0.5d
**Scope:** Frontend (composer: record → attach audio part → send; bubble renders audio + transcript; remove the dictation-fills-textbox path); backend (parallel transcription for the chat-turn log + bubble; retire `POST /api/voice/stt/transcribe`)
**Dependencies:** [1.1.7 student-multimodal-upload](implemented/student-multimodal-upload.md) (the native AG-UI multimodal-input pattern this mirrors — `ImageInputContent` → ADK Part); [1.1.35 research-audio-capture-quality](research-audio-capture-quality.md) (the `GeminiSTTProvider` used for the parallel transcript); [1.1.23 bidirectional-voice](bidirectional-voice-brief.md) (the `voice_mode` axis — this is the `audio_message` mode); supersedes the dictation half of [1.1.11 voice-provider-abstraction](implemented/voice-provider-abstraction.md)
**Source (request):** M, 2026-06-16 — "the STT button is garbled; could the student send the audio directly to Gemini as an audio file in the chat, and we transcribe for the chat window / review? It needs to replace the non-functioning version. We have signed waivers for the demos."
**Last Updated:** 2026-06-16

> **Framework-native — confirmed (the 5b-ter check).** AG-UI has **`AudioInputContent`** as a
> first-class input type (`ag_ui/core/types.py:113`), and `ag_ui_adk`'s converter turns binary
> input content into an ADK `types.Part` with `inline_data` — the **identical path the image
> upload (1.1.7) uses** (`ImageInputContent` → Part → Gemini sees it, retained in session). So
> sending audio to the tutor needs **no new transport**: record → `AudioInputContent` → the
> existing stream → the Gemini tutor hears it. This is the same native-multimodal realisation
> that made 1.1.7 small.

## Problem Statement

The current dictation ("talk-to-type", 1.1.11) records audio, runs **STT → text**, drops the
text in the composer, and the student sends *text*. Two failures:

1. **It's garbled.** It used Cloud STT (now removed); even on Gemini STT it is **lossy by
   construction** — the tutor never hears the audio, only a transcription, so any recognition
   error becomes the tutor's input.
2. **It throws away the richest signal.** The tutor *is* Gemini (multimodal) — it can hear tone,
   hesitation, and Danish↔English code-switching directly. Pre-transcribing discards all of that
   before the model ever sees it.

**Current State:** composer mic → `POST /api/voice/stt/transcribe` → text fills the draft
([page.tsx:458](../../../../frontend/src/app/chat/[...path]/page.tsx#L458),
[VoiceComposerControls.tsx](../../../../frontend/src/components/chat/VoiceComposerControls.tsx)).
The audio is discarded; the tutor receives only the (often wrong) text.

## Goals

**Primary:** Replace dictation with a **native audio turn** — the student records and sends the
**audio itself** as the message; the **Gemini tutor hears it directly**; we transcribe in
**parallel** purely to give the chat bubble a readable label and the research log its text.

**Success metrics:**
- The mic records → the audio rides the message as `AudioInputContent` → the tutor processes it
  **natively** (no STT in the path to the model). Retained in session history (replayable).
- The chat **bubble shows a readable transcript** (fills in shortly after send), not an opaque blob.
- The **chat-turn log** (`aipla_chat_turn`, text) carries the transcript, so research/review is
  unaffected (still text).
- The old **dictation-fills-the-textbox path is removed** — the mic no longer pre-digests to text.
- A transcription error **no longer changes what the tutor understood** (it heard the audio).

**Non-Goals:**
- **`gemini_live` duplex streaming** (1.1.23, deferred) — this is a *discrete push-to-talk
  message*, not a live conversation stream. Simpler, and what's needed now.
- TTS / read-aloud of the reply — unchanged (persona voice, 1.1.12).
- Changing the lesson **recording** path (1.1.35) — separate; this is interactive tutor input.

## Consent / privacy (cleared, recorded)

Sending raw student audio **to the model** is a larger egress than dictation's transcript-only
posture. **Consent is cleared for the demos/pilot via signed paper waivers** (the same posture
that unblocked lesson recording, 2026-06-11) — so this is **un-gated** to build. Recorded for the
DPIA: audio reaches Gemini (Vertex, EU residency ADR-005); the consent gesture is the explicit
**send**; the audio is retained in session history (ADK), same as uploaded images. Beyond the
waivered pilot, a per-class capability gate (reuse the `voiceInput` flag, 1.1.11) governs it.

## Design

### Frontend — record → audio part → send (mirror the image composer)

- A new `useAudioAttachment` hook + composer control that, on press-and-hold / tap-record →
  stop, produces an audio blob (the existing `audioCapture.ts` WAV path or `MediaRecorder`) and
  **stages it as an attachment** — exactly as `useImageAttachments` / `ImageComposer` (1.1.7) do
  for images. On send, the message `content` carries an **`AudioInputContent`** part (+ any typed
  text).
- The **bubble** renders an audio chip (play + duration) with the **transcript beneath it** once
  it lands (the bubble subscribes to the turn's transcript like the recording transcript does).
- **Remove** the dictation path: the mic no longer calls `/stt/transcribe` to fill the draft;
  `VoiceComposerControls` "dictating" mode becomes "recording an audio message."

### Backend — audio to the tutor is free; transcribe for display + log

- **To the tutor: no new code.** `AudioInputContent` → `ag_ui_adk` converter → ADK audio `Part`
  → the Gemini tutor (the image-upload path, confirmed). Audio is retained in session events.
- **Transcript for the bubble + log:** on an audio turn, transcribe the audio with
  `GeminiSTTProvider` (1.1.35) and attach the text to the turn so (a) the bubble shows it and (b)
  `emit_chat_turn` logs **text** to `aipla_chat_turn` (research/review unchanged). This runs
  off the model's critical path — the tutor doesn't wait on it; the model already has the audio.
- **Retire** `POST /api/voice/stt/transcribe` (dictation) — no caller after the FE change. Keep
  the STT provider (used by recording + this transcription).

### Where the transcription happens (one decision)

- **(a) Client transcribes before send** — bubble shows text instantly, but re-introduces the
  "lossy text first" shape and a pre-send wait. ✗
- **(b) Server transcribes the audio part in parallel** with the tutor turn — the model gets the
  audio immediately; the transcript lands a moment later for the bubble + log. **✓ recommended** —
  the audio is primary, the transcript is a derived label.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | The message sends as audio immediately (no pre-send STT wait); the tutor starts on the audio at once; transcript fills in after. |
| 2 | EARNED TRUST | +1 | The tutor reasons over what was *actually said*, not a guess; the bubble still shows a readable transcript + the audio is the ground truth. |
| 3 | SKILLS, NOT FEATURES | 0 | Platform composer affordance. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Lets the multimodal model do what it's for (hear audio) instead of a lossy STT pre-step; STT is now only a display/log convenience. |
| 5 | GRACEFUL DEGRADATION | +1 | Transcript failure → bubble shows "audio message" + the audio still plays + the tutor still heard it; mic/permission denied → fall back to typing. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Uses AG-UI `AudioInputContent` + `ag_ui_adk` + ADK Parts natively — no custom transport (5b-ter check passed). |
| 7 | API FIRST | +1 | Audio rides the standard message content; any channel that speaks AG-UI inherits it. |
| 8 | OBSERVABLE BY DEFAULT | +1 | The turn logs text (transcript) to `aipla_chat_turn`; a `voice.stt` span covers the parallel transcription cost. |
| 9 | SECURE BY CONSTRUCTION | 0 | Audio-to-model egress is the new flow — **cleared by signed waivers** + per-class `voiceInput` gate; EU residency; retained in session like images. Recorded for the DPIA. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Client records + stages + plays; the backend transcribes + logs; no client-side model logic. |
| 11 | USABLE BY DESIGN | +1 | Replaces a broken button with one that works; designed bubble (audio + transcript), recording/permission/fallback states. |
| | **Net Score** | **+9** | Threshold ≥ +4. |

**Conflict Justifications:** none at −1 (audio egress is consent-cleared + gated).

## Implementation Plan

| Step | What | Scope | Est |
|---|---|---|---|
| 1 | `useAudioAttachment` + composer control (record → stage audio attachment), mirroring `useImageAttachments`/`ImageComposer` | FE | 0.5d |
| 2 | Send `AudioInputContent` on the message; bubble renders audio chip + transcript slot | FE | 0.4d |
| 3 | Remove dictation: mic no longer calls `/stt/transcribe`; repoint `VoiceComposerControls` | FE | 0.2d |
| 4 | Backend: transcribe the audio turn (GeminiSTTProvider) → attach to the turn for bubble + `emit_chat_turn` log | BE | 0.5d |
| 5 | Retire `POST /api/voice/stt/transcribe` (+ its tests) | BE | 0.2d |
| 6 | Tests (vitest composer/bubble, pytest transcription-for-log) + browser verify (record → tutor hears → transcript shows) | both | 0.5d |
| | **Total** | | **~2.3d** |

## Success Criteria

- [ ] Recording sends the **audio** as the message; the Gemini tutor responds to the audio (verified the audio Part reaches the model, retained in session).
- [ ] The bubble shows a playable audio chip **+ a readable transcript** that lands shortly after.
- [ ] `aipla_chat_turn` logs the transcript text (research/review unchanged).
- [ ] The dictation-fills-textbox path + `/stt/transcribe` route are removed.
- [ ] Transcript failure degrades gracefully (audio still sent + heard); mic denied → typing fallback.
- [ ] vitest + pytest green; browser verify of the full round-trip.

## Open Questions

- **Q1 — capture format.** Reuse `audioCapture.ts` (16 kHz WAV) — fine for both Gemini (audio
  input) and the parallel transcript. Confirm Gemini accepts the WAV part inline (size: a short
  utterance is well under the inline cap).
- **Q2 — text + audio in one turn.** Allow the student to add typed text alongside the audio
  (both Parts in one message)? Yes — `content` is a list; mirror the image+text case.
- **Q3 — per-class gate.** Reuse `voiceInput` capability (1.1.11) as the on/off, now meaning
  "audio-message mode" rather than "dictation."

## Related Documents

- [student-multimodal-upload](implemented/student-multimodal-upload.md) — 1.1.7; the native multimodal-input pattern this mirrors (image → audio).
- [research-audio-capture-quality](research-audio-capture-quality.md) — 1.1.35; the `GeminiSTTProvider` used for the parallel transcript.
- [bidirectional-voice-brief](bidirectional-voice-brief.md) — 1.1.23; the `voice_mode` axis — this is the `audio_message` mode (simpler than `gemini_live`, richer than `stt_tts_roundtrip`).
- [voice-provider-abstraction](implemented/voice-provider-abstraction.md) — 1.1.11; the dictation this supersedes.
- `ag_ui/core/types.py` `AudioInputContent`; `ag_ui_adk/utils/converters.py` (binary → Part).
- SEQUENCE.md row **1.1.37**.
