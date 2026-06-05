# Voice provider abstraction — backend TTS/STT routes + dictation, swap-shaped

**Status:** Planned (P1)
**Last Updated:** 2026-06-03
**Priority:** **P1** — voice quality flagged at 2026-05-26 internal demo (choppy macOS Danish "Sara") and reinforced as a "lesson ease" item in today's feedback. Dictation is the most-asked accessibility upgrade after multimodal upload (1.1.7)
**Estimated:** ~1.5d (provider abstraction + GCP TTS + read-aloud swap) + ~1d (STT + dictation button) + ~0.5d (cost meter + CLI + ops runbook) = **~3d**
**Scope:** Fullstack — `backend/voice/` package (new) + `backend/protocols/voice_routes.py` (new) + `frontend/src/components/chat/ReadAloudButton.tsx` (extend) + `DictateButton.tsx` (new) + per-class teacher toggle (extend 1.G) + `cli/aiplatform/commands/voice.py` (new) + ops runbook
**Dependencies:**
- v1.0 [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) Part 1 shipped (browser-native TTS button exists) — this doc supersedes its "v2 polish" section
- [cost-dashboard.md](cost-dashboard.md) (1.1.9) — voice spans feed this dashboard
- [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) (1.G) — per-class voice toggle lives here
- ADR-003 (four-tier model selection) — voice mirrors the pattern
- ADR-005 (data residency) — providers in `europe-north1` / EU
**Source brief:** Conversation 2026-06-03 (this doc encodes the architectural decisions and cost model worked out during the voice-quality discussion)

## Problem

Three things landed together at today's feedback session:

1. **Read-aloud quality is OS-dependent and choppy.** The shipped `window.speechSynthesis` button works, but on macOS the default Danish voice "Sara" stalls mid-utterance on long sentences. Voice quality varies by browser/OS combo with no way to control or test it from the platform. Flagged 2026-05-26 internal demo; reinforced today.
2. **No dictation surface.** Students can only type. "Lesson ease" calls for a microphone button so a student on a tablet can speak a problem-set hint request or describe a concept aloud instead of typing — important for accessibility, mobile typing speed, and the small fraction of students with reading-output asymmetries.
3. **Architecture risk.** Any single-vendor choice today locks the pilot into one cloud. The [self-hosting trajectory](file:///Users/mark/Documents/clients/cph-uni/self-hosting.qmd) means voice — like LLMs (ADR-003) — must be swap-shaped from day one: cloud API → server-local → on-device → on-prem GPU cluster. Hardcoding `texttospeech_v1.TextToSpeechClient()` calls into a route handler is the wrong shape.

The shipped browser-native path was the right v1 call (free, no backend, no network) and stays as one provider implementation. This doc adds the next two tiers (Cloud APIs + abstraction) without ripping it out.

## Goals

**Primary goal:** A `backend/voice/` package with `TTSProvider` + `STTProvider` `Protocol` interfaces and a registry that selects an implementation by env var or per-`SkillConfig`. Cloud TTS (Standard for the spike, WaveNet once verified) and Cloud STT (`latest_long` for Danish) land as the first two server-side providers, behind clean REST routes. Browser-native stays as the no-network default.

**Concrete shippable outcomes:**

1. `backend/voice/base.py` — `TTSProvider` / `STTProvider` `Protocol` classes (three methods total; narrow on purpose)
2. `backend/voice/registry.py` — env var / per-skill selection mirroring `backend/adk/agent.py` model-picking
3. `backend/voice/providers/{gcp_tts,gcp_stt,browser}.py` — first three implementations
4. `POST /api/voice/tts/synthesize` + `POST /api/voice/stt/transcribe` + `GET /api/voice/config` — clean routes with content-hash caching to `gs://aipla-dev-2026-tts-cache/` for TTS
5. `ReadAloudButton.tsx` extended with a `provider` prop: when `gcp`, it fetches an audio blob; when `browser`, it uses Web Speech as today
6. **Auto-read toggle (new):** student-side preference — when ON, every assistant message (including proactive-tutor turns from 1.1.2) is automatically spoken on stream-complete; when OFF, current click-to-read behaviour is preserved. Stored in `localStorage` per student-session, surfaced as a toggle in the `AppFooter` next to the existing accessibility note. Pairs with [proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md) — students who want a hands-off auditory loop get it for free with proactive turns
7. New `DictateButton.tsx` — lucide-react `Mic` / `MicOff` icon next to the input box on problem-set-helper and concept-dialogue input rows, gated behind `NEXT_PUBLIC_VOICE_STT=on` and per-class teacher toggle
8. OTel span attributes `voice.provider`, `voice.chars`, `voice.duration_ms`, `voice.cache_hit`, `voice.auto_read` → feed the [cost-dashboard](cost-dashboard.md). `auto_read=true` rows are useful: a class with auto-read on costs more per session.
9. `aiplatform voice list-providers` + `aiplatform voice spike <text> --lang da [--provider gcp_wavenet]` CLI commands
10. `docs/ops/voice-providers-runbook.md` — provider config, env var matrix, swap procedure for UCPH self-hosting

**Success metrics:**

- TTS first-audio latency ≤500ms p95 on Cloud TTS round-trip from `europe-north1`
- TTS cache hit on a re-played tutor message returns the audio with zero provider cost (BigQuery `voice.cache_hit=true` rows)
- STT round-trip on a 5-second Danish utterance: transcript returned ≤1.5s p95
- All four `backend/voice/` files pass `make lint` + carry pytest coverage
- One end-to-end demo: a student speaks "Hvad er Plancks konstant?" into the dictation button, the transcript fills the input, the tutor response is read aloud via WaveNet
- Cost dashboard shows per-provider character/minute counts with daily aggregation
- Provider swap from `gcp_wavenet` → `gcp_neural2` requires a single env var change, no code edit

**Non-goals (deferred to later docs):**

- Gemini Live / ADK LiveRunner — [backend/adk/live_agent.py](../../../../backend/adk/live_agent.py) stays a stub until a conversational-tutor design doc exists (v1.2+). The `voice/` package is **not** an interface for bidi streaming; that's a different shape.
- Voice cloning, SSML editor, prosody tuning UI — provider-specific extras pass through an opaque `extras: dict` parameter on the Protocol so providers like ElevenLabs / Studio voices can expose SSML / style controls later without changing the interface
- Speech-to-speech direct (no STT→LLM→TTS roundtrip) — that's the LiveRunner story
- Transcribing the audio-capture research stream — that's [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) Part 2, still JB-gated; this doc is real-time student dictation only
- OpenAI Whisper / Azure Speech / self-hosted Whisper provider implementations — covered by the abstraction but not built in this sprint. The Protocol existing is the deliverable; the additional providers add files in `providers/` later without touching the interface

## Standards check

Searched for an established cross-provider voice protocol; **none exists at a useful level**:

- [LiteLLM](https://docs.litellm.ai/) has Whisper STT support but TTS coverage is patchy and provider-specific — doesn't give us a stable Protocol to import
- Web Speech API (W3C) is a *browser-side* standard, not a server provider interface — used as one provider implementation, not as the abstraction
- MCP, AG-UI, A2UI don't define voice provider interfaces (those are higher-level transports)

Per [feedback_search_protocols_first](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_search_protocols_first.md) the honest call is: write the thinnest possible Protocol and move on. The interface is three methods total (`synthesize`, `transcribe`, `describe`), with provider-specific config passed through an opaque `extras: dict`. BCP-47 language tags (`"da"`, `"en"`) throughout — that's the standard that does apply here.

## Design

### Backend package layout

```
backend/voice/
  __init__.py           # re-export TTSProvider, STTProvider, get_tts, get_stt
  base.py               # Protocol classes (~60 LOC)
  registry.py           # env / per-skill selection (~80 LOC, mirrors adk/agent.py)
  cache.py              # content-hash TTS cache to gs://aipla-dev-2026-tts-cache/ (~80 LOC)
  providers/
    __init__.py
    browser.py          # signal-only — backend returns { provider: "browser" }, FE uses Web Speech (~30 LOC)
    gcp_tts.py          # google-cloud-texttospeech, Standard / WaveNet / Neural2 / Chirp3HD by config (~120 LOC)
    gcp_stt.py          # google-cloud-speech, latest_long Danish (~100 LOC)
    null.py             # for tests / explicit-disable (~20 LOC)
```

### The Protocols (the whole abstraction)

```python
# backend/voice/base.py
from typing import Protocol, TypedDict, runtime_checkable

class VoiceCapabilities(TypedDict):
    """What a provider can do, returned by .describe(). Frontend uses this
    to decide whether to render the button at all."""
    tts: bool
    stt: bool
    streaming: bool
    languages: list[str]  # BCP-47 tags

@runtime_checkable
class TTSProvider(Protocol):
    name: str  # registry key, e.g. "gcp_wavenet"

    async def synthesize(
        self,
        text: str,
        lang: str,           # BCP-47, e.g. "da" or "en"
        voice: str | None,   # provider-specific voice name, or None for default
        extras: dict | None, # opaque provider-specific config (SSML, prosody, etc.)
    ) -> tuple[bytes, str]:
        """Return (audio_bytes, mime_type). lang is BCP-47."""

    def describe(self) -> VoiceCapabilities: ...

@runtime_checkable
class STTProvider(Protocol):
    name: str

    async def transcribe(
        self,
        audio: bytes,
        mime: str,           # "audio/webm;codecs=opus" from MediaRecorder
        lang: str,           # BCP-47
        extras: dict | None,
    ) -> str:
        """Return plain transcript text. No segments / timestamps in v1 —
        keep the interface narrow; add structured output via a follow-up
        if needed."""

    def describe(self) -> VoiceCapabilities: ...
```

That is the entire surface. Three methods, opaque `extras`, no provider quirks at the interface.

### Registry / selection

```python
# backend/voice/registry.py
def get_tts(skill_config: SkillConfig | None = None) -> TTSProvider:
    """Resolve in order: SkillConfig.voice.tts_provider → env VOICE_TTS_PROVIDER → "browser"."""

def get_stt(skill_config: SkillConfig | None = None) -> STTProvider:
    """Same resolution chain for STT."""
```

`SkillConfig.voice` is a new optional Pydantic block:

```python
class SkillVoiceConfig(BaseModel):
    tts_provider: str | None = None  # "browser", "gcp_standard", "gcp_wavenet", ...
    tts_voice: str | None = None     # e.g. "da-DK-Wavenet-A"
    stt_provider: str | None = None
    rate: float = 0.9                # universal across providers; provider applies if supported
```

### API routes

`backend/protocols/voice_routes.py`:

| Method + path | Body | Response | Auth |
|---|---|---|---|
| `GET /api/voice/config?skill_id=...` | — | `{ tts: { provider, voice, capabilities }, stt: { provider, capabilities } }` | Anonymous-group JWT |
| `POST /api/voice/tts/synthesize` | `{ text, lang, voice?, skill_id? }` | `audio/mpeg` blob (or `audio/ogg` for Chirp) — content-hash-keyed cache check first | Anonymous-group JWT, rate-limited |
| `POST /api/voice/stt/transcribe` | `multipart`: `audio` (blob) + `lang` + `skill_id?` | `{ transcript: string }` | Anonymous-group JWT, rate-limited, audio NEVER persisted |

### Caching (TTS only)

`backend/voice/cache.py` keys by `sha256(provider + voice + lang + rate + text)` and writes to `gs://aipla-dev-2026-tts-cache/{hash[:2]}/{hash}.{ext}`. Cache hits emit OTel `voice.cache_hit=true` and return the GCS object directly. This is the cost-control move — re-played tutor messages cost zero.

STT is not cached (one-shot voice notes; no point hashing audio).

### Frontend

[ReadAloudButton.tsx](../../../../frontend/src/components/chat/ReadAloudButton.tsx) gains a `provider` prop derived from `/api/voice/config`:

- `provider="browser"` → existing path, no change
- `provider="gcp_..."` → fetch `/api/voice/tts/synthesize`, play the returned blob via `new Audio(URL.createObjectURL(blob))`. Click again cancels and revokes the URL.

**Auto-read toggle.** New `useAutoReadAloud` hook + `AutoReadToggle.tsx` component in the AppFooter:

- Toggle states: `off` (default, current behaviour) / `on` (auto-speak every assistant message on stream-complete)
- Persisted to `localStorage` under `aipla.voice.auto_read` (per browser, not per-class — student preference)
- When ON, `MessageBubble` calls `ReadAloudButton`'s speak handler imperatively when the message's stream-complete event fires (AG-UI `RUN_FINISHED` for that turn)
- **Barge-in interactions** (designed up-front per Axiom 11):
  - Student starts typing in the input box → cancel any in-flight TTS (the student wants to ask something, not listen)
  - Student starts dictating (Phase B `DictateButton`) → cancel any in-flight TTS
  - New tutor turn arrives while previous turn still speaking → queue the new turn (don't talk over self)
- **Proactive-turn handling** ([proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md) interaction): proactive turns auto-read just like any other assistant message when toggle is on. This is the "hands-off auditory loop" — student runs a Boldkast sim, tutor speaks the observation without the student touching anything.
- **Cost implication:** auto-read on with WaveNet is roughly 5x cost per session (every turn synthesised vs ~20% click-rate). OTel span carries `voice.auto_read=true` so the cost dashboard can show "auto-read cost" as a separate aggregate line.
- **Disabled when STT teacher-toggle is on but TTS provider is browser** — auto-read still uses browser Web Speech (current path), just fires automatically. No backend cost.

New `frontend/src/components/chat/DictateButton.tsx`:

- Lucide `Mic` icon next to chat input, replaces with `MicOff` while recording
- `getUserMedia({ audio: true })` → `MediaRecorder` (webm/opus) → stop on second click or 30s timeout → `POST /api/voice/stt/transcribe` → fill input with the transcript
- Visible only if `voiceCapabilities.stt === true` from `/api/voice/config`
- Gated behind per-class teacher toggle (extends [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) 1.G), default OFF

Empty / loading / error states for DictateButton (Axiom 11):
- **Empty / idle:** Mic icon, hover tooltip "Tal i stedet for at skrive" (DA) / "Speak instead of typing" (EN)
- **Loading (recording):** MicOff icon, pulsing red dot, timer badge `0:05` counting up
- **Error:** mic-permission denied → toast "Tilladelse til mikrofon afvist. Tryk på adresselinjen for at ændre." (DA), button disabled. Network failure → toast "Kunne ikke sende lydoptagelse. Prøv igen." Input keeps focus; nothing destroys typed text.

### CLI surface

[local-dev-cli](../../v6.1.0/local-dev-cli.md) gains `aiplatform voice`:

| Command | Purpose |
|---|---|
| `aiplatform voice list-providers` | Show registered providers + their capabilities (calls `GET /api/voice/config` minus skill_id) |
| `aiplatform voice spike <text> --lang da [--provider gcp_wavenet] [--out /tmp/x.mp3]` | One-shot TTS to a local file; used in the spike scripts and for AR voice-comparison sessions |
| `aiplatform voice transcribe <file.webm> --lang da [--provider gcp_latest_long]` | One-shot STT from a local file; debugging dictation issues |

### Files

| File | Change | LOC |
|---|---|---|
| `backend/voice/base.py` (new) | Protocols + VoiceCapabilities TypedDict | ~60 |
| `backend/voice/registry.py` (new) | env / SkillConfig selection | ~80 |
| `backend/voice/cache.py` (new) | content-hash GCS cache | ~80 |
| `backend/voice/providers/gcp_tts.py` (new) | google-cloud-texttospeech wrapper, voice-tier config | ~120 |
| `backend/voice/providers/gcp_stt.py` (new) | google-cloud-speech wrapper, `latest_long` | ~100 |
| `backend/voice/providers/browser.py` (new) | signal-only ("use Web Speech") | ~30 |
| `backend/voice/providers/null.py` (new) | tests / explicit-disable | ~20 |
| `backend/protocols/voice_routes.py` (new) | 3 routes + cache check + OTel spans | ~150 |
| `backend/db/skill_config.py` (extend) | `SkillVoiceConfig` Pydantic + integration | +20 |
| `backend/tests/unit/test_voice_providers.py` (new) | Protocol conformance + selection logic | ~80 |
| `backend/tests/api_tests/test_voice_routes.py` (new) | route happy/sad paths + cache + auth | ~150 |
| `scripts/spike_tts.py` (new) | spike #1: Danish TTS tier comparison → `/tmp/tts_spike/` | ~60 |
| `scripts/spike_stt.py` (new) | spike #2: round-trip TTS→STT Danish accuracy test | ~60 |
| `frontend/src/components/chat/ReadAloudButton.tsx` (extend) | `provider` prop + blob path | +30 |
| `frontend/src/components/chat/DictateButton.tsx` (new) | mic button + MediaRecorder + transcribe POST | ~150 |
| `frontend/src/components/chat/__tests__/DictateButton.test.tsx` (new) | jsdom + MediaRecorder mocks | ~80 |
| `frontend/src/components/chat/MessageBubble.tsx` (extend) | pass `provider` to ReadAloudButton from `/api/voice/config` | +10 |
| `frontend/src/components/chat/ChatInput.tsx` (extend) | mount DictateButton inline | +20 |
| `frontend/src/hooks/useVoiceConfig.ts` (new) | client cache of `GET /api/voice/config` per skill | ~50 |
| `frontend/src/hooks/useAutoReadAloud.ts` (new) | localStorage + AG-UI `RUN_FINISHED` listener + barge-in cancellation | ~80 |
| `frontend/src/hooks/__tests__/useAutoReadAloud.test.ts` (new) | toggle persistence + barge-in + queueing | ~80 |
| `frontend/src/components/chat/AutoReadToggle.tsx` (new) | toggle UI in AppFooter | ~50 |
| `frontend/src/components/AppFooter.tsx` (extend) | mount AutoReadToggle next to existing accessibility note | +15 |
| `frontend/src/app/teacher/[classId]/page.tsx` (extend) | per-class voice toggle (1.G integration) | +40 |
| `cli/aiplatform/commands/voice.py` (new) | `list-providers`, `spike`, `transcribe` subcommands | ~80 |
| `cli/tests/test_cli_voice.py` (new) | typer testing | ~60 |
| `docs/ops/voice-providers-runbook.md` (new) | env matrix, swap procedure, cost monitoring | ~150 |

**Total:** ~1,790 LOC new, ~105 LOC modified (auto-read toggle adds ~210 LOC).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Cache hit returns audio in <50ms (GCS read). Cold TTS round-trip ~300-500ms via `europe-north1`. Dictation: streaming-style "thinking" indicator during the 1-2s STT call. Net: feels instant on the common path |
| 2 | EARNED TRUST | 0 | Voice is presentation; doesn't add factual claims. Transcripts shown back to the student in the input field before send (so they can correct STT errors before they reach the tutor) — small +, but neutral overall |
| 3 | SKILLS, NOT FEATURES | +1 | `SkillVoiceConfig` lives in `SkillConfig` — a physics tutor can pin WaveNet for Danish, KineBot can stay on browser. Voice is a per-skill capability, not a global toggle |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | The entire doc *is* tier selection: Standard ($4/M) for ephemeral system text, WaveNet ($4/M) for tutor replies, self-hosted Whisper (free at scale) for UCPH future. Explicit per-provider choice is the point |
| 5 | GRACEFUL DEGRADATION | +1 | Backend provider down → frontend falls back to browser Web Speech (already shipped, always available). STT failure → toast, input keeps focus, typing path always works. Cache GCS unavailable → bypass cache, still synthesize. No single point of failure has user-visible effect beyond "voice button slower than usual" |
| 6 | PROTOCOL OVER CUSTOM | 0 | Browser Web Speech is W3C standard (kept as a provider). BCP-47 lang tags throughout. But the cross-provider voice Protocol is custom — explicitly because no standard exists at this level (LiteLLM Whisper isn't a usable TTS abstraction). Documented search in the Standards check above; -1 not warranted because the *internal* Protocol is the thinnest possible and no protocol was bypassed |
| 7 | API FIRST | +1 | `POST /api/voice/tts/synthesize`, `POST /api/voice/stt/transcribe`, `GET /api/voice/config` — clean routes. Telegram / CLI / future channels reuse them by calling the same routes; no channel-specific voice logic |
| 8 | OBSERVABLE BY DEFAULT | +1 | Every synthesize/transcribe emits an OTel span with `voice.provider`, `voice.chars` / `voice.duration_ms`, `voice.cache_hit`, `voice.cost_estimate_usd`. Feeds [cost-dashboard.md](cost-dashboard.md) directly. BigQuery query "how much did WaveNet cost last week" is a one-liner |
| 9 | SECURE BY CONSTRUCTION | +1 | STT audio NEVER persisted (consumed in-process, discarded after transcribe returns). TTS cache key is `sha256(text+config)` — no PII in object names; bucket is private; default lifecycle 90d. Provider configs in `europe-north1` (ADR-005). Per-class teacher toggle is the consent surface (Axiom doesn't ship without 1.G integration). Audio never leaves the GCP project edge for the supported providers |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Frontend doesn't know which provider answered. `provider` field in `/api/voice/config` is opaque; the blob renders the same regardless. Provider switching is purely backend config. No client-side codec / model / vendor SDK |
| 11 | USABLE BY DESIGN | +1 | DictateButton has designed idle / recording / error states *before* implementation (Design section above). Recording timer prevents the "is it actually recording" silent failure. Permission-denied has a specific, actionable Danish error message. Read-aloud cache means a second-listen is instant, not a UX cliff. **Auto-read toggle has designed barge-in semantics** (typing cancels TTS, dictation cancels TTS, concurrent turns queue) before implementation — avoiding the "AI talks over me" footgun that kills this kind of feature when shipped naively |
| | **Net Score** | **+8** | Threshold >= +4 ✓; target +7 met |

**Conflict Justifications:** None — no axiom scored -1.

**Hard-fail checks:**
- EARNED TRUST is 0 (not -1) and the feature involves no factual claims → OK
- SECURE BY CONSTRUCTION is +1 → OK
- USABLE BY DESIGN is +1 with designed states → OK
- Zero axioms at -1 → well under the 2-axiom limit

## API Changes

```
GET /api/voice/config?skill_id={skill_id}
  auth: anonymous-group JWT
  response: {
    tts: { provider: "browser"|"gcp_wavenet"|..., voice: string|null, capabilities: VoiceCapabilities },
    stt: { provider: "gcp_latest_long"|"disabled", capabilities: VoiceCapabilities }
  }

POST /api/voice/tts/synthesize
  body: { text: string, lang: string, voice?: string, skill_id?: string }
  auth: anonymous-group JWT, rate-limited (per group_id, 60/min)
  response: 200 audio/mpeg | audio/ogg blob (provider-dependent mime)
            OR 200 { provider: "browser" } if config selects browser path
            (in which case the frontend falls through to Web Speech)
  headers: X-Voice-Provider, X-Voice-Cache-Hit, X-Voice-Cost-Usd

POST /api/voice/stt/transcribe
  body: multipart/form-data; fields: audio (blob), lang, skill_id?
  auth: anonymous-group JWT, rate-limited (per group_id, 30/min, max 30s audio)
  response: 200 { transcript: string, provider: string, duration_ms: number }
  errors: 413 if audio > 5 MB; 400 if audio > 30s; 503 if provider down (FE falls back to typing)
```

## Migration

- **No existing data.** Net new routes + new GCS bucket.
- **Bucket provisioning:** `gs://aipla-dev-2026-tts-cache` — same pattern as existing artefact buckets; service account `aipla-v6-backend` gets `roles/storage.objectAdmin` on this bucket only; lifecycle 90d to control storage growth
- **Feature flags:**
  - `NEXT_PUBLIC_VOICE_TTS=browser|gcp` (default `browser` so reverting is a single env var change)
  - `NEXT_PUBLIC_VOICE_STT=on|off` (default `off` until teacher UI 1.G integration ships)
  - `VOICE_TTS_PROVIDER` / `VOICE_STT_PROVIDER` backend env vars
  - `SkillConfig.voice.{tts_provider,stt_provider}` per-skill overrides
- **Per-class teacher toggle:** lives in 1.G class-detail page. Default OFF. Teacher enables for their class → all groups in that class see the dictation button. Even if backend providers are configured, no audio is captured without the toggle.
- **Rollback:** flip `NEXT_PUBLIC_VOICE_TTS=browser`, `NEXT_PUBLIC_VOICE_STT=off`. Cache bucket retained (idempotent — re-deploying restores behaviour without re-synthesizing).

## Testing strategy

**Backend (pytest):**

- `test_voice_providers.py`:
  - Protocol conformance: `isinstance(gcp_tts_provider, TTSProvider)` runtime check
  - Registry selection: env var beats default, SkillConfig beats env var, missing config falls back to "browser"
  - Cache: hit returns bytes without provider call (mock the GCP client, assert it was NOT called)
- `test_voice_routes.py`:
  - `/api/voice/tts/synthesize` happy path: 200 + audio bytes + correct X-Voice-Provider header
  - Cache hit on second call: provider mock called exactly once
  - Browser-config path: returns `{ provider: "browser" }` JSON, not audio
  - `/api/voice/stt/transcribe` happy path: 200 + transcript
  - 401 without JWT, 413 oversize, 400 too-long, 503 provider-down
- Marked `@pytest.mark.integration` (uses real GCP):
  - `test_gcp_tts_danish_roundtrip` — synthesize "Hej, hvad er Plancks konstant?" via WaveNet, assert ≥1 KB MP3 returned, latency <1s
  - `test_gcp_stt_danish_roundtrip` — feed the above MP3 (converted to WAV) back into STT, assert transcript contains "Planck"

**Frontend (vitest):**

- `ReadAloudButton.test.tsx`: provider=browser path unchanged; provider=gcp_* path mocks fetch, asserts audio blob playback
- `DictateButton.test.tsx`:
  - Mic permission granted → MediaRecorder starts, button shows MicOff
  - Second click → recorder stops, POST issued, transcript fills input
  - Permission denied → toast shown, button disabled
  - 30s timeout → auto-stop + transcribe
- `useVoiceConfig.test.ts`: caches per skill_id, refetches on skill change

**Spike scripts (manual, but committed for repeatability):**

- `scripts/spike_tts.py`: synthesize one Danish sentence on {Standard-F, Standard-G, WaveNet-A, WaveNet-C, WaveNet-D, Neural2-F, Chirp3-HD-Aoede} → save to `/tmp/tts_spike/{voice}.mp3`. Listen, pick.
- `scripts/spike_stt.py`: round-trip the WaveNet-A output back into `latest_long` → assert transcript matches input.

**Manual:**

- End-to-end: open LOCAL_MODE with `concept-dialogue-config`, click mic → speak "Hvad er Plancks konstant?" → input fills → send → tutor responds → click Volume2 → WaveNet plays Danish.
- Per-class teacher toggle: log in as test-teacher, enable for class, verify dictation button appears in that class's student view; disable, verify it disappears.

## Implementation plan

Suggested two-week-friendly milestone breakdown (concrete sprint-plan numbers will come from the sprint-planner skill):

| Step | What | Est |
|---|---|---|
| M1 | `backend/voice/base.py` + `registry.py` + `null.py` + unit tests | 0.3d |
| M2 | `backend/voice/providers/gcp_tts.py` + `cache.py` + integration test | 0.4d |
| M3 | `scripts/spike_tts.py` + AR-and-M listen-and-pick session (Danish voice choice) | 0.2d (incl. listen time) |
| M4 | `backend/protocols/voice_routes.py` (TTS half) + `test_voice_routes.py` (TTS half) + OTel spans | 0.3d |
| M5 | `useVoiceConfig.ts` + `ReadAloudButton.tsx` extend + `MessageBubble.tsx` wire + vitest | 0.3d |
| M6 | `backend/voice/providers/gcp_stt.py` + integration test | 0.3d |
| M7 | `scripts/spike_stt.py` + round-trip verification | 0.1d |
| M8 | `voice_routes.py` STT half + tests | 0.2d |
| M9 | `DictateButton.tsx` + tests + `ChatInput.tsx` wire | 0.4d |
| M10 | Per-class teacher toggle (1.G integration) | 0.2d |
| M11 | `SkillVoiceConfig` pydantic + `SkillConfig` integration + tests | 0.1d |
| M12 | `cli/aiplatform/commands/voice.py` + tests | 0.2d |
| M13 | `docs/ops/voice-providers-runbook.md` | 0.2d |
| M14 | Cost-dashboard wiring (extend the 1.1.9 dashboard with voice spans) | 0.1d |
| M15 | Manual end-to-end + AR/JB voice-quality review | 0.2d |
| | **Total** | **~3.5d** |

The TTS half (M1–M5) ships independently and can land before M6 starts — it's a useful midway shipping point because it fixes the choppy-Sara issue *today's feedback* called out.

## Success criteria

- [ ] `backend/voice/base.py` Protocols defined, three providers (browser, gcp_tts, gcp_stt) conform
- [ ] `/api/voice/{config,tts/synthesize,stt/transcribe}` routes pass tests + auth checks
- [ ] Cache hit on re-played tutor message: zero provider cost, <50ms response
- [ ] Spike scripts produce Danish audio samples; AR sign-off on a voice choice for the WaveNet upgrade
- [ ] DictateButton: end-to-end Danish dictation → transcript fills input → tutor responds
- [ ] Per-class teacher toggle in 1.G class-detail page; default OFF
- [ ] OTel spans visible in Cloud Trace; cost dashboard shows per-provider character counts
- [ ] `aiplatform voice list-providers` and `voice spike` work from CLI
- [ ] Runbook documents the swap procedure (browser → gcp_wavenet → future self-hosted Whisper)
- [ ] `make lint` + `make test-fast` + `npm run quality:check` all green

## Out of scope

- Gemini Live / ADK LiveRunner — defer until conversational-tutor design doc exists
- Voice cloning, SSML editor UI, prosody knobs — provider `extras` is the extension point
- Real-time speech-to-speech (STT→LLM→TTS direct roundtrip) — LiveRunner story
- Audio-capture research stream transcription — Part 2 of [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md), JB-gated
- OpenAI Whisper / Azure / self-hosted Whisper providers — Protocol is built; concrete providers ship in follow-up docs as the swap becomes useful (e.g., UCPH GPU cluster onboarding)
- Voice-controlled UI (beyond filling the input box) — not a goal of "lesson ease"
- Multi-speaker diarization for the audio-capture stream — out of scope here; revisit when Part 2 of v1.0 doc is unblocked

## Related documents

- **Parent:** [../v1.0.0-pilot/audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) — Part 1 shipped; this doc supersedes the v2 polish notes
- [cost-dashboard.md](cost-dashboard.md) (1.1.9) — voice spans feed this dashboard
- [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) (1.G) — per-class voice toggle lives here
- [proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md) (1.1.2) — reactive turns inherit read-aloud automatically
- ADR-003 (four-tier model selection) in [architecture.qmd](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/architecture.qmd) — voice mirrors this pattern
- ADR-005 (data residency) — providers in `europe-north1` / EU
- [self-hosting.qmd](file:///Users/mark/Documents/clients/cph-uni/self-hosting.qmd) — UCPH GPU cluster Whisper path is the long-term destination
- [feedback_search_protocols_first](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_search_protocols_first.md) — cited in Standards check
- [feedback_no_emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md) — lucide-react `Mic`/`MicOff`/`Volume2`/`VolumeX` icons throughout
- [local-dev-cli](../../v6.1.0/local-dev-cli.md) — CLI command surface
