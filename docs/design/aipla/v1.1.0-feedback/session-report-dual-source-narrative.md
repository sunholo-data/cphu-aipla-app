# Session-report narrative — dual-source (chat + audio), readable inputs, debounced regen

**Status:** Planned — extends the shipped narrative (1.1.4) with the audio transcript (1.1.35) + a teacher-readable generation experience
**Priority:** P1 — directly on the teacher pilot path; composes two shipped pieces (chat narrative + good audio transcript)
**Estimated:** ~2–2.5d — backend dual-source + cache/debounce + inputs API ~1d; frontend readable-inputs + browseable sections + status ~1–1.5d
**Scope:** Backend (`reports/narrative.py`, `reports/session_summary.py`, `protocols/reports_routes.py`, `db/models/chat_session.py` cache field); frontend (teacher report page — readable inputs while generating + persistent browseable sections + status)
**Dependencies:** [1.1.4 session-report-summary-primary](implemented/session-report-summary-primary-sprint.md) (the narrative this extends — SHIPPED); [1.1.35 research-audio-capture-quality](research-audio-capture-quality.md) (the **good** audio transcript this consumes — Gemini); relationship to [1.1.31 teacher-analytics-framework](teacher-analytics-framework.md) (the **R1-gated live dashboard** — see "R1 boundary" below)
**Source (request):** M, 2026-06-16 — "generated on request, but more feedback about why it's taking longer and what's included; include both audio and chat history; send the pre-parsed transcript not raw audio; debounce re-gen to ~5 min for live sessions; make the included text browseable."
**Last Updated:** 2026-06-16

> **How generation works today (the answer to "when does it regenerate?").** The
> narrative is **lazy and on-demand: it (re)generates inside the report GET, when the
> teacher opens or refreshes the report** — there is no background job. On each open,
> `resolve_narrative` ([narrative.py:95](../../../../backend/reports/narrative.py#L95))
> compares the cached `summaryBasedOnTurnCount` to the live message count: if the session
> hasn't grown, it serves the cache for free; if it has, it makes a **synchronous Gemini
> call during that request** and overwrites the cache (full recompute, not a merge). So
> "regenerates when chat turns grow" means *"the next time the teacher opens the report
> after new turns have landed."* During a live lesson, a teacher who keeps refreshing would
> trigger a fresh LLM call each time — which is why the **5-min debounce** below matters.

## Problem Statement

Three gaps, now that the audio transcript is finally usable (1.1.35):

1. **The narrative ignores the spoken discussion.** It is built only from **chat turns +
   workbench events** ([session_summary.py](../../../../backend/reports/session_summary.py));
   the group's *spoken* discussion — the richest signal for "how did they reason aloud?" —
   never reaches the summary, even though we now transcribe it well.
2. **No feedback during a slow, opaque generation.** Generation is synchronous on the GET
   with a bare "Loading report…". Adding the audio transcript makes the input bigger and the
   call *slower*, so the teacher needs to know **why it's taking longer** and **what it's
   based on** — and ideally **read the source material while they wait**.
3. **Repeated regeneration during a live lesson.** Regen is gated only by turn count and
   evaluated on every open, so a teacher refreshing during an active lesson re-runs the LLM
   repeatedly (cost + churn), with no rate limit.

**Current State:**
- Narrative: chat turns + workbench events only; one Gemini call (now config-driven model,
  RAQ-1); cached on `chat_sessions/{sessionId}` (`summaryText` / `summaryGeneratedAt` /
  `summaryBasedOnTurnCount`); regen when `summaryBasedOnTurnCount < live message count`.
- Audio transcript: a separate, now-accurate per-group text (`_transcript_for_group`,
  [recording_routes.py:179](../../../../backend/protocols/recording_routes.py#L179)),
  rendered in its own `GroupTranscriptSection` on the report — **not** fed to the narrative.
- Report page: summary on top, transcript section below; a bare loading state.

**Impact:** The teacher summary is half-blind (typed, not spoken), opaque while it generates,
and wasteful on a live refresh. All three are felt most exactly where the pilot lives — a
teacher watching a class.

## Goals

**Primary:** Make the teacher report summarise **both** the chat and the spoken discussion,
generated on demand but with the **raw material readable the whole time** — so the wait is
transparent, the basis is auditable, and the cost is bounded.

**Success metrics:**
- The narrative prompt includes **both** the chat history and the **pre-parsed audio
  transcript** (text, not raw audio).
- On open, the **chat history and audio transcript render immediately** (no LLM wait) and stay
  **browseable underneath** the summary; the summary fills in above them when ready.
- A visible **"what's included"** line (N chat turns · X min audio · Y sim interactions ·
  model · generated-at) — answers "why is it slow / what is this based on."
- Regeneration is **debounced to ≥5 min**: repeated opens during a live lesson reuse the
  cache and show "last generated N min ago," never re-running the LLM more than once per 5 min.
- Regen also fires when the **audio transcript grows** (a late segment landed), not only chat.

**Non-Goals:**
- **Raw audio to the narrative model** — explicitly rejected (see Design A1); we send the
  pre-parsed transcript.
- **Proactive / auto-refreshing live summary** (push every 5 min without the teacher opening
  the report) — that is the **R1-gated** live dashboard (1.1.31), not this doc. Here the
  teacher still initiates the open/refresh; the debounce only *rate-limits* on-demand regen.
- **Streaming the narrative token-by-token** (AG-UI) — a possible follow-up (Design B option
  b); v1 ships the readable-inputs loading state instead.
- Cross-session enhancement — unchanged; per-session snapshot.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | The raw inputs (chat + transcript) render **immediately**, no LLM wait — the teacher reads while the summary forms; the debounce removes redundant slow regens. |
| 2 | EARNED TRUST | +1 | The teacher can **read the exact source** the summary is drawn from (browseable chat + transcript) + an explicit "what's included"; the summary is auditable, not a black box over hidden data. |
| 3 | SKILLS, NOT FEATURES | 0 | Platform report surface, not a skill. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Sends the cheap **pre-parsed transcript**, not raw audio (no per-open re-transcription); config-driven model; debounce avoids wasteful regen. |
| 5 | GRACEFUL DEGRADATION | +1 | Narrative stays best-effort (failure → report still renders, now with readable inputs); no transcript → chat-only narrative; the inputs render even if the LLM is down. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Reuses the report endpoint + cache row; the streaming option (deferred) would ride AG-UI. |
| 7 | API FIRST | +1 | Inputs + transcript + counts on the report response; any channel renders them. |
| 8 | OBSERVABLE BY DEFAULT | +1 | `report.narrative` span gains source sizes (chat turns, voice chars) + regen-vs-cache + debounce-skipped; cost visible. |
| 9 | SECURE BY CONSTRUCTION | 0 | Same auth as the report (owner-teacher / researcher); the transcript is already group-scoped + ACL'd — no new data access. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Backend assembles summary + inputs + counts; the frontend renders. No client-side model logic. |
| 11 | USABLE BY DESIGN | +1 | The feature *is* the teacher experience during a slow generation — designed loading (raw material readable), "what's included," browseable sections, debounce messaging. |
| | **Net Score** | **+8** | Threshold ≥ +4. |

**Conflict Justifications:** none at −1.

## Design

### A1 — Dual-source narrative: chat + pre-parsed transcript (not raw audio)

**Why not raw audio.** We already transcribe the audio in the recording pipeline (Gemini,
RAQ-1). Sending raw audio to the narrative would re-transcribe it on *every report open*
(slow, costly), add ~80k audio tokens for a 40-min session, and lose auditability. The
transcript is a few KB of text, already produced, cacheable, and human-readable. **Send the
text transcript + the chat history.**

- `SessionSummary` gains `voice_transcript: str` + `voice_minutes: float` + `voice_segments: int`.
- The report route resolves the group's transcript via `_transcript_for_group(group_id)` and
  attaches it to the summary (the session's group is already known to the route).
- `build_narrative_prompt` sends **both, clearly labelled** so the model distinguishes typed
  from spoken:

  ```
  Chat with the tutor (what the group typed):
  [student] ...
  [tutor] ...

  Spoken group discussion (audio transcript):
  ...

  Workbench events: ...
  ```

- The system prompt gains one line: *"Use the spoken discussion to capture reasoning the chat
  doesn't show; attribute to 'the group', never individuals; the transcript may be imperfect —
  don't over-quote it."* (keeps the no-individuals + no-verbatim posture).

### A2 — Regeneration trigger + 5-min debounce (cost guard on on-demand regen)

Still lazy on the report GET. New regen condition:

```
grew      = (live_turn_count > cached_turn_count) or (live_voice_chars > cached_voice_chars)
debounced = (now - summaryGeneratedAt) < DEBOUNCE_MINUTES        # DEBOUNCE_MINUTES = 5
regenerate = grew and not debounced
```

- Regenerate only when the content **grew** AND it's been **≥5 min** since the last generation.
  Otherwise serve the cache and tell the teacher "last generated N min ago."
- New cache field `summaryBasedOnVoiceChars` on `ChatSessionIndex` (alongside the existing
  `summaryBasedOnTurnCount`); regen now keys off **both** counts.
- A **finished** session stops growing → permanent cache hit; the debounce only ever bites a
  **live** session being refreshed.
- This is a **rate-limit on the teacher's own on-demand opens**, not a proactive push — so it
  stays clear of the R1 gate (see boundary below).

### A3 — Report response: inputs + readable raw material

The report response already carries the conversation + (separately) the transcript. Add an
explicit **`inputs`** block so the frontend can render "what's included" without recomputing:

```
inputs: {
  chatTurns: int,
  voiceMinutes: float,
  voiceSegments: int,
  simEvents: int,
  model: str,                 // the config-driven model used
  generatedAt: str | null,    // ISO; null while never-generated
  basedOnTurnCount: int,
  state: "fresh" | "cached" | "generating" | "none",
}
```

`state` lets the frontend show the right banner (generating vs cached-N-min-ago).

### Frontend — readable inputs while generating + browseable sections

The chat history and transcript are available **without** the LLM, so render them first:

1. **On open, immediately render** the raw material — a **"Chat with the tutor"** section and a
   **"Recorded discussion (transcript)"** section, browseable, beneath where the summary will
   sit. The teacher can *read the source as the summary generates*.
2. **Summary slot on top** shows a status from `inputs.state`:
   - `generating` → *"Generating summary from {chatTurns} chat turns + {voiceMinutes} min of
     recorded discussion…"* (names the inputs → explains the wait).
   - `cached` → the summary + *"Generated {N} min ago · refreshes at most every 5 min during a
     live lesson."*
   - `none` → *"No summary yet — read the chat and recording below."*
3. **Persistent layout:** summary (top) → "what's included" line → browseable **Chat** +
   **Recorded discussion** + **Sim interactions** sections (always available, not hidden).

> **Loading design first (Axiom 11).** The empty/loading/error states are the feature: loading
> = the raw material is readable; error (narrative failed) = the inputs still render with a
> "summary unavailable, read the source below" note; empty = the no-summary-yet state above.

## R1 boundary (important)

The **5-min debounce is a cost-guard on the teacher's own on-demand opens** — it does **not**
auto-refresh or push. A *proactive* rolling live summary (regenerating every 5 min while a
lesson is live, without the teacher opening the report) is the **R1-gated** live dashboard,
[1.1.31](teacher-analytics-framework.md) ("do not instrument the summary before R1", due before
the 2026-06-29 freeze). This doc ships **un-gated**: dual-source narrative + readable inputs +
debounced on-demand regen. If/when the report auto-polls during a live lesson, that crosses
into 1.1.31's R1 decision and is scoped there.

## API Changes

- `GET /api/reports/groups/{group}` and `/sessions/{id}`: response gains `inputs` (above) and
  the `voiceTranscript` already available; the narrative now reflects both sources.
- No new endpoint. Auth unchanged (owner-teacher / researcher).

## Migration

- New Firestore field `summaryBasedOnVoiceChars` on `ChatSessionIndex` — additive, defaults
  absent (treated as 0 → first open with audio regenerates once). No backfill.
- No frontend flag; the readable-inputs layout replaces the current one.
- Rollback: revert; cache fields are additive and ignored by the old code.

## Testing Strategy

- **pytest narrative:** prompt includes both labelled sources; chat-only when no transcript;
  regen fires when voice chars grew; debounce blocks regen within 5 min; cache hit when neither
  grew.
- **pytest reports route:** `inputs` block shape + counts; transcript attached for the session's
  group; auth unchanged.
- **vitest report page:** raw inputs render before the summary; `state=generating` banner names
  the inputs; `cached` shows "N min ago"; sections browseable; narrative-failed → inputs still
  render.
- **Manual:** open a live session repeatedly within 5 min → one LLM call, cache served, raw
  material readable throughout.

## Implementation Plan

| Step | What | Est |
|---|---|---|
| 1 | `SessionSummary` += voice fields; route attaches `_transcript_for_group`; prompt sends both labelled | 0.4d |
| 2 | Regen condition + 5-min debounce + `summaryBasedOnVoiceChars`; `report.narrative` span gains source sizes | 0.3d |
| 3 | `inputs` block on the report response + tests | 0.3d |
| 4 | FE: render raw inputs immediately + browseable Chat/Recording/Sim sections | 0.6d |
| 5 | FE: summary-slot status (generating/cached/none) + "what's included" line + debounce messaging | 0.4d |
| 6 | Tests (pytest + vitest) + manual live-refresh check | 0.4d |
| | **Total** | **~2.4d** |

## Success Criteria

- [ ] Narrative prompt includes the chat history **and** the pre-parsed audio transcript (labelled), never raw audio.
- [ ] On open, chat + transcript render immediately and stay browseable beneath the summary.
- [ ] "What's included" line shows chat turns · audio minutes · sim events · model · generated-at.
- [ ] Regen fires when chat **or** audio transcript grows; debounced to ≤ once / 5 min on a live session.
- [ ] Narrative-failed → report still renders with readable inputs.
- [ ] pytest + vitest green.

## Open Questions

- **Q1 — debounce window.** 5 min per M. Per-class override later? Default 5 min, env/config knob.
- **Q2 — transcript freshness vs the session.** The group recording can lag the chat (segments
  transcribe in the background). Show the transcript's own "as of" time so the teacher knows it
  may trail the live chat.
- **Q3 — model for the narrative on big dual-source input.** Config-driven default
  (`gemini-3.5-flash`) — confirm it handles chat+transcript length well; the 1M context is ample.
- **Q4 — streaming (option b).** If teachers want live token-by-token summary text, stream via
  AG-UI as a follow-up; v1's readable-inputs loading state may already satisfy the "feedback"
  need.

## Related Documents

- [session-report-summary-primary](implemented/session-report-summary-primary-sprint.md) — 1.1.4; the narrative this extends.
- [research-audio-capture-quality](research-audio-capture-quality.md) — 1.1.35; the Gemini audio transcript this consumes (and why it's finally good enough to summarise from).
- [teacher-analytics-framework](teacher-analytics-framework.md) — 1.1.31; the **R1-gated** live dashboard; the proactive rolling summary lives there, not here.
- `backend/reports/narrative.py`, `backend/reports/session_summary.py`, `backend/protocols/recording_routes.py` (`_transcript_for_group`).
- SEQUENCE.md row **1.1.36**.
