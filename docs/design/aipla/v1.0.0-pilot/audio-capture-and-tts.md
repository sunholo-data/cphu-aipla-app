# Audio capture (opt-in research data) + text-to-speech (tutor response read-aloud)

**Status**: Planned — **split implementation** (TTS unblocked; audio capture JB-gated)
**Priority**: P2 — post-Jutland, post-1.A. TTS can ship anytime; audio capture is blocked on JB consent / institutional approval sign-off
**Estimated**: ~0.5 day TTS + ~2 days audio capture (sequential; TTS can ship independently)
**Scope**: Frontend (TTS button + audio-capture UI); backend (audio upload route + Cloud Storage bucket + Firestore metadata); ops (`gs://aipla-research-audio/` bucket + IAM); **gates** (JB sign-off on consent + institutional approval — five questions in the brief)
**Dependencies**: v0.1 shipped. TTS depends on nothing else. **Audio capture depends on JB sign-off + on [teacher-permission-model.md](teacher-permission-model.md) (1.A) for the consent-flag association** (audio recordings tagged with group_id, but consent-flow shape is teacher-controlled at the class level).
**Pedagogical / privacy source-of-truth:** [`audio-capture.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/audio-capture.md) in the scoping site
**Created**: 2026-05-25
**Last Updated**: 2026-06-11

> **2026-06-11 (M, post-meeting) — this is the "record this class" requirement.** The wanted UX is a prominent **"Record this class"** button → the group talks → the lesson is captured as a research record (no-laptop, shared-device classrooms). It is a **session/class-level capture, NOT individual talk-to-type** (dictation, 1.1.11, already shipped) and **NOT the conversational loop** (`gemini_live`, deferred).
>
> **DECISION — talk-to-type and lesson-recording are MUTUALLY EXCLUSIVE modes.** Rather than share one mic stream, the chat input offers a mode toggle: *Talk-to-type* (individual dictation) **XOR** *Record lesson* (group capture). Entering record mode disables the dictation mic and shows the persistent `■ Stop recording` banner; they never contend for `getUserMedia`. Simplest + clearest, and it sidesteps the "does recording block the chat?" problem.
>
> **The gate is unchanged and HARD:** this still does not ship until JB signs off on all five consent/privacy questions below — recording minors' voices is the highest-risk surface in v1.1. The *design* is ready; the *gate* is the blocker.

## Problem Statement

Two distinct features the 2026-05-25 meeting flagged together. Splitting them is the first design decision:

**TTS (text-to-speech for tutor responses)** — *"text-to-speech may be easy way as an option"* — zero privacy implications, uses browser-native `window.speechSynthesis`, no data leaves the browser. Pure UX add. Ship-anytime.

**Audio capture (record student discussion during a session, opt-in)** — *"add the sound of students — audio at first, not video"* — significant privacy posture. Five open questions in the brief require JB sign-off before any code ships:

1. Consent age (16+ self-consent vs <16 parental consent under Danish law)
2. Institutional approval (school admin / UCPH IRB sign-off)
3. Retention period (delete-after-transcribe vs N-year retention)
4. Access control (who can listen to raw recordings)
5. Transcript-processing service (GDPR + EU data residency)

The brief is explicit: *"Do not ship audio capture until JB has signed off on all five points."*

**Current State:**

- No TTS surface — tutor responses are text-only. Students who prefer auditory or have reading difficulties get nothing.
- No audio capture infrastructure. `gs://aipla-research-audio/` doesn't exist. MediaRecorder is unused.
- Privacy DPIA work (1.13 pilot-readiness-checklist) hasn't started.

**Impact:**

- **TTS missing:** mild — affects accessibility; cheap to add.
- **Audio capture missing:** strategic — the brief notes that audio adds a research data stream beyond chat logs ("how do groups reason aloud? does the conversation shift when they discover a concept?"). High value for the research aspect of the contract; high risk if shipped without privacy gates.

## Goals

**Primary Goal (TTS part):** Every tutor message in the chat surface has a `🔊 Read aloud` icon button (placed next to timestamp, lucide-react `Volume2` icon — no emoji per [feedback-no-emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md)) that triggers `window.speechSynthesis.speak()` with the activity language. User can stop mid-utterance by clicking the button again.

**Primary Goal (audio capture part):** After ~30s of activity, students see an opt-in prompt asking permission to record group discussion for research. On consent → `getUserMedia({audio: true})` → MediaRecorder collects 10s chunks → upload to `gs://aipla-research-audio/{group_id}/{activity_id}/{timestamp}.webm`. Persistent `■ Stop recording` button always visible once recording starts. Student-initiated stop = partial upload tagged `stopped_early: true`. **All gated behind JB sign-off + per-class teacher-opt-in toggle (set in 1.G teacher-ui).**

**Success Metrics (TTS):**

- TTS button renders on every assistant message; visible at mobile widths.
- Click → speech starts within ~200ms (browser-native; no network).
- Activity language (`da` for Danish skills, `en` for KineBot) determined from skill metadata; uses appropriate voice.
- Click during speech → stops mid-utterance.
- Works in Chrome / Firefox / Safari on desktop + mobile (browser API support is universal; voice quality varies, acceptable for v1).
- Existing AppFooter accessibility section gains a note: "Tutor responses can be read aloud via the speaker icon."

**Success Metrics (audio capture, post-JB-sign-off):**

- Opt-in prompt appears after 30s of activity, dismissable (declining = no retry).
- MediaRecorder runs in 10s chunks (recoverable if browser crashes mid-session — last chunk preserved).
- Upload completes within 30s of session end for a 20-minute recording.
- `gs://aipla-research-audio/` bucket exists, IAM scoped so only the research team can list / read; AIPLA service account can write only.
- Firestore metadata at `audio_captures/{group_id}/{activity_id}/{session_timestamp}` contains the brief's full metadata shape (consent_given_at, duration_seconds).
- Deletion request flow documented (email JB; backend script wipes by group_id).
- Per-class opt-out from teacher UI (1.G): teacher can disable audio capture for their class, in which case the opt-in prompt never appears for any group in that class.

**Non-Goals:**

- Video capture (deferred per brief — higher privacy burden, lower research value).
- Real-time speech-to-text in the browser (no transcription during recording; recordings are raw audio, transcription is offline + manual).
- Speech-to-text via cloud APIs (OpenAI Whisper, Google Speech) — explicitly flagged in the brief as **needing separate privacy assessment**; not in v1.
- Audio playback for students of their own recording. v1 is one-way (record + upload + research team listens offline).
- Multilingual TTS voice selection beyond browser defaults. We pass `lang`; user gets whatever voice the browser has installed.
- Auto-pause TTS when user starts typing (nice-to-have; out of v1 scope).
- Audio capture for teacher-only sessions. Recording is student-discussion-only.

## Axiom Alignment

Two features → score them together but call out where they differ.

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 (TTS) / 0 (audio) | TTS is instant (~200ms to first sound). Audio capture has a ~30s deliberate delay before opt-in prompt (per brief; gives students time to start working before being interrupted) |
| 2 | EARNED TRUST | +1 | Audio capture's whole UX = trust-building: explicit opt-in, persistent mic indicator, always-visible stop button, deletion route. Building this *right* is the only way it gets used at all. TTS is trust-neutral |
| 3 | SKILLS, NOT FEATURES | 0 | Neither is a skill — both are platform-level affordances |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model in either |
| 5 | GRACEFUL DEGRADATION | +1 | TTS: if `speechSynthesis` unavailable (rare), button hidden. Audio: if `getUserMedia` denied, no retry, activity continues normally. Both degrade cleanly |
| 6 | PROTOCOL OVER CUSTOM | +1 | TTS uses Web Speech API (browser standard). Audio uses MediaRecorder (browser standard) → webm/opus container (standard codec) → Cloud Storage (standard). Zero custom protocols |
| 7 | API FIRST | 0 (TTS) / +1 (audio) | TTS has no API. Audio upload has a clean `POST /api/audio/upload` route with consent metadata in the body |
| 8 | OBSERVABLE BY DEFAULT | +1 | Both emit OTel spans. Audio: span attributes include consent_given_at, duration, group_id. Researcher / DPO can answer "how many students consented this week" via BigQuery aggregation |
| 9 | SECURE BY CONSTRUCTION | +1 | Audio's whole design is built around privacy gates: explicit consent, server-side IAM, no public exposure, deletion path. TTS has no data to secure. The audio feature **embodies** this axiom by structurally refusing to ship until consent semantics are confirmed |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Browser APIs do the heavy lifting (TTS = `speechSynthesis`; audio = `MediaRecorder`). Backend is upload + storage + metadata. No client-side codecs, no client-side consent logic beyond UI |
| | **Net Score** | **+7** | Threshold >= +4 OK |

**Conflict Justifications:** None.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| TTS | Web Speech API (`window.speechSynthesis`) | Browser-native; W3C spec |
| Audio recording | MediaRecorder API | Browser-native; WHATWG spec |
| Audio container | `audio/webm;codecs=opus` | Standard codec, broad browser support |
| Audio storage | Cloud Storage bucket in EU region (per ADR-005 data residency) | Standard GCP primitive |
| Audio metadata | Firestore doc per recording | Same shape as `audio_captures/{group_id}/{activity_id}/{ts}` per brief |
| Consent semantics | Explicit opt-in via browser prompt + UI toggle, recorded with timestamp | DPIA-compatible structure |
| Deletion | By group_id, manual process (no public API) | Avoids attack surface; deletion is rare + auditable |

**No new protocols.** Everything browser-standard or GCP-standard.

## CLI Surface

Audio-capture work adds operational CLI commands:

| Command | Purpose |
|---|---|
| `aiplatform audio list <group_id>` | List recordings for a group (research team / DPO use) |
| `aiplatform audio delete --group <group_id> [--confirm]` | Delete all recordings for a group (deletion request handling) |
| `aiplatform audio stats [--class <id>]` | Count consented vs declined per class (privacy / pilot reporting) |

Estimate: **~0.2 day** for the three subcommands.

TTS has no CLI surface (pure browser feature).

**Backlink:** [local-dev-cli.md](../../v6.1.0/local-dev-cli.md).

## Design

### Part 1: TTS (ships independently, no gates)

#### Component

`frontend/src/components/chat/ReadAloudButton.tsx`:

```tsx
import { Volume2, VolumeX } from "lucide-react";

interface Props { text: string; lang: string; }

export function ReadAloudButton({ text, lang }: Props) {
  const [speaking, setSpeaking] = useState(false);
  const toggle = useCallback(() => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  }, [text, lang, speaking]);

  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  return (
    <button
      onClick={toggle}
      aria-label={speaking ? "Stop reading" : "Read aloud"}
      className="text-muted-foreground hover:text-foreground"
    >
      {speaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
    </button>
  );
}
```

Mounted inside `MessageBubble` for assistant messages. Language passed from skill metadata (`skill.language` from `useSkillMeta`).

#### Files (TTS)

| File | Change | LOC |
|---|---|---|
| `frontend/src/components/chat/ReadAloudButton.tsx` (new) | The component above | ~80 |
| `frontend/src/components/chat/MessageBubble.tsx` | Mount button alongside timestamp on assistant messages | +15 |
| `frontend/src/components/chat/__tests__/ReadAloudButton.test.tsx` | jsdom-friendly tests (mock `speechSynthesis`) | ~80 |

### Part 2: Audio capture (post-JB-sign-off)

#### Pre-condition checklist (must complete before any code merges)

- [ ] JB confirms consent age + parental-consent flow for students <16
- [ ] JB confirms institutional approval path (school principal vs UCPH IRB)
- [ ] JB / AR specify retention period in data management plan
- [ ] JB specifies access control list for raw recordings
- [ ] Transcription service decision (deferred — but capture-then-transcribe-later requires no decision here; document that)

Until all five are documented + signed off, this section stays planned-only. The TTS half ships regardless.

#### Components (audio)

```
frontend/src/components/audio/
  OptInPrompt.tsx          The 30s-delay opt-in modal
  RecordingIndicator.tsx   Persistent mic icon + Stop button
  audioCaptureProvider.tsx Context provider: recording state, chunks, upload trigger
```

#### Backend

```
backend/protocols/audio_upload_routes.py
  POST /api/audio/upload    multipart: audio blob + JSON metadata
                            auth: anonymous-group JWT (per ADR-001)
                            writes blob to gs://aipla-research-audio/{group_id}/{activity_id}/{ts}.webm
                            writes Firestore doc audio_captures/{group_id}/{activity_id}/{ts}
```

#### Cloud infrastructure (ops, not code)

- Cloud Storage bucket `aipla-research-audio` in `europe-north1`
- IAM:
  - AIPLA service account: `roles/storage.objectCreator` only (write but not read/list)
  - Research team identities: `roles/storage.objectViewer` on the bucket
  - Public access: blocked
- Lifecycle policy: per retention decision (set after JB sign-off)
- Bucket-level audit logging enabled (Cloud Audit Logs)

#### Files (audio)

| File | Change | LOC |
|---|---|---|
| `frontend/src/components/audio/OptInPrompt.tsx` (new) | 30s-delay opt-in modal with bilingual copy | ~120 |
| `frontend/src/components/audio/RecordingIndicator.tsx` (new) | Persistent mic + stop button | ~80 |
| `frontend/src/components/audio/audioCaptureProvider.tsx` (new) | Context: recorder ref, chunks, state machine | ~200 |
| `frontend/src/hooks/useAudioCapture.ts` (new) | Hook wrapping the provider | ~60 |
| `frontend/src/app/chat/[...path]/page.tsx` | Mount audioCaptureProvider + OptInPrompt + RecordingIndicator gated on per-class teacher opt-in | +30 |
| `backend/protocols/audio_upload_routes.py` (new) | POST /api/audio/upload + auth + bucket-write | ~150 |
| `backend/db/audio_captures.py` (new) | Firestore CRUD for metadata docs | ~80 |
| `backend/tests/api_tests/test_audio_upload_routes.py` (new) | Pytest cases | ~150 |
| `cli/aiplatform/commands/audio.py` (new) | `list`, `delete`, `stats` | ~120 |
| `cli/tests/test_cli_audio.py` (new) | Tests | ~80 |
| `docs/ops/audio-capture-runbook.md` (new) | Operational runbook: deletion requests, retention enforcement, DPIA references | ~150 |

## API Changes

**TTS:** none.

**Audio capture (new):**

```
POST /api/audio/upload
  Content-Type: multipart/form-data
  fields: audio (blob), metadata (JSON: { group_id, activity_id, session_start, consent_given_at, duration_seconds, stopped_early })
  auth: anonymous-group JWT
  response: 204 No Content

GET /api/audio/captures/{group_id}  (teacher-auth only, for the report screen 1.G)
  response: { captures: [{ ts, duration_seconds, consent_given_at, stopped_early }] }

DELETE /api/audio/captures/{group_id}  (admin / DPO route, requires elevated auth — not exposed in v1 frontend, CLI-only)
```

## Migration

- **No existing data.** Both features are net new.
- **TTS feature flag:** none. Either it ships or doesn't.
- **Audio capture feature flag:** per-class teacher opt-in via 1.G teacher UI. Default = OFF. Even if the code ships, no recording happens until a teacher explicitly enables it for their class.
- **Rollback:** TTS revert is one commit. Audio capture revert leaves the bucket + Firestore docs intact (deliberate — research data must survive code reverts).

## v2 polish — TTS voice + language config (deferred 2026-05-26)

The TTS button as shipped today calls `speechSynthesis.speak()` with three values fixed: `lang="da"` (per skill), `rate=1.0`, and no explicit `voice` (OS picks the default). User feedback from the first live test: *"audio is a bit choppy and seems to only use Danish accent."* Three concrete polish items deferred to v2 (or to the eventual Gemini Live integration, whichever lands first):

| Improvement | Why it matters | Cost |
|---|---|---|
| **Smart per-message language detection** | Mixed Danish+English tutor turns get pronounced through one phoneme model — the wrong half sounds bad. Detect the dominant language of each message at click time, pick the matching voice. | ~15 min |
| **Voice picker UI** | macOS / Chrome ship multiple Danish voices (Sara, Magnus, Marie). Sara — the default — is choppier than the others on long sentences. Surface a one-time picker (`Volume2 ▾`) so each student picks their preferred voice + saves to localStorage. | ~30 min |
| **Per-skill voice + rate** | Some skills (LED Planck) may have a different default language than problem-set-hints. Per-skill config via `SkillConfig.tts_voice` / `SkillConfig.tts_rate` lets the skill author tune for the audience. | ~30 min + frontmatter wiring |

**Won't fix until v2 because:**
- The browser-native path has a quality ceiling. The right durable answer is the Gemini Live integration (backend/adk/live_agent.py — stub at present), which produces model-native audio at conversational quality. Polishing browser TTS is putting effort into the bridge that gets replaced.
- The 2026-05-26 internal demo found the choppy-Danish-voice issue but didn't block on it — the audio output is a polish layer, not a load-bearing feature.

**For the demo this week:** mention in the demo notes that TTS quality varies by OS voice and the picker lands in v2.

## Testing Strategy

**TTS:**

- vitest `ReadAloudButton.test.tsx`: mock `speechSynthesis`; assert speak called with correct lang + rate; assert cancel on second click
- Manual: Chrome / Firefox / Safari on desktop + mobile

**Audio capture (post-JB-sign-off):**

- vitest `OptInPrompt.test.tsx`: appears after 30s timer; dismissable; no retry after decline
- vitest `audioCaptureProvider.test.tsx`: state machine through opt-in → record → stop → upload
- pytest `test_audio_upload_routes.py`:
  - happy path: valid JWT + multipart → 204 + bucket-write + Firestore metadata doc
  - rejects without JWT → 401
  - rejects oversize blob (>50MB per session) → 413
  - rejects metadata mismatch (group_id ≠ JWT.group_id) → 403
- Manual: full session end-to-end with consent → opt-in → record 5 min → stop → upload → Cloud Storage object visible in correct path

## Implementation Plan

**Part 1 (TTS, ships independently):**

| Step | What | Est |
|---|---|---|
| 1 | `ReadAloudButton` component + tests | 0.2 d |
| 2 | Mount in `MessageBubble` | 0.1 d |
| 3 | Manual cross-browser smoke | 0.1 d |
| | **TTS subtotal** | **0.4 d** |

**Part 2 (audio capture, post-JB-sign-off):**

| Step | What | Est |
|---|---|---|
| 4 | JB sign-off documentation (output: `docs/ops/audio-capture-consent-decisions.md`) | external |
| 5 | Cloud Storage bucket + IAM provisioning (terraform / gcloud) | 0.2 d |
| 6 | Backend upload route + tests | 0.4 d |
| 7 | Firestore CRUD + Pydantic model | 0.2 d |
| 8 | Frontend audio capture provider + hook | 0.3 d |
| 9 | OptInPrompt + RecordingIndicator components | 0.3 d |
| 10 | Per-class teacher opt-in toggle (in 1.G) | 0.1 d |
| 11 | CLI parity (`audio list/delete/stats`) | 0.2 d |
| 12 | Operational runbook for deletion / retention | 0.2 d |
| 13 | Manual end-to-end + DPO review | 0.2 d |
| | **Audio capture subtotal** | **~2.1 d** |

**Total: ~2.5 d** (TTS ~0.4d ships anytime + audio capture ~2.1d gated on JB).

## Success Criteria

**TTS:**

- [ ] Read-aloud button renders on every assistant message.
- [ ] Click → speech starts in correct language within 200ms.
- [ ] Click again → stops mid-utterance.
- [ ] Works on Chrome / Firefox / Safari (desktop + mobile).
- [ ] Vitest tests green.

**Audio capture:**

- [ ] All five JB sign-off questions documented + answered in `docs/ops/audio-capture-consent-decisions.md`.
- [ ] Cloud Storage bucket exists + IAM scoped + audit logging enabled.
- [ ] Opt-in prompt appears after 30s of activity; respects decline (no retry).
- [ ] Recording uploads chunked at 10s; full session uploads on stop / session end.
- [ ] Per-class teacher opt-in toggle works (1.G integration).
- [ ] Deletion runbook documented + tested.
- [ ] CLI parity exists.
- [ ] Privacy DPIA references updated to include audio capture path.

## Out of Scope (deferred)

- Video capture.
- Real-time or post-hoc transcription (separate decision, separate privacy assessment).
- Audio playback for students.
- Multilingual TTS voice selection beyond browser defaults.
- Speech-to-text via cloud APIs (OpenAI Whisper / Google Speech) — explicitly deferred per brief.

## Related Documents

- **Source of truth + privacy gates:** [`audio-capture.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/audio-capture.md)
- [SEQUENCE.md](SEQUENCE.md) row 1.H
- [teacher-ui.md](teacher-ui.md) (1.G) — per-class opt-in toggle lives here
- [teacher-permission-model.md](teacher-permission-model.md) (1.A) — class-level consent tagging
- ADR-001 (anonymous group IDs — no PII), ADR-005 (data residency)
- [feedback-no-emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md) — lucide-react `Volume2` icon, not emoji
- v1.13 pilot-readiness-checklist (DPIA scaffold) — audio capture DPIA section ships from here
