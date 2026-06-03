# Sprint: VOICE-PROVIDER — 1.1.11 voice provider abstraction + Cloud TTS/STT + dictation

**Sprint ID:** `VOICE-PROVIDER`
**Design doc:** [voice-provider-abstraction.md](voice-provider-abstraction.md)
**Parent doc:** [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) (v1.0 Part 1 shipped browser-native; this supersedes the v2 polish notes)
**Branch:** work on `dev` directly per [feedback-no-prs-commit-to-dev](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_prs_commit_to_dev.md). Commit per milestone locally; `git push origin dev` at end of each phase after that phase's quality gates pass.
**Estimate:** ~3.5-4d wall clock split into two phases:
- **Phase A (TTS + read-aloud upgrade + auto-read toggle):** ~1.75d — ships independently to dev, fixes today's choppy-Sara feedback immediately, picks up proactive turns (1.1.2) for free
- **Phase B (STT + dictation + teacher toggle):** ~1.5-2d — depends on Phase A's Protocol + registry infrastructure
**Follow-up from:** [proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md) (1.1.2 shipped 2026-06-03). The auto-read toggle is the UX pair to proactive turns — when ON, students get a hands-off auditory loop where the tutor speaks proactive observations on workbench commits without any click.
**Created:** 2026-06-03
**Status:** Planned

## Sprint goal

Land a server-side voice provider abstraction in `backend/voice/` (`TTSProvider` / `STTProvider` `Protocol`s + registry + content-hash cache) with Cloud TTS (Standard for spike → WaveNet for ship) and Cloud STT (`latest_long` for Danish) as the first two providers. Browser-native stays as the no-network default. Extend `ReadAloudButton` to use Cloud TTS when configured (Phase A) and add a new `DictateButton` mic that POSTs to Cloud STT and fills the input field (Phase B). Per-class teacher opt-in gates the STT surface.

**Visible to teachers + students:**
- **End of Phase A:** read-aloud sounds like a real Danish voice, not choppy Sara. Same UI; backend swap.
- **End of Phase B:** mic icon next to the chat input on problem-set-helper + concept-dialogue. Tap, speak, transcript fills input, send normally. Teacher controls the toggle per class.

## Architecture recap

```
Frontend
  ReadAloudButton                                       DictateButton
    │                                                     │
    ▼                                                     ▼
  fetch GET /api/voice/config?skill_id=...              POST multipart /api/voice/stt/transcribe
    → { tts: { provider, voice, capabilities },           with audio blob + lang
        stt: { provider, capabilities } }                 ← { transcript }
    │
    ├─ provider="browser" → use window.speechSynthesis (no network)
    └─ provider="gcp_*"   → POST /api/voice/tts/synthesize → audio blob → play

Backend
  /api/voice/config          → registry.get_tts() + get_stt() (selection chain)
  /api/voice/tts/synthesize  → cache.lookup → provider.synthesize → cache.write → return blob
  /api/voice/stt/transcribe  → provider.transcribe → return transcript (audio never persisted)

Registry selection (mirrors backend/adk/agent.py model picking):
  SkillConfig.voice.tts_provider → VOICE_TTS_PROVIDER env → "browser" default

Providers (in this sprint):
  backend/voice/providers/browser.py   — signal-only ("FE, use Web Speech")
  backend/voice/providers/gcp_tts.py   — google-cloud-texttospeech, voice-tier-config
  backend/voice/providers/gcp_stt.py   — google-cloud-speech, latest_long da-DK
  backend/voice/providers/null.py      — tests / explicit-disable

OTel spans on every synthesize/transcribe:
  voice.provider, voice.chars OR voice.duration_ms, voice.cache_hit, voice.cost_estimate_usd
  → feeds cost-dashboard.md (1.1.9)
```

## Workflow

Per the no-PR memory: work on `dev` directly. Commit per-milestone locally; each commit independently passes lint + relevant tests for fast bisect-ability.

**Push cadence:** push after each phase, not each milestone. Phase A pushes after M-A8; Phase B pushes after M-B7. Lets us ship the visible TTS quality fix to dev as soon as it's green, without waiting for the full STT half.

No worktrees / sub-agents — sequential single-track, like PROACTIVE-SIM-REACTIVE. Phase A and Phase B are sequential because Phase B depends on Phase A's Protocol layer.

## Pre-conditions (M0 — must complete before M-A1)

These are **ops tasks**, not engineering, but they block GCP-touching milestones. Run them first. Per [feedback-record-side-effects](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_record_side_effects.md): every API enable / IAM grant / bucket creation gets logged in `docs/ops/` so it can be Terraformed for test/prod.

- [ ] **M0a — Enable APIs in `aipla-dev-2026`:**
  ```
  gcloud services enable texttospeech.googleapis.com --project=aipla-dev-2026
  gcloud services enable speech.googleapis.com --project=aipla-dev-2026
  ```
  Record both in `docs/ops/gcp-side-effects.md` (or `docs/ops/voice-providers-runbook.md` if greenfield) under the date.
- [ ] **M0b — Provision TTS cache bucket:**
  ```
  gcloud storage buckets create gs://aipla-dev-2026-tts-cache \
    --project=aipla-dev-2026 \
    --location=europe-north1 \
    --uniform-bucket-level-access
  gcloud storage buckets update gs://aipla-dev-2026-tts-cache \
    --lifecycle-file=infrastructure/gcs-lifecycle-90d.json
  ```
  IAM: backend SA gets `roles/storage.objectAdmin` on this bucket only. Record in ops notes.
- [ ] **M0c — Verify backend SA permissions:**
  ```
  gcloud projects add-iam-policy-binding aipla-dev-2026 \
    --member=serviceAccount:aipla-v6-backend@aipla-dev-2026.iam.gserviceaccount.com \
    --role=roles/cloudtts.user
  gcloud projects add-iam-policy-binding aipla-dev-2026 \
    --member=serviceAccount:aipla-v6-backend@aipla-dev-2026.iam.gserviceaccount.com \
    --role=roles/speech.client
  ```
  If those role names are wrong, capture the actual ones in the runbook — first-time enable often discovers role-name drift.
- [ ] **M0d — Schedule AR voice-pick session for M-A4** (15-min listening session — no engineering blocker, but needs to be on AR's calendar). Default to `da-DK-Wavenet-A` if AR unavailable; AR can override later via env var, no code change required.
- [ ] **M0e — Confirm JB/teacher-toggle dependency for Phase B** — Phase B's per-class toggle lives in 1.G teacher-ui. Verify the 1.G class-detail page exists in `dev` and has a settings panel we can extend. If not, drop a placeholder env-var-only toggle for Phase B and file the proper UI as a follow-up.

**Pause point:** if M0a–M0c fail (IAM drift, missing roles, quota issue), pause sprint, fix permissions, document in runbook. **Don't proceed past M0 with broken APIs** — M-A2 onward will fail in mystery ways.

## Phase A — TTS provider + Cloud TTS + read-aloud upgrade (~1.5d)

**Phase A goal:** server-side `TTSProvider` Protocol shipped, Cloud TTS WaveNet plays Danish for the read-aloud button, browser-native fallback always available. End-of-Phase-A push to dev fixes today's choppy-Sara feedback in production.

### M-A1 — Recon: google-cloud-texttospeech API surface (~30 min, BLOCKING)

**Path B fallback gate** mirroring PROACTIVE-SIM-REACTIVE M1. Before writing any provider, confirm what we're building against.

**Recon steps:**

1. Check `backend/pyproject.toml` — is `google-cloud-texttospeech` already a dep? (Likely no — the v6 backend hasn't called TTS APIs before.) If absent: `uv add google-cloud-texttospeech` in M-A2.
2. `mcp__google-dev-knowledge__search_documents` for "TextToSpeechClient synthesize_speech VoiceSelectionParams" — confirm async client class name + SSML support shape + voice-tier selection idiom.
3. Confirm Chirp 3 HD vs WaveNet are distinguishable via the same `VoiceSelectionParams.name` field (e.g. `"da-DK-Wavenet-A"` vs `"da-DK-Chirp3-HD-Aoede"`) — they are, but verify.
4. Verify the response audio container default (LINEAR16 / MP3 / OGG_OPUS) — we want MP3 for browser compatibility.
5. Confirm BCP-47 tag handling — `lang="da"` should resolve to `da-DK` but verify.

**Acceptance:**
- [ ] Recon notes recorded in `## Recon findings` section below
- [ ] If `google-cloud-texttospeech` API has materially changed shape from the most recent ADK reference, capture deltas before M-A2

### M-A2 — `backend/voice/base.py` + `registry.py` + `null.py` + unit tests (~45 min)

**Files (new):**

- `backend/voice/__init__.py` — re-export `TTSProvider`, `STTProvider`, `get_tts`, `get_stt`, `VoiceCapabilities`
- `backend/voice/base.py` — `Protocol` classes (~60 LOC)
- `backend/voice/registry.py` — env / SkillConfig selection (~80 LOC)
- `backend/voice/providers/__init__.py` — empty
- `backend/voice/providers/null.py` — `NullTTSProvider` / `NullSTTProvider` for tests + explicit-disable (~20 LOC)
- `backend/tests/unit/voice/__init__.py` — empty
- `backend/tests/unit/voice/test_registry.py` — selection chain tests (~60 LOC)

**Tests in this milestone:**

- `test_registry_falls_back_to_browser` — no env, no SkillConfig → `get_tts()` returns browser provider
- `test_env_overrides_default` — `VOICE_TTS_PROVIDER=null` → `get_tts()` returns NullTTSProvider
- `test_skill_config_overrides_env` — SkillConfig with `voice.tts_provider="null"` beats env `gcp_wavenet`
- `test_unknown_provider_raises` — `VOICE_TTS_PROVIDER=nonexistent` → clear `ValueError` at registry boot, not at first call

**Gates:**
- `cd backend && make lint && make test-fast`

**Commit:** `feat(voice): TTSProvider/STTProvider Protocols + registry + null provider (M-A2 sprint VOICE-PROVIDER)`

### M-A3 — `gs://aipla-dev-2026-tts-cache` + `backend/voice/cache.py` + tests (~45 min)

**Files (new):**

- `backend/voice/cache.py` — content-hash GCS cache (~80 LOC). Key: `sha256(provider + voice + lang + rate + text)`. Object path: `{hash[:2]}/{hash}.{ext}`. Mime stored in object metadata.
- `backend/tests/unit/voice/test_cache.py` — mocked-GCS hit/miss + key determinism (~60 LOC)

**Tests:**

- `test_cache_key_is_deterministic` — same inputs → same hash
- `test_cache_key_differs_per_voice` — same text, different voice → different hash
- `test_cache_miss_returns_none` — mocked GCS returns NotFound → `lookup()` returns None
- `test_cache_hit_returns_bytes_and_mime` — mocked GCS returns object → returns (bytes, mime)
- `test_cache_write_uploads_with_metadata` — `write()` calls `blob.upload_from_string` with mime in metadata

**Gates:**
- `cd backend && make lint && make test-fast`

**Commit:** `feat(voice): content-hash TTS cache to gs://aipla-dev-2026-tts-cache (M-A3 sprint VOICE-PROVIDER)`

### M-A4 — `providers/gcp_tts.py` + integration test + spike script (~1h, expanded with AR voice pick)

**Files (new):**

- `backend/voice/providers/browser.py` — signal-only (~30 LOC). `describe()` returns `tts=True`, `stt=False`. `synthesize()` raises `NotImplementedError("browser provider must be handled at the route layer")`.
- `backend/voice/providers/gcp_tts.py` — `google-cloud-texttospeech` wrapper (~120 LOC). Config: voice tier (Standard / WaveNet / Neural2 / Chirp3HD) selected by registry key; voice name (`da-DK-Wavenet-A` etc.) passed via `voice` arg or defaulted from SkillConfig.
- `scripts/spike_tts.py` — synthesize one Danish sentence on {Standard-F, Standard-G, WaveNet-A, WaveNet-C, WaveNet-D, Neural2-F, Chirp3-HD-Aoede} → save to `/tmp/tts_spike/{voice}.mp3` (~60 LOC). Includes a `--listen` flag that `open`s each file in sequence on macOS.
- `backend/tests/integration/voice/test_gcp_tts.py` — `@pytest.mark.integration` real-GCP roundtrip (~60 LOC)

**Dependency:**
- `cd backend && uv add google-cloud-texttospeech` (if M-A1 confirmed missing)

**Tests:**

- `test_gcp_tts_danish_wavenet_roundtrip` (integration) — synthesize "Hej, hvad er Plancks konstant?" via `da-DK-Wavenet-A` → assert MP3 bytes returned, ≥1 KB, latency <1s
- `test_gcp_tts_extras_passed_through` (unit, mocked) — `extras={"ssml": True}` → client called with SSML input shape
- `test_gcp_tts_describe_reports_tts_only` — `capabilities.tts=True`, `stt=False`

**Human loop:**
- Run `python scripts/spike_tts.py` → load `/tmp/tts_spike/*.mp3` into the AR voice-pick session. Default to `da-DK-Wavenet-A` if AR not yet available. Record AR's pick in `docs/ops/voice-providers-runbook.md`.

**Gates:**
- `cd backend && make lint && make test-fast` (integration tests skipped in fast suite — manually run `pytest -m integration` to verify Danish roundtrip)

**Commit:** `feat(voice): GCP TTS provider + Danish spike script (M-A4 sprint VOICE-PROVIDER)`

### M-A5 — `backend/protocols/voice_routes.py` (TTS half) + tests + OTel spans (~1h)

**Files (new):**

- `backend/protocols/voice_routes.py` — three FastAPI routes (~150 LOC, but only TTS half + config wired in this milestone; STT route stubbed with 501)
- `backend/tests/api_tests/test_voice_routes.py` — TTS happy/sad paths + cache hit + auth (~100 LOC for the TTS portion)

**Routes wired in M-A5:**

- `GET /api/voice/config?skill_id=...` → returns `{ tts: {...}, stt: {...} }` based on registry
- `POST /api/voice/tts/synthesize` → cache lookup → provider.synthesize → cache write → return `audio/mpeg` blob + `X-Voice-Provider` / `X-Voice-Cache-Hit` / `X-Voice-Cost-Usd` headers
- `POST /api/voice/stt/transcribe` → returns `501 Not Implemented` until M-B3

**OTel spans:**

- `voice.synthesize` with attrs: `voice.provider`, `voice.chars`, `voice.cache_hit`, `voice.lang`, `voice.cost_estimate_usd`
- Cost estimate computed inline from a tier→price table in `backend/voice/cost.py` (new, ~30 LOC). Standard $4/M, WaveNet $4/M, Neural2 $16/M, Chirp3HD $30/M (matches the design doc cost model).

**Tests:**

- `test_config_returns_browser_by_default` — no env, no skill → `tts.provider == "browser"`
- `test_synthesize_browser_path_returns_json` — `provider=browser` → returns `{ "provider": "browser" }` JSON, not audio
- `test_synthesize_gcp_path_returns_audio_blob` — mocked GCP TTS → 200 audio/mpeg + correct X-Voice-Provider header
- `test_synthesize_cache_hit_skips_provider_call` — second call → mocked provider called exactly once
- `test_synthesize_requires_jwt` — no auth → 401
- `test_synthesize_rate_limited` — 60+ requests/min per group_id → 429

**Gates:**
- `cd backend && make lint && make test-fast`

**Commit:** `feat(voice): /api/voice/{config,tts/synthesize} routes + OTel cost spans (M-A5 sprint VOICE-PROVIDER)`

### M-A6 — `SkillVoiceConfig` Pydantic + `SkillConfig` integration + tests (~30 min)

**Files (modify):**

- `backend/db/models/__init__.py` (or wherever `SkillConfig` lives) — add `voice: SkillVoiceConfig | None = None` field
- `backend/db/skill_voice_config.py` (new) — `SkillVoiceConfig` Pydantic class (~20 LOC)
- `backend/skills/skill_processor.py` — parse the new field from frontmatter (same shape as PROACTIVE-SIM-REACTIVE M2's three-fields pattern)
- `backend/admin/platform_seed.py` — handle the new field in seed-pipeline output

**Tests:**

- `test_skill_voice_config_parses_from_frontmatter` — frontmatter fixture with `voice: { tts_provider: "gcp_wavenet", tts_voice: "da-DK-Wavenet-A" }` → resolved correctly
- `test_skill_voice_config_defaults_when_absent` — no `voice` frontmatter → field is `None`, registry falls back to env
- `test_registry_picks_skill_voice` — `SkillConfig` with voice → `get_tts(skill)` returns that provider

**Gates:**
- `cd backend && make lint && make test-fast`

**Commit:** `feat(skills): SkillVoiceConfig fields + frontmatter parsing (M-A6 sprint VOICE-PROVIDER)`

### M-A7 — `useVoiceConfig` hook + `ReadAloudButton` Cloud TTS path + `MessageBubble` wiring + vitest (~1h)

**Files (new):**

- `frontend/src/hooks/useVoiceConfig.ts` — client cache of `GET /api/voice/config` per skill_id (~50 LOC). Uses SWR or simple `useState` + `useEffect` (match existing pattern in `frontend/src/hooks/`).
- `frontend/src/components/chat/__tests__/ReadAloudButton.test.tsx` — extend existing tests for provider="gcp" path (or create if absent) (~40 LOC additions)

**Files (modify):**

- `frontend/src/components/chat/ReadAloudButton.tsx` — add `provider` and `voice` props (default `"browser"`). When `provider="gcp_*"`: `fetch('/api/proxy/api/voice/tts/synthesize', { method: 'POST', body: { text, lang, voice } })` → blob → `new Audio(URL.createObjectURL(blob))`. Click-again cancels Audio + revokes URL.
- `frontend/src/components/chat/MessageBubble.tsx` — pull `voiceConfig` via `useVoiceConfig(skillId)`, pass `provider={voiceConfig.tts.provider}` and `voice={voiceConfig.tts.voice}` to `ReadAloudButton`.

**Tests (vitest):**

- `provider=browser` path unchanged — existing tests still pass
- `provider=gcp_wavenet` path: mock `fetch`, return audio blob, assert `new Audio` called with object URL, assert click-again cancels
- Network failure on `synthesize` → falls back to browser path silently (no broken UI)
- `useVoiceConfig` caches per skillId, refetches on skillId change

**Gates:**
- `cd frontend && npm run quality:check` (the FULL variant per [feedback-pre-push-ci-parity](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_pre_push_ci_parity.md), not `quality:check:fast`)

**Commit:** `feat(frontend): ReadAloudButton Cloud TTS path + useVoiceConfig hook (M-A7 sprint VOICE-PROVIDER)`

### M-A7b — Auto-read toggle: `useAutoReadAloud` + `AutoReadToggle` + barge-in (~45 min)

**Picks up proactive-sim-reactive (1.1.2):** when this lands, the student-side auto-read pref auto-speaks proactive turns the same way it auto-speaks user-driven tutor responses. No special-casing — proactive turns are AG-UI assistant messages by design.

**Files (new):**

- `frontend/src/hooks/useAutoReadAloud.ts` — `localStorage` toggle persistence + AG-UI `RUN_FINISHED` listener for the last assistant turn + imperative call to `ReadAloudButton`'s speak handler (~80 LOC)
- `frontend/src/components/chat/AutoReadToggle.tsx` — Switch component in `AppFooter` next to the existing accessibility note (~50 LOC)
- `frontend/src/hooks/__tests__/useAutoReadAloud.test.ts` — vitest (~80 LOC)

**Files (modify):**

- `frontend/src/components/AppFooter.tsx` — mount `AutoReadToggle` (+~15 LOC)
- `frontend/src/components/chat/MessageBubble.tsx` — expose an imperative speak handle via `forwardRef` so `useAutoReadAloud` can fire it on `RUN_FINISHED` (+~10 LOC)
- `frontend/src/components/chat/ChatInput.tsx` — emit a `voice.cancel` event when user starts typing (barge-in trigger) (+~10 LOC)

**Designed barge-in / queueing semantics** (Axiom 11 — designed before implementation):

| Event during TTS playback | Behaviour |
|---|---|
| Student starts typing | Cancel current TTS immediately |
| Student starts dictating (Phase B) | Cancel current TTS immediately |
| New tutor message arrives | Queue (don't overlap); speak when current finishes |
| User clicks read-aloud button | Cancel auto-read of *that* turn (user took over manually) |
| Page navigation | Existing `useEffect` cleanup cancels (already in place) |
| Toggle flipped to OFF mid-utterance | Cancel current TTS |

**Tests:**

- `toggle_persists_to_localStorage` — toggle on, reload window, toggle stays on
- `auto_reads_on_run_finished` — fake `RUN_FINISHED` event + toggle on → mocked speak() called once
- `does_not_auto_read_when_off` — `RUN_FINISHED` + toggle off → mocked speak() not called
- `typing_cancels_in_flight_tts` — emit `voice.cancel` while speaking → speak handler cancel called
- `concurrent_turns_queue` — two `RUN_FINISHED` events in 100ms → second speaks after first finishes
- `proactive_turn_auto_reads` — assistant message with `tutor.proactive_kind="event_reactive"` attr → speak() called same as user-driven turn

**Gates:**
- `cd frontend && npm run quality:check`

**Commit:** `feat(frontend): auto-read toggle + barge-in semantics + proactive-turn pickup (M-A7b sprint VOICE-PROVIDER)`

### M-A8 — Phase A acceptance + push (~30 min)

**Manual acceptance:**

- [ ] Start `make dev`, open LOCAL_MODE chat with `concept-dialogue-config` (Danish)
- [ ] Click read-aloud on an assistant message → Cloud TTS audio plays (not browser Sara)
- [ ] Click again → audio stops mid-utterance
- [ ] Reload page, click read-aloud on same message → cache hit (Cloud Trace span shows `voice.cache_hit=true`)
- [ ] Click read-aloud in `kinebot-kinematics-tutor` (English) → English voice plays correctly
- [ ] BigQuery `voice_synthesize` span surfaces with all attrs
- [ ] **Auto-read toggle flow**: toggle on in AppFooter → send a message → assistant response auto-speaks on stream-complete
- [ ] **Barge-in**: while auto-read is speaking, start typing in input → TTS cancels immediately
- [ ] **Proactive interaction (1.1.2)**: with auto-read on, run a Boldkast sim → proactive tutor turn auto-speaks without click
- [ ] **Toggle persistence**: reload page → toggle state survives

**Gates:**
- `cd backend && make lint && make test-fast`
- `cd frontend && npm run quality:check`
- `pytest -m integration backend/tests/integration/voice/` (manual; real-GCP roundtrip)

**Commit:** `chore(sprint): Phase A complete — push to dev (M-A8 sprint VOICE-PROVIDER)` (if Phase A landed cleanly; otherwise just push without a marker commit)

**Push:** `git push origin dev`

**Pause point:** Phase A ships independently here. Phase B starts only after Phase A is verified in dev. If feedback comes in on the Cloud TTS voice quality between phases, capture it; iterate on the WaveNet voice choice via env var if needed (no redeploy required for voice swap).

## Phase B — STT provider + dictation button + teacher toggle (~1.5-2d)

**Phase B goal:** server-side `STTProvider` Protocol shipped, Cloud STT `latest_long` transcribes Danish dictation, new `DictateButton` records audio and fills the chat input, per-class teacher toggle gates the surface.

### M-B1 — Recon: google-cloud-speech client + Danish `latest_long` shape (~30 min, BLOCKING)

Mirror M-A1 for the STT side.

**Recon steps:**

1. Confirm `google-cloud-speech` package presence in `pyproject.toml`. If absent: `uv add google-cloud-speech`.
2. `mcp__google-dev-knowledge__search_documents` for "SpeechClient recognize RecognitionConfig latest_long" — confirm async client + config-shape + audio encoding option (`WEBM_OPUS` for our MediaRecorder webm/opus output, no transcoding needed).
3. Confirm `da-DK` is a `language_code` value accepted by `latest_long` (Cloud STT V2 doc says yes; verify against current client).
4. Check whether audio needs to be base64-encoded vs raw bytes vs GCS URI for short utterances (≤30s).

**Acceptance:**
- [ ] Recon notes recorded in `## Recon findings` below
- [ ] Audio format path confirmed: MediaRecorder webm/opus → bytes → `recognize()` with `WEBM_OPUS` encoding, no transcoding

### M-B2 — `providers/gcp_stt.py` + integration test (~45 min)

**Files (new):**

- `backend/voice/providers/gcp_stt.py` — `google-cloud-speech` wrapper (~100 LOC). `latest_long` model, `da-DK` default, `WEBM_OPUS` encoding.
- `backend/tests/integration/voice/test_gcp_stt.py` — `@pytest.mark.integration` real-GCP roundtrip (~60 LOC)

**Tests:**

- `test_gcp_stt_danish_roundtrip` (integration) — feed the WaveNet-A MP3 output of M-A4 (converted to webm/opus via ffmpeg if needed) → assert transcript contains "Planck"
- `test_gcp_stt_audio_never_persisted` (unit, mocked) — assert no `blob.upload` calls anywhere in `gcp_stt.py`
- `test_gcp_stt_describe_reports_stt_only` — `capabilities.stt=True`, `tts=False`

**Gates:**
- `cd backend && make lint && make test-fast`

**Commit:** `feat(voice): GCP STT provider + Danish latest_long integration test (M-B2 sprint VOICE-PROVIDER)`

### M-B3 — `scripts/spike_stt.py` + voice_routes STT wire-in (~45 min)

**Files (new):**

- `scripts/spike_stt.py` — round-trip the M-A4 WaveNet output back into STT; assert transcript matches input (~60 LOC). Useful diagnostic for Danish accuracy regressions.

**Files (modify):**

- `backend/protocols/voice_routes.py` — replace the 501 stub on `POST /api/voice/stt/transcribe` with the real implementation. Multipart parser → bytes → provider.transcribe → JSON response. Add OTel span `voice.transcribe` with attrs `voice.provider`, `voice.duration_ms`, `voice.cost_estimate_usd`, `voice.lang`.
- `backend/tests/api_tests/test_voice_routes.py` — add STT-half tests (~50 LOC additions)

**Tests:**

- `test_transcribe_happy_path` — multipart with audio + lang → 200 + `{ transcript, provider, duration_ms }`
- `test_transcribe_requires_jwt` — 401 without
- `test_transcribe_rejects_oversize` — >5 MB blob → 413
- `test_transcribe_rejects_long_audio` — >30s audio → 400
- `test_transcribe_503_when_provider_down` — provider raises → 503 (FE falls back to typing)
- `test_transcribe_does_not_persist_audio` — assert GCS not called

**Gates:**
- `cd backend && make lint && make test-fast`

**Commit:** `feat(voice): /api/voice/stt/transcribe + STT spike script (M-B3 sprint VOICE-PROVIDER)`

### M-B4 — `DictateButton.tsx` + vitest (~1h, RISKIEST FE WORK)

Per design doc Velocity caveats: **don't compress this milestone.** MediaRecorder + audio MIME negotiation has cross-browser surprises. Allocate the full hour.

**Files (new):**

- `frontend/src/components/chat/DictateButton.tsx` — mic button, MediaRecorder state machine, POST to transcribe, fill input (~150 LOC). Designed states from the design doc:
  - **idle:** lucide `Mic` icon, tooltip "Tal i stedet for at skrive" (DA) / "Speak instead of typing" (EN)
  - **recording:** lucide `MicOff` icon, pulsing red dot, timer badge counting up `0:05`
  - **transcribing:** spinner inside the button while POST is in flight
  - **error:** mic-permission-denied toast (Danish copy from design doc), button disabled. Network failure toast. Input keeps focus.
- `frontend/src/components/chat/__tests__/DictateButton.test.tsx` — vitest (~80 LOC). Mock MediaRecorder via `vi.stubGlobal`.

**Files (modify):**

- `frontend/src/components/chat/ChatInput.tsx` — mount `DictateButton` inline next to the send button. Visible only if `voiceConfig.stt.capabilities.stt === true` AND `NEXT_PUBLIC_VOICE_STT === "on"` AND (per-class teacher toggle is on — wired in M-B5).

**Tests:**

- `permission_granted_starts_recording` — `getUserMedia` resolves → MediaRecorder starts, MicOff icon visible
- `second_click_stops_and_transcribes` — click again → recorder.stop → fetch POST → transcript fills input
- `permission_denied_shows_toast` — `getUserMedia` rejects with `NotAllowedError` → toast + button disabled
- `30s_timeout_auto_stops` — fake timer 30s → recorder.stop called automatically
- `network_failure_resets_state` — fetch rejects → toast, button returns to idle, no UI lockup
- `not_rendered_when_stt_disabled` — `voiceConfig.stt.provider === "disabled"` → button absent from DOM

**Gates:**
- `cd frontend && npm run quality:check`

**Commit:** `feat(frontend): DictateButton mic input + MediaRecorder + STT POST (M-B4 sprint VOICE-PROVIDER)`

### M-B5 — Per-class teacher toggle (1.G integration) (~45 min)

**Files (modify):**

- `frontend/src/app/teacher/[classId]/page.tsx` — add a Voice section under the existing settings panel. Two toggles: "Tale-til-tekst aktiveret" (STT) + "Tekst-til-tale stemme" (TTS provider picker: Browser / Cloud Standard / Cloud WaveNet / Cloud Chirp3HD — read from `/api/voice/config`'s capabilities list).
- `backend/db/class_settings.py` (or wherever class settings live) — add `voice_stt_enabled: bool = False` and `voice_tts_provider: str | None = None` fields
- `backend/protocols/voice_routes.py` — `GET /api/voice/config` consults class settings for the requesting student's class, overrides registry defaults
- `frontend/src/components/chat/ChatInput.tsx` — gate DictateButton render on the per-class flag (already wired to `useVoiceConfig` in M-B4)

**Tests:**

- Backend: `test_config_respects_class_stt_disabled` — class with `voice_stt_enabled=false` → student's `/api/voice/config` returns `stt.provider="disabled"`
- Frontend: vitest on teacher-settings page — toggle persists, displays correctly
- Manual: log in as test-teacher@example.dk, toggle STT on for `aipla-demo-1`, verify student view shows mic; toggle off, verify mic disappears

**Gates:**
- `cd backend && make lint && make test-fast`
- `cd frontend && npm run quality:check`

**Commit:** `feat(teacher-ui): per-class voice provider + dictation toggle (M-B5 sprint VOICE-PROVIDER)`

### M-B6 — `cli/aiplatform/commands/voice.py` + tests (~45 min)

**Files (new):**

- `cli/aiplatform/commands/voice.py` — `list-providers`, `spike`, `transcribe` subcommands (~80 LOC)
- `cli/tests/test_cli_voice.py` — typer testing (~60 LOC)

**Commands:**

- `aiplatform voice list-providers` — fetches `GET /api/voice/config` (no skill_id), prints registered providers + capabilities
- `aiplatform voice spike <text> --lang da [--provider gcp_wavenet] [--voice da-DK-Wavenet-A] [--out /tmp/x.mp3]` — one-shot TTS to file
- `aiplatform voice transcribe <file.webm> --lang da [--provider gcp_latest_long]` — one-shot STT from file

**Tests:**

- `test_list_providers_calls_config_endpoint` — mocked httpx → asserts GET /api/voice/config + correct output format
- `test_spike_writes_audio_file` — mocked synthesize → asserts file written + correct mime
- `test_transcribe_reads_file_and_posts` — mocked transcribe → asserts multipart POST + prints transcript

**Gates:**
- `cd cli && uv run pytest tests/test_cli_voice.py`

**Commit:** `feat(cli): aiplatform voice subcommands (M-B6 sprint VOICE-PROVIDER)`

### M-B7 — `docs/ops/voice-providers-runbook.md` + cost-dashboard wiring + Phase B push (~45 min)

**Files (new):**

- `docs/ops/voice-providers-runbook.md` — provider config matrix (env vars per provider), swap procedure (cloud → server-local → self-hosted Whisper on UCPH GPU), cost monitoring queries for BigQuery, troubleshooting (API down, quota hit, IAM drift) (~150 LOC)
- `docs/ops/gcp-side-effects.md` (update or create) — record all M0a–M0c grants for Terraform export to test/prod

**Files (modify):**

- `docs/design/aipla/v1.1.0-feedback/cost-dashboard.md` (1.1.9) — add a one-line forward reference noting that `voice.synthesize` + `voice.transcribe` spans contribute to the cost dashboard. (Actual dashboard wiring — surfacing voice rows — is part of 1.1.9's own implementation; this milestone just ensures the spans exist with the right attrs, which M-A5 + M-B3 already did.)

**Manual acceptance for full sprint:**

- [ ] LOCAL_MODE: speak "Hvad er Plancks konstant?" into mic → transcript fills input → tutor responds → click Volume2 → WaveNet plays Danish
- [ ] Per-class teacher toggle: enable for one class, verify dictation visible; disable, verify hidden
- [ ] Cloud Trace shows `voice.synthesize` + `voice.transcribe` spans with all attrs
- [ ] BigQuery query: `SELECT voice_provider, SUM(voice_cost_estimate_usd) FROM voice_spans WHERE date = today GROUP BY voice_provider` returns rows
- [ ] AR/JB voice-quality review session (M0d carried over): play 3 tutor turns + 3 dictated phrases, capture feedback
- [ ] `make lint` + `make test-fast` + `npm run quality:check` all green

**Gates:**
- `cd backend && make lint && make test-fast`
- `cd frontend && npm run quality:check`
- AR/JB sign-off on voice quality (M0d / M-B7 human loop)

**Commit:** `docs(voice): ops runbook + cost-dashboard backref (M-B7 sprint VOICE-PROVIDER)` + sprint-finalize commit `chore(sprint): finalize VOICE-PROVIDER — Phase B complete`

**Push:** `git push origin dev`

## What ships independently — Phase A vs Phase B

| Phase | Visible change | Independent? | Why |
|---|---|---|---|
| **Phase A** (M-A1 → M-A8 incl. A7b) | Read-aloud sounds like a real Danish WaveNet voice (not choppy Sara) + auto-read toggle for hands-off auditory loop incl. proactive turns | **Yes — push after M-A8** | Browser-native path is the existing fallback; new Cloud TTS is purely additive. Auto-read works with browser provider too (no cost). No breaking change. Today's feedback addressed. |
| **Phase B** (M-B1 → M-B7) | New mic button on chat input → speech-to-text | No — depends on Phase A | Uses the Protocol + registry + cache + cost-meter infrastructure that Phase A lands. Phase B alone makes no sense. |

If wall-clock pressure forces a partial ship, **Phase A alone is a fine outcome** — it directly addresses today's voice-quality feedback. Phase B can land in a follow-up sprint without rework.

## Acceptance checklist (full sprint)

Mirroring the design doc's Success Criteria. Each line is a hard gate before sprint close.

**Phase A (TTS + auto-read):**

- [ ] `backend/voice/base.py` Protocols + `null.py` + `browser.py` + `gcp_tts.py` conform; all tests green
- [ ] `gs://aipla-dev-2026-tts-cache` provisioned; lifecycle 90d; IAM scoped to backend SA only
- [ ] `GET /api/voice/config` + `POST /api/voice/tts/synthesize` pass tests including auth + cache + rate-limit
- [ ] Cache hit on re-played tutor message: zero provider cost, <50ms response
- [ ] `scripts/spike_tts.py` produces Danish audio samples; AR sign-off on voice choice (or default = `da-DK-Wavenet-A`)
- [ ] `ReadAloudButton` Cloud TTS path: real Danish voice plays end-to-end in LOCAL_MODE
- [ ] `AutoReadToggle` in AppFooter; `useAutoReadAloud` auto-speaks on `RUN_FINISHED`; barge-in cancels TTS on typing/dictate; concurrent turns queue
- [ ] Auto-read picks up proactive turns from 1.1.2 with no special-casing
- [ ] OTel span `voice.synthesize` visible in Cloud Trace with all attrs (incl. `voice.auto_read`)
- [ ] Phase A pushed to `dev` and live

**Phase B (STT + dictation):**

- [ ] `gcp_stt.py` conforms; integration test passes with Danish round-trip
- [ ] `POST /api/voice/stt/transcribe` passes tests; audio NEVER persisted (verified via code inspection + test)
- [ ] `DictateButton` end-to-end: speech → transcript → input → tutor responds
- [ ] DictateButton designed states (idle/recording/transcribing/error) all rendered correctly per design doc Axiom 11
- [ ] Per-class teacher toggle in 1.G class-detail page; default OFF
- [ ] `aiplatform voice list-providers` + `voice spike` + `voice transcribe` work from CLI
- [ ] Runbook documents the swap procedure (browser → gcp_wavenet → future self-hosted Whisper)
- [ ] OTel `voice.transcribe` spans visible; BigQuery cost query returns rows
- [ ] AR/JB sign-off on voice quality (M-B7 human loop)
- [ ] `make lint` + `make test-fast` + `npm run quality:check` all green
- [ ] Phase B pushed to `dev`

**Side-effects ledger (per [feedback-record-side-effects](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_record_side_effects.md)):**

- [ ] `texttospeech.googleapis.com` enable recorded in `docs/ops/gcp-side-effects.md`
- [ ] `speech.googleapis.com` enable recorded
- [ ] `gs://aipla-dev-2026-tts-cache` bucket creation + lifecycle recorded
- [ ] All IAM grants (TTS user + Speech client + Storage objectAdmin scoped) recorded
- [ ] AR voice pick captured in runbook with date

## Pause / resume points

This sprint is designed to be picked up across sessions. Natural pause points:

1. **After M0** — pre-conditions ready; pick up at M-A1 in next session
2. **After M-A4** — Cloud TTS works; AR voice-pick session may pause here while AR is unavailable. Default voice can ship without AR if needed.
3. **After M-A8** — Phase A pushed; Phase B can be a separate session entirely. Phase A is independently useful.
4. **After M-B4** — DictateButton works end-to-end in dev (no teacher toggle yet); pause here if teacher-UI integration is blocked on 1.G state
5. **After M-B6** — full sprint complete; M-B7 (docs + AR/JB review) can be the next session

JSON state file (`.claude/state/sprints/sprint_VOICE-PROVIDER.json`) tracks which milestone is current. Sprint-executor reads it.

## Recon findings

(populated by M-A1 and M-B1 before committing to the rest of the plan)

### M-A1 recon (TTS) — completed 2026-06-03

- **Package presence in `pyproject.toml`:** `google-cloud-texttospeech` NOT a dep yet (need `uv add` in M-A4). `google-cloud-storage>=2.18.0` already present, so cache module can use it without an add.
- **Import path:** `from google.cloud import texttospeech` (matches all official samples).
- **Client classes:** `texttospeech.TextToSpeechClient` (sync) + `TextToSpeechAsyncClient` (async). Backend is async (FastAPI), use the async client.
- **Voice name format for tier-distinction:** Use `VoiceSelectionParams(language_code="da-DK", name="da-DK-Wavenet-A")`. Confirmed via official sample using `name="en-US-Chirp3-HD-Charon"` — same shape works for Chirp3HD, Standard, WaveNet, Neural2. Tier is encoded in the voice `name`, not a separate field.
- **Audio encoding:** `AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)` — MP3 is officially supported, ready for `<audio>` element playback in browser. (OGG_OPUS and LINEAR16 also available but MP3 is the simplest cross-browser default.)
- **Response shape:** `response.audio_content` is raw bytes; can write directly to GCS or stream to client.
- **`lang="da"` → resolved BCP-47:** docs use the full `da-DK` form. Protocol stays narrow (`lang="da"`), GCP provider normalizes internally: `"da"` → `"da-DK"`, `"en"` → `"en-US"` (defaults). Skill-config can override with explicit `da-DK` if needed.
- **Auth:** ADC (Application Default Credentials). Locally: `gcloud auth application-default login` as M's user with project access. In Cloud Run: backend SA creds picked up automatically. No code-side credentials needed.
- **Decision:** proceed with M-A2 (Protocols + registry + null). `uv add google-cloud-texttospeech` deferred to M-A4 when the GCP provider lands.

### M-B1 recon (STT)

- Package presence in `pyproject.toml`: …
- `SpeechClient` recognize() signature: …
- `latest_long` Danish acceptance: …
- `WEBM_OPUS` encoding direct from MediaRecorder: …

## Velocity reference + caveats

| Recent sprint | Milestones | Wall-clock | Per-milestone avg | Lessons |
|---|---|---|---|---|
| PROACTIVE-SIM-REACTIVE | 10 | 1d | ~45 min | Sequential single-track, BE-heavy. Same-day push. |
| QUICK-WINS-V11 (Track A) | 4 | 0.5d | ~30 min | Skill-content + tests. Parallel-track Track B. |
| QUICK-WINS-V11 (Track B) | 3 | 0.4d | ~40 min | Backend rename + archival + tests. Mid-sprint rescope absorbed. |
| **VOICE-PROVIDER target** | **17** (M0 + M-A1..A8 incl. A7b + M-B1..B7) | **~3.5-4d** | **~50 min** | Two-phase, push between phases. New external dep (`google-cloud-texttospeech`, `google-cloud-speech`). MediaRecorder browser quirks in M-B4. Auto-read barge-in semantics designed up-front to avoid the "AI talks over me" footgun. |

**Caveats specific to this sprint:**

- **M-A4 and M-B2 need the GCP APIs enabled first** (M0a) — first-time enable + IAM cascade can eat 30 min discovering missing roles. M0 has slack built in.
- **M-B4 is the riskiest frontend item** — MediaRecorder + audio MIME negotiation has cross-browser surprises. Allocate the full hour; don't compress.
- **M-B7 needs AR/JB scheduling** — sprint pauses if they're unavailable; don't merge without voice-quality sign-off.
- **First-time `uv add` of `google-cloud-texttospeech`** can pull a heavy transitive (`grpcio`, `protobuf`); CI build time will tick up ~30s. Acceptable.

## Related

- [voice-provider-abstraction.md](voice-provider-abstraction.md) — design doc this sprint implements
- [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) — parent doc (v1.0 TTS Part 1 shipped browser-native; this supersedes the v2 polish notes)
- [cost-dashboard.md](cost-dashboard.md) — 1.1.9, voice spans feed this
- [teacher-ui.md](../v1.0.0-pilot/teacher-ui.md) — 1.G, per-class voice toggle lives here
- [proactive-sim-reactive-tutor-sprint.md](implemented/proactive-sim-reactive-tutor-sprint.md) — sprint format reference
- [quick-wins-v1.1-sprint.md](implemented/quick-wins-v1.1-sprint.md) — two-track sprint reference (we are single-track but two-phase)
