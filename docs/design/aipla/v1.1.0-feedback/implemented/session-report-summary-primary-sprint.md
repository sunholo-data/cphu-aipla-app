# Sprint plan — 1.1.4 session-report summary-primary

**Design doc:** [../session-report-summary-primary.md](../session-report-summary-primary.md) (see 2026-06-13 reconciliation)
**Created:** 2026-06-13
**Estimate:** ~1d

## Milestones

### M1 — Backend narrative generation + cache (TDD)
- `ChatSessionIndex`: add `summary_text` / `summary_generated_at` / `summary_based_on_turn_count`.
- `SessionSummary.narrative: str | None`.
- `backend/reports/narrative.py`: grounded prompt (workbench events, no-invent, "the group", no emoji) → Gemini Flash; `resolve_narrative()` caches on the index, regenerates when message count grows, swallows LLM/cache failures.
- Wire into `reports_routes` (`narrative=true` default; `source=bq` verify path stays LLM-free).
- **Tests:** prompt grounding, cache hit/regenerate, empty conversation, failure-swallow.

### M2 — Frontend summary-first layout (TDD)
- `SessionSummaryPayload.narrative`.
- Report page: prominent **Summary** (ChatMarkdown) + **At a glance** metrics; transcript collapses behind a **View full transcript** toggle (localStorage-persisted, default collapsed). CSV/JSON unchanged. Lesson transcript (`GroupTranscriptSection`) already mounted below.
- **Tests:** transcript collapsed by default, reveals on toggle.

## Acceptance
- Summary prominent; transcript collapsed by default + one click away; toggle persists; CSV works; summary grounded in workbench events (no hallucinated params); cached on second open; no emoji; `make lint` + `make test-fast` + `npm run quality:check` green.

## Deferred (documented)
Server-side `transcript.csv` endpoint + consent-gated 410 + "No research consent" badge — all depend on [1.1.3 consent](../student-consent-prompt.md) (OPEN). Editable summary, multi-session summaries, concept→DRA tagging (2.5).
