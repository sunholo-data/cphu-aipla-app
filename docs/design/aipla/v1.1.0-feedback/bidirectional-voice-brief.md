# Bidirectional voice — sound in **and** out as a swap-shaped `voice_mode` config (target 2026-06-23)

**Status:** Brief — **DECISION 2026-06-11 (M, post-meeting): `gemini_live` is DEFERRED** until there's a clear non-Google / open-source (local Whisper, ADR-003 `server_local`) port path — the cloud-locked duplex is the harder, lock-in-prone bet. **`stt_tts_roundtrip` is the v1 mode and voice-in is a requirement.** That removes the heavy continuous-audio GDPR review from the critical path; the round-trip's posture is the small transcript-only dictation delta. The remaining gate is M's confirmation of that delta — not a build decision.
**Last Updated:** 2026-06-15 (added an explicit **latency budget** acceptance criterion — see *Latency budget*; 15 June raised audio latency as a concrete concern)
**Priority:** **P1 — the one urgent new date.** Sound-in-and-out was stressed by teachers on 9 June. It was explicitly "not in this brief" on 3 June; it now carries a **hard near-term target of 2026-06-23**, ahead of the week-27 holiday freeze (2026-06-29 → 07-05).
**Estimated:** the **`voice_mode` abstraction** itself is small (~0.5d — it extends the 1.1.11 registry with a mode axis). Then **per mode**: `stt_tts_roundtrip` ~0.5–1.5d (composes shipped 1.1.11 parts), `gemini_live` ~3–5d (LiveRunner integration off the existing stub). Enable whichever mode(s) fit the date + the GDPR sign-off.
**Scope:** A **`voice_mode` config axis** (per-class/per-activity, swap-shaped per ADR-003 — the same pattern as the shipped `TTSProvider`/`STTProvider` selection) with **pluggable mode implementations**, + the frontend voice-loop UX. Each mode is a **config option**, not a separate app.
**Dependencies:** [voice-provider-abstraction.md](implemented/voice-provider-abstraction.md) (1.1.11 — **shipped**; the `backend/voice/` provider abstraction + routes + cost spans this extends with a mode axis); [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) (the audio-in privacy review — applies in full to the `gemini_live` mode, in delta to `stt_tts_roundtrip`); ADR-003 (four-tier swap-shaped selection — voice mirrors it); ADR-005/007 (EU data residency)
**Source brief:** [`june-09-feedback-sprint-brief.md` §C](../_scoping-snapshot/prototypes/june-09-feedback-sprint-brief.md)

> **This is a config axis, not an app.** Bidirectional voice is **not** "build a voice app" and **not** "pick one architecture." It is a new **`voice_mode`** dimension on the already-shipped, swap-shaped voice stack (1.1.11) — exactly the way ADR-003 makes the *model* swappable across four tiers. **Gemini Live is one mode option; STT+TTS round-trip is another mode option; server-local/on-device are future mode options.** They coexist and are selected by config per class/activity. The job of this brief is to scope that axis and decide, per mode, the **GDPR posture (M)** and **which mode is enabled first for 23 June (JB)**.

## What teachers asked for

Sound **in** and **out** — the student speaks to the tutor and hears it speak back, as a loop, not just the two separate one-shot controls (dictation + read-aloud) that 1.1.11 already shipped. The pull is accessibility and "lesson ease": a student on a shared tablet, no laptop, who would rather talk than type.

1.1.11 shipped the swap-shaped provider layer (`STTProvider`, `TTSProvider`, registry selection by env/`SkillConfig`, EU routing, cost spans) but scoped *out* the conversational loop — its non-goals note *"Gemini Live / ADK LiveRunner stays a stub… speech-to-speech direct… is the LiveRunner story."* This brief adds the **mode axis above the providers** so that "the LiveRunner story" becomes simply **one more mode option** alongside the chained round-trip — both pluggable, neither a fork.

## Architecture — `voice_mode` is a config axis with pluggable modes

```
SkillConfig / class config:
   voice_mode: "gemini_live" | "stt_tts_roundtrip" | "server_local" | "on_device" | "off"
                     │                  │
   registry selects ─┤                  └─ (default-on, cheapest, most private)
                     │
   ┌─────────────────┴───────────────────────────────────────────────┐
   ▼                                                                   ▼
 gemini_live  (duplex streaming)                       stt_tts_roundtrip  (turn-based)
   Gemini Live / ADK LiveRunner                          push-to-talk
   (backend/adk/live_agent.py — the stub)                  → STTProvider.transcribe   (1.1.11, shipped)
   interruptible, low-latency, conversational              → tutor AG-UI turn          (shipped)
   continuous audio stream in/out                          → TTSProvider.synthesize    (1.1.11, shipped)
                                                            → auto-read playback        (1.1.11, shipped)
```

The two **mode options** (others follow the ADR-003 tiers):

| Mode | What it is | Reuses / new | GDPR surface | Effort |
|---|---|---|---|---|
| **`stt_tts_roundtrip`** | Turn-based: speak → STT → tutor turn → TTS → hear. | Composes **shipped** 1.1.11 providers + auto-read; only push-to-talk glue is new | **Small** — utterance → EU STT → *transcript* persisted, raw audio not retained (the 1.1.11 dictation posture) | ~0.5–1.5d |
| **`gemini_live`** | Duplex streaming via Gemini Live / ADK LiveRunner; interruptible, conversational. | Builds on the `live_agent.py` stub; a streaming session/runner alongside the providers | **Larger** — continuous audio in/out; the full [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) five-question review applies | ~3–5d |
| `server_local` / `on_device` | Future tiers (Whisper on UCPH GPU; on-device STT/TTS) per ADR-003. | The mode axis makes these drop-in later | per tier | future |

**This is the swap-shaped pattern, applied to voice.** The same way the model tier is config (ADR-003), the voice mode is config. Adding `gemini_live` does not replace `stt_tts_roundtrip`; both register as modes and a teacher (or default) selects per class/activity. A class on a locked-down network can run `stt_tts_roundtrip`; a class wanting the conversational experience runs `gemini_live`; a future UCPH on-prem deployment runs `server_local` — **no code fork, only config.**

> **Portability caveat — `gemini_live` is the hardest mode to port (keep aware).** Unlike the round-trip mode (whose STT/TTS providers already follow the four-tier swap to server-local Whisper / on-device per ADR-003), `gemini_live` is **cloud-coupled to Google's Live API** — there is no drop-in local equivalent. So when the Year-2 UCPH self-hosting migration comes, `stt_tts_roundtrip` and `server_local` are the portable modes that carry over; `gemini_live` would need a different duplex backend (or stays cloud-only for classes that allow it). The mode axis contains this cleanly — `gemini_live` is *one* option, not the architecture — but it is the one option that does **not** ride the local-migration path, and that is a deliberate, noted trade for the richer conversational experience now.

## The decisions to make (per mode, not "which architecture")

1. **Which mode is enabled first for 23 June (JB).** `stt_tts_roundtrip` is the lowest-effort first mode (composes shipped parts) and is the safe way to have *something* live on the date. `gemini_live` is the richer conversational experience and the one teachers will remember — if LiveRunner integration lands in the window, enable it as the headline mode; otherwise it follows as a config flip with no rework (that is the point of the axis). **Decide which mode demos on 23 June**, knowing the abstraction ships either way.
2. **GDPR posture per mode (M).** `stt_tts_roundtrip`: confirm the dictation posture (transcript-only, raw audio not retained) extends to the loop — small delta on the 1.1.11 sign-off. `gemini_live`: the full audio-capture five-question review (continuous audio egress to the model) — bigger, and it gates *that mode*, not the axis.

There is no "who owns the build" decision — the `voice_mode` axis is platform config the app agent ships; each mode is an implementation behind it, scoped and enabled independently.

## Latency budget (15 June — acceptance criterion)

15 June raised **audio latency** as a concrete concern [M, 15 June]. Round-trip voice feels broken
long before it is broken — a tutor that takes four seconds to start speaking reads as "stuck". So
latency is promoted from a soft quality to an **explicit acceptance criterion**, and the
STT+TTS-vs-`gemini_live` choice is now **partly a latency decision**, not only a portability/GDPR one.

**Metric:** end-to-end round-trip = *utterance-end (student stops speaking) → first audio of the
tutor's reply*. Measured p50/p95, not mean (the tail is what teachers notice). Decomposed into the
three legs already spanned by the 1.1.11 `voice.*` instrumentation:

```
utterance-end ─► STT transcribe ─► tutor TTFT (first AG-UI token) ─► TTS first-audio ─► playback
                 voice.stt.ms        (existing turn span)            voice.tts.ms
```

**Targets (per mode):**

| Mode | p50 round-trip | p95 round-trip | Notes |
|---|---|---|---|
| `stt_tts_roundtrip` (shipped) | **≤ 2.0s** | **≤ 4.0s** | Turn-based; the legs are sequential. STT ~0.3–0.8s + tutor TTFT (the platform's <1s-no-tools bar) + TTS first-audio (1.1.11 Axiom-1 target ≤500ms p95). Streaming the tutor turn + early TTS chunking is the main lever. |
| `gemini_live` (deferred) | **≤ 0.8s** | **≤ 1.5s** | Duplex/interruptible — the latency win is the whole reason to keep it on the roadmap despite the cloud-lock portability cost. Barge-in is native. |

These are **initial budgets to validate against the pilot**, not contractually fixed — the point is
that we *measure and gate* on them, and that the numbers are visibly different per mode so the
latency/portability trade is explicit.

**Latency as a mode-selection input.** The round-trip mode is portable (rides the four-tier swap to
server-local Whisper / on-device per ADR-003) but its legs are sequential, so it sits in the
2–4s band. `gemini_live` is cloud-locked but sub-second and interruptible. The decision is therefore
*"how much latency can this class tolerate vs how much lock-in"* — a class that wants natural
conversation pays the `gemini_live` portability cost for the latency; a locked-down or
self-host-bound class takes the round-trip's higher latency for portability. The budget makes that
trade legible.

**Mobile is the worst case — coordinate with [mobile-performance-pass.md](mobile-performance-pass.md)
(1.1.30).** Measure the latency budget on the representative low-mid Android over a throttled
classroom network, *not* on a dev laptop — that is the device students actually use, and the leg most
sensitive to it is the network round-trips to STT/TTS. The two docs share one measurement on one
device.

**Instrumentation:** extend the 1.1.11 `voice.*` spans with a derived `voice.roundtrip_ms` (and the
per-leg breakdown already present) → BigQuery, so p50/p95 per mode/class is a dashboard, not a
one-off measurement (Axiom 8). The cost-dashboard (1.1.9) already surfaces `voice.*` spans; latency
joins them.

**Acceptance (added):**

- [ ] `voice.roundtrip_ms` (utterance-end → first reply audio) is captured per turn and lands in BQ with the per-leg breakdown.
- [ ] `stt_tts_roundtrip` meets **p50 ≤ 2.0s / p95 ≤ 4.0s** on the representative low-mid Android over a throttled network (shared measurement with 1.1.30).
- [ ] The first-enabled-mode decision (Q1) records latency as one of its stated grounds, alongside GDPR and portability.

## UX (mode-agnostic where possible)

- A **voice-mode** control in the chat header (per-session, gated behind the per-class teacher toggle 1.1.11 already added). Off by default.
- **`stt_tts_roundtrip`:** push-to-talk (press-and-hold / tap-to-start-stop) — explicit start/stop, no always-on mic. On release: transcript fills the input (edit-then-send) or auto-sends (hands-free preference). Reply auto-read.
- **`gemini_live`:** a live-session control (start/stop conversation) with a clear streaming indicator; interruptible.
- **Shared:** explicit recording/streaming indicator + a visible resting ("mic off") state (Axiom 11 — never an ambiguous always-listening UI); fall back to typing if mic/permission unavailable.

## Axiom Alignment (the `voice_mode` axis + initial modes)

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | `gemini_live` is low-latency/interruptible; `stt_tts_roundtrip` is turn-based but streams the tutor turn + ≤500ms TTS p95. The axis lets a class pick the latency profile it needs. |
| 2 | EARNED TRUST | 0 | Voice is transport over the same tutor turn; no factual-claim change. |
| 3 | SKILLS, NOT FEATURES | +1 | `voice_mode` is a per-class/activity config on existing skills — no new concept; teachers pick a mode, not wire an app. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | **The core fit.** Voice mode is swap-shaped exactly like model tier (ADR-003): cloud Live now, server-local Whisper / on-device later — right tier per class/network/cost, by config. |
| 5 | GRACEFUL DEGRADATION | +1 | Mode unavailable (LiveRunner down, no mic) → fall back along the axis: `gemini_live` → `stt_tts_roundtrip` → typing. Voice is strictly additive over the text loop. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Extends the 1.1.11 provider registry with a mode axis; `gemini_live` rides ADK LiveRunner, `stt_tts_roundtrip` rides AG-UI + `/api/voice/*`. No bespoke protocol; the streaming mode uses ADK's native bidi, not a custom one. |
| 7 | API FIRST | +1 | Mode selection + orchestration are backend/config; CLI/eval can drive any mode; channels inherit. |
| 8 | OBSERVABLE BY DEFAULT | +1 | `voice.mode` joins the 1.1.11 `voice.*` cost/latency spans → BigQuery; per-mode cost/latency is measurable (a `gemini_live` class costs more — visible). |
| 9 | SECURE BY CONSTRUCTION | 0 | **Per-mode, by construction.** `stt_tts_roundtrip`: push-to-talk + transcript-only + EU STT → neutral. `gemini_live`: continuous audio egress to the model → **would score −1 on its own** and is **gated** on the audio-capture review before that mode is enabled. The axis is neutral; the **gate lives on the mode**, so a heavier-egress mode cannot ship without its own sign-off. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Mode selection + orchestration backend; client records/plays/streams only. |
| 11 | USABLE BY DESIGN | +1 | Per-mode controls, explicit streaming/recording indicator, resting state, fall-back-to-typing — designed before build; shared-tablet/no-laptop target. |
| | **Net Score** | **+8** | Threshold: ≥ +4. The **gate-on-the-mode** design keeps the axis clean while holding `gemini_live` to its own privacy review. |

**Conflict Justifications:** none at −1 for the axis. The continuous-audio-egress risk is **contained to the `gemini_live` mode** and gated on the [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) five-question review — that mode is not enabled until M signs off. `stt_tts_roundtrip` carries no such risk and can be the default-safe mode.

## What ships for 23 June

- **The `voice_mode` config axis** (registry extension + per-class/activity selection + `voice.mode` span). This is the durable deliverable — it makes every future mode a config flip.
- **At least one mode enabled end-to-end** — `stt_tts_roundtrip` is the certain-to-land first mode (composes shipped parts); `gemini_live` enabled too **if** LiveRunner integration + M's audio review land in the window. The date is de-risked because the axis + the cheap mode guarantee *something live*, and the rich mode slots in without rework.
- Per-class teacher gate (reuse 1.1.11 toggle) + the UX controls above.
- GDPR: M's per-mode sign-off recorded in the security note before each mode is enabled.

## Open questions (fold into the follow-up `bidirectional-voice.md` design doc)

- **Q1 — first-enabled mode for the date** (JB): `stt_tts_roundtrip` certain; `gemini_live` as headline if it lands. Either way the axis ships.
- **Q2 — `gemini_live` GDPR** (M): continuous-audio review (audio-capture five questions) — gates that mode, not the axis.
- **Q3 — auto-send vs edit-then-send** in `stt_tts_roundtrip` (hands-free vs reviewable). Offer both; default edit-then-send.
- **Q4 — barge-in** is native to `gemini_live`, impossible in `stt_tts_roundtrip` — set expectations per mode, don't promise it for the round-trip.
- **Q5 — Danish STT/Live accuracy** on teen speech in a noisy classroom — pilot-validate per mode.
- **Q6 — shared-device consent** — push-to-talk (round-trip) / explicit start (live) is the consent gesture; confirm with M under the anonymous-group model (ADR-001).

## Immediate next steps (the date is 14 days out)

1. **Today/tomorrow:** JB picks the first-enabled mode; M gives the per-mode GDPR posture (delta for round-trip, full review for live).
2. Write the thin `bidirectional-voice.md` design doc / sprint plan — the `voice_mode` axis + the enabled mode(s) — ~0.5d.
3. Build the axis + `stt_tts_roundtrip` over 1.1.11 (~0.5–1.5d) to guarantee a working demo; bring up `gemini_live` off the LiveRunner stub (~3–5d) in parallel and enable it by config when ready + signed off.

## Related documents

- [voice-provider-abstraction.md](implemented/voice-provider-abstraction.md) — 1.1.11; the shipped swap-shaped provider layer this adds a **mode axis** to
- [voice-personas.md](voice-personas.md) — 1.1.12; the voice/avatar layer a spoken reply uses (any mode)
- [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) — the audio-in privacy review; **gates the `gemini_live` mode**, delta for `stt_tts_roundtrip`
- [backend/adk/live_agent.py](../../../../backend/adk/live_agent.py) — the LiveRunner stub the `gemini_live` mode builds on
- [mobile-performance-pass.md](mobile-performance-pass.md) — mobile is the worst case for the latency budget; shared measurement (1.1.30)
- [june-15-feedback.md](june-15-feedback.md) — the 15-June map; this doc absorbs its "audio latency" item
- ADR-003 (four-tier swap-shaped model/voice selection) + ADR-005/007 (EU residency) — scoping-site `architecture.qmd`; the pattern `voice_mode` mirrors
