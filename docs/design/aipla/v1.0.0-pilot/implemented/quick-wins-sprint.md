# Sprint: QUICK-WINS — 1.E workbench debounce + 1.H-TTS

**Sprint ID:** `QUICK-WINS`
**Design docs:** [workbench-state-debounce.md](workbench-state-debounce.md) (1.E) + [audio-capture-and-tts.md](audio-capture-and-tts.md) Part 1 only (1.H-TTS)
**Branch:** `feature/quick-wins-debounce-tts`
**Base commit:** dev HEAD after PR #3 merge
**PR target:** `dev`
**Estimate:** ~1 day total (~0.5d each, parallelize)
**Created:** 2026-05-25

## Sprint goal

Ship two independent UX polish items before the next demo:

- **1.E workbench-state debounce** — slider drags no longer spam the chat with cards. Wire-shape becomes minimal-delta `{changed, value, unit}` not full snapshot. Centralised in `StaticArtefactFrame` so all current + future artefacts inherit.
- **1.H-TTS** — every tutor message gets a `Volume2` icon button that calls `window.speechSynthesis.speak()`. Click again to cancel. Zero backend, zero privacy gate.

Both flagged in the 2026-05-25 meeting; both have design docs landed; both are pure-FE / zero-protocol work.

## Why "ADK audio" is out of scope

`backend/adk/live_agent.py` is a stub for Gemini Live (LiveRunner / WebSocket bidirectional STT+TTS+LLM). Wiring that up is 3-5 days minimum and a different shape entirely (real-time voice conversations). The TTS half of 1.H deliberately uses browser-native `speechSynthesis` because it's *the* zero-friction "read this message aloud" affordance — see [audio-capture-and-tts.md](audio-capture-and-tts.md) §Standards Compliance Check.

If we ever want voice-in-voice-out tutoring, that lands as a separate sprint after the pilot.

## Scope (locked from design docs)

**In scope — 1.E:**
- Boldkast artefact emits debounced `mcp_app_context` writes at 800ms idle (currently 500ms host-side)
- Wire payload becomes minimal-delta: `{changed: "v0", value: 15, unit: "m/s"}` not the full state snapshot
- `StaticArtefactFrame` adds host-side coalesce-by-field (300ms): rapid-fire deltas on the same field merge into one outbound iframe-context POST
- Reuse the existing iframe-context route — no new endpoints

**In scope — 1.H-TTS:**
- New `<ReadAloudButton>` component using `window.speechSynthesis`
- Mounted on every tutor message in `MessageBubble` / `ChatMessageList` next to the timestamp, using lucide `Volume2` (playing → `VolumeX` to cancel)
- Language passed in from the active skill (defaults to `"da"` for problem-set-hints, falls back to `"en"`)
- Vitest cases: mock `speechSynthesis`; assert `speak(text, lang, rate)` + `cancel` flow
- Gracefully hidden when `speechSynthesis` is unavailable

**Out of scope (Part 2 of 1.H — separate sprint, JB-gated):**
- Audio capture (microphone recording)
- Consent flow
- Backend upload pipeline

**Out of scope (broader future work):**
- Gemini Live / ADK LiveRunner audio
- Auto-play TTS for every turn (manual button only in this sprint)
- Voice selection UI (default OS voice)

## Milestones

### M1 — Boldkast artefact emits minimal-delta + 800ms (~0.15d)

**Files:**
- `infrastructure/mcp-sandbox/artefacts/boldkast/v1/index.html` — debounce iframe-context emissions at 800ms; emit only the changed field + value + unit, not the full state snapshot

**Acceptance:**
- [ ] Dragging the v0 slider continuously → exactly one `update-model-context` postMessage fires 800ms after the drag stops
- [ ] Toggling between v0 / θ / g sliders → each emits separately (no merge across fields at the artefact)
- [ ] No payload shape regression: existing `mcp_app_context.boldkast.*` keys still get written

### M2 — `StaticArtefactFrame` host-side coalesce + lower threshold (~0.15d)

**Files:**
- `frontend/src/components/protocols/StaticArtefactFrame.tsx` — replace the existing 500ms host debounce with a 300ms coalesce-by-field. Within 300ms of the same `changed` field, mutate-in-place; otherwise flush.
- Existing tests for `StaticArtefactFrame` should still pass; add one new vitest case for the coalesce path.

**Acceptance:**
- [ ] Existing vitest tests green
- [ ] New test: two rapid v0 deltas within 300ms produce one POST; two v0 deltas 500ms apart produce two
- [ ] Two different fields within 300ms (v0 then θ) produce two POSTs (no cross-field merge)

### M3 — `<ReadAloudButton>` component (~0.2d)

**Files (new):**
- `frontend/src/components/chat/ReadAloudButton.tsx` — wraps `window.speechSynthesis`. Props: `{ text: string, lang?: string }`. Internal state: `isSpeaking: boolean`. lucide-react `Volume2` when idle, `VolumeX` when speaking.
- `frontend/src/components/chat/__tests__/ReadAloudButton.test.tsx` — mock `speechSynthesis`; 5+ cases (click speaks, click again cancels, lang defaults to "da", unmount cancels, hidden when API unavailable)

**Acceptance:**
- [ ] Component renders only when `typeof window.speechSynthesis !== "undefined"` (server-render safe, mobile-Safari quirks handled)
- [ ] First click → `speak(SpeechSynthesisUtterance(text, lang))`, button switches to `VolumeX`
- [ ] Second click → `speechSynthesis.cancel()`, button switches back
- [ ] Unmount cancels any in-flight utterance (prevents Boldkast page leak)
- [ ] All vitest cases green

### M4 — Mount the button on every tutor turn (~0.15d)

**Files:**
- `frontend/src/components/chat/MessageBubble.tsx` (or wherever tutor turns render — confirm path) — add `<ReadAloudButton text={message.content} lang={skillLang} />` next to the existing timestamp for `role === "assistant"`
- Pass `skillLang` down from the chat page (already on `useSkillMeta` indirectly — check whether `language` flows; if not, default to "da" for problem-set-hints via the existing branding/skill plumbing)

**Acceptance:**
- [ ] Each tutor message has a small Volume2 button right of the timestamp
- [ ] Click reads the message aloud in Danish (for problem-set-hints)
- [ ] No regression in MessageBubble layout / vitest tests
- [ ] No emoji introduced (per feedback-no-emoticons — `feedback_no_emoticons.md` (agent-memory note, not a project file))

### M5 — Quality gates (~0.05d)

- [ ] `cd frontend && npm run quality:check` — lint + typecheck + tests + build all green
- [ ] No backend changes in this sprint → no `make lint` / `make test-fast` needed
- [ ] Manual: LOCAL_MODE chat → drag Boldkast v0 → confirm one chat card not five; click TTS button → hear the tutor text in Danish

### M6 — PR (~0.05d)

- [ ] PR opened against `dev`
- [ ] PR body links both design docs (`workbench-state-debounce.md` + `audio-capture-and-tts.md` Part 1)
- [ ] PR description explicitly states audio capture (Part 2 of 1.H) is NOT included — separate sprint, JB-gated

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `speechSynthesis` lang `"da"` voice unavailable on a tester's OS | Medium | Browser falls back to default voice; no crash. Tester gets English-accented Danish — flag in PR test plan |
| Mobile Safari `speechSynthesis` autoplay restrictions | Medium | Click is a user gesture so play should work; tested in vitest mock but verify on iOS Safari manually |
| 800ms debounce feels sluggish to teachers reviewing the chat | Low | Easy to tune in a follow-up; 800ms is the design-doc default |
| Coalesce by field accidentally drops events | Medium | New vitest case explicitly verifies different-field events aren't merged |

## Success criteria

- [ ] PR opened against `dev` from `feature/quick-wins-debounce-tts`
- [ ] All 6 milestones' acceptance gates met
- [ ] Frontend `quality:check` green
- [ ] Manual: drag boldkast slider continuously → ≤1 chat card per 800ms idle window; TTS button reads aloud + cancels

## Out of scope (do NOT start in this sprint)

- Audio capture (Part 2 of 1.H — JB consent gate)
- Gemini Live / LiveRunner / WebSocket voice (separate Year-2 sprint)
- Auto-play TTS (manual button only)
- TTS controls UI (voice picker, rate slider) — defer to Year-2 if requested
