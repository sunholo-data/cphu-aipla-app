# Session report — narrative summary as the primary display

**Status:** Planned (P1)
**Last Updated:** 2026-06-03
**Priority:** P1 — teachers asked at the 3 June check-in for narrative summaries, not raw chat transcripts. Also the privacy-strategy foundation for eventual audio inclusion
**Estimated:** ~0.5d frontend + ~1h prompt update + ~0.5d backend (summary structure)
**Scope:** Frontend (collapse-by-default transcript + download); backend (summary-generation prompt update); session-report rendering
**Dependencies:** [teacher-insights-dashboard.md](../v1.0.0-pilot/implemented/teacher-insights-dashboard.md) (shipped); [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (shipped)
**Source brief:** [`june-03-feedback-sprint-brief.md` §4](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md)

## Problem

The current session-report page shows both an AI-generated summary and the full transcript. Teachers at the 3 June check-in said the transcript is too noisy — they want the **narrative summary** prominent, transcript on demand. This is also strategically aligned with the privacy posture for eventual audio inclusion: a summary has a meaningfully lower privacy profile than verbatim student speech.

## Change

Two coordinated changes:

1. **Layout flip** — summary becomes the prominent default view on the session-report page; full transcript collapses behind a `[View full transcript ▸]` toggle; a `Download transcript (CSV)` button replaces inline rendering as the primary access path for full data
2. **Summary prompt rewrite** — make the summary actually contain what teachers asked for: a 3-5 sentence narrative + bullet list of (concepts, parameters tried, checklist progress) + one "what next" sentence

## Design

### Frontend layout

The session report currently lives at (verify path): `frontend/src/app/teacher/classes/[classId]/sessions/[sessionId]/page.tsx` (or similar — confirm against shipped teacher-insights-dashboard structure).

New layout:

```
┌────────────────────────────────────────────────────────┐
│  Session — Group ABC-123 — 2026-06-15 14:30           │
│                                                        │
│  Activity: Boldkast (projectile motion)               │
│  Duration: 28 min · 34 messages · 8 sim runs           │
│  [ No research consent ]  ← badge if consent declined │
│                                                        │
│  ─────────────────────────────────────────────────────│
│                                                        │
│  ## Summary                                            │
│                                                        │
│  Three students explored projectile motion using the   │
│  Boldkast simulator. They began by varying the launch  │
│  angle and noted the 45° maximum range result without  │
│  initial scaffolding, then explored the role of        │
│  initial velocity. They struggled to articulate why    │
│  the trajectory is parabolic.                          │
│                                                        │
│  **Concepts discussed:**                               │
│   • Projectile motion symmetry                         │
│   • Effect of launch angle on range                    │
│   • Independence of horizontal and vertical motion     │
│                                                        │
│  **Sim parameters explored:**                          │
│   • Launch angle: 30°, 45°, 60°, 75°                  │
│   • Initial velocity: 10, 15, 20 m/s                   │
│                                                        │
│  **Checklist progress:** 3 of 5 steps completed       │
│                                                        │
│  **Next time:** Connect the parabolic trajectory to    │
│  the independence of horizontal and vertical motion.   │
│                                                        │
│  ─────────────────────────────────────────────────────│
│                                                        │
│  [ View full transcript ▸ ]   [ Download CSV ]        │
│                                                        │
│  (transcript collapsed; expands inline on click)      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Behaviour rules:**
- Summary always visible; never collapsed
- Transcript toggle defaults to collapsed; state persists per-user via localStorage (so a researcher reviewing many sessions can leave it open)
- CSV download streams `chat_turns` rows for the session: `(turn_idx, role, content, ts, tokens_in, tokens_out, model)` — matches the BQ schema 1:1
- The "Activity" / "Duration" / "messages" / "sim runs" header row stays — it's the at-a-glance facts the teacher uses to orient

### Backend: summary-generation prompt

Existing summary generation lives in the BQ-backed `summarize_session` flow (shipped in 1.2). Today's prompt produces a single-paragraph summary. Replace it with a structured request:

```
You are summarising a tutoring session for a teacher reviewing what happened.
Produce four sections, in this order:

1. **Narrative** (3-5 sentences): What did the group explore? What was their approach?
   Where did they get stuck? Use the past tense.

2. **Concepts discussed** (bullet list, 3-6 items): Key physics concepts that came up
   in conversation. Use the language of the activity's curriculum (Danish stx physics-A
   for LED Planck; NCERT Class 11 kinematics for KineBot; etc.).

3. **Sim parameters explored** (bullet list): Which workbench parameters did they
   actually vary? Pull from the workbench_events stream — do not invent.

4. **Checklist progress** (one line): "N of M steps completed" if the activity has
   a checklist; otherwise omit.

5. **Next time** (one sentence): What does this group most need next session?

Do NOT include the full transcript. Do NOT quote students verbatim. Refer to "the
group" or "the students" — never to individuals. Maximum ~250 words total.
```

The summary is generated **on-demand** (when a teacher opens the session report) rather than at session-end — this lets it incorporate the latest BQ rows including post-session corrections. Cache it in the session doc once generated; regenerate if the session is still active or if `chat_turns_count` has grown since last summary.

### Backend: summary cache field

`Session` doc gets:

```python
class Session(BaseModel):
    # ... existing fields ...
    summary_text: str | None = None
    summary_generated_at: datetime | None = None
    summary_based_on_turn_count: int | None = None
```

The summarize call regenerates if `summary_based_on_turn_count < current_turns_count`.

### CSV download endpoint

`GET /api/sessions/{session_id}/transcript.csv` — streams a CSV of `chat_turns` rows for the session. Auth: teacher must own the session's class OR have `role:researcher` claim (see [researcher-role.md](researcher-role.md)). Honours consent: declined sessions return 410 Gone (chat_turns table has no rows; serving an empty CSV would be misleading).

## Acceptance

- [ ] Session-report page renders summary first, prominently
- [ ] Transcript collapsed by default with a `View full transcript ▸` toggle
- [ ] Toggle state persists across navigations for the same user (localStorage)
- [ ] `Download CSV` link returns a well-formed CSV with one header row + N data rows matching `chat_turns` schema
- [ ] CSV download from a declined-consent session returns 410 (or a clear UX explanation, not silent empty file)
- [ ] Summary prompt produces all 4-5 sections in the documented order
- [ ] Sim-parameters section is *grounded in actual workbench events* — a session with no Boldkast runs does not produce hallucinated angle/velocity values
- [ ] Summary is cached on the session doc; opening the report a second time hits the cache (no LLM call) when turn count is unchanged
- [ ] No emoji in summary or UI (per [feedback-no-emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md))
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green
- [ ] Manual: open three real (or seeded) session reports of varying length; summary reads well; transcript is one click away

## Why this matters for audio

The brief calls out: *"This is also the privacy strategy for eventual audio inclusion — a summary has a much lower privacy profile than verbatim student speech."*

By making the summary the primary teacher-facing artefact now, when audio capture ships ([audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md), JB-gated), the teacher path is **already** summary-first. Audio (or its transcript) becomes a deeper-dive artefact behind the same `View full transcript ▸` affordance, with the same consent-gated download path. No second UX change needed when audio lands.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Summary hallucinates sim parameters / concepts not actually discussed | Medium | Prompt grounds explicitly in `workbench_events`; pytest case with a known-content session asserts the parameters appear correctly |
| Cached summary goes stale when a session continues | Low | Regenerate when `summary_based_on_turn_count < current_turns` |
| CSV download is a privacy leak vector | Medium | Auth checks identical to session-report page; declined-consent sessions return 410; future audit-log every download |
| Teachers ignore the summary and click straight to transcript | Low | If observed in pilot, A/B the layout; default-collapsed transcript is the right starting bias |
| Summary too long / too short for actual sessions | Medium | "~250 words" is a guideline; iterate with AR after the first 10 pilot sessions |

## Files

| File | Purpose | LOC est. |
|---|---|---|
| `frontend/src/app/teacher/.../sessions/[sessionId]/page.tsx` | Layout flip + collapse-by-default | +80 / -30 |
| `frontend/src/components/teacher/SessionSummary.tsx` (or update existing) | Render structured summary (markdown / sections) | +60 |
| `frontend/src/components/teacher/TranscriptToggle.tsx` | New collapse-toggle wrapper | ~40 |
| `frontend/src/components/teacher/__tests__/SessionSummary.test.tsx` | New | ~60 |
| `backend/skills/summarize_session.py` (or equivalent) | Updated prompt with 4-5 section structure; ground in workbench_events | +60 |
| `backend/db/models/session.py` | Add `summary_text`, `summary_generated_at`, `summary_based_on_turn_count` | +5 |
| `backend/protocols/session_routes.py` | `GET /api/sessions/{id}/transcript.csv` endpoint | +80 |
| `backend/tests/skills/test_summarize_session.py` | Assert all 4-5 sections present; grounded-in-events check | ~100 |

## Out of scope

- AI-generated summary of the audio transcript when audio is captured — that's a separate path inside [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md)
- Multi-session summaries (cross-session learning progression) — research-dashboard territory, year-2
- Summary translation (Danish summary for Danish teachers vs English for KineBot's NCERT cohort) — uses the activity's configured language; auto-translation deferred
- Editable summary (teacher annotates, saves) — deferred unless pilot teachers ask
- Concept-tagged summary (links concepts to a DRA map) — overlaps [2.5 session-analytics-rubric](../post-pilot/session-analytics-rubric.md); don't pre-bake the rubric here

## Related

- [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) — the BQ tables this reads from
- [teacher-insights-dashboard.md](../v1.0.0-pilot/implemented/teacher-insights-dashboard.md) — the surface this lives on
- [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) — sister doc; summary-first design here makes audio absorption straightforward
- [post-pilot/session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) — the deeper analytical layer; the summary-prompt sections (concepts, parameters) can later inform the rubric pipeline
- [student-consent-prompt.md](student-consent-prompt.md) — declined-consent sessions have no transcript to download (410 path)
