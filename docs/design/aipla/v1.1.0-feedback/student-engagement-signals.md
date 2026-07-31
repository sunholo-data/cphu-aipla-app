# Student engagement signals (formative, not sanctionary)

**Status:** Planned (P2); blocked on JB/AR review of the metric set + framing
**Last Updated:** 2026-06-06
**Priority:** P2 — adds lesson-quality signal to the teacher session report; not blocking
**Estimated:** ~1.5d
**Scope:** Frontend (per-turn composition telemetry); backend (aggregation + persistence); teacher session report surface; researcher cohort view
**Dependencies:** [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (1.2 shipped — BQ schema additions land here); [student-consent-prompt.md](student-consent-prompt.md) (1.1.3 gates write); [session-report-summary-primary.md](session-report-summary-primary.md) (1.1.4 — surface for per-student view); [researcher-role.md](researcher-role.md) (1.1.5 — cohort aggregates)
**Source conversation:** 2026-06-05 chat with M re: anti-cheat framing → reframed as lesson-quality signal

## Problem

The session report today summarises *what* the conversation contained but says nothing about *how* the student composed their turns. Two students with identical transcripts can have arrived at them very differently — one typing slowly with edits, one pasting from a notebook, one asking the same thing three times because the tutor's answer didn't land.

The framing M and JB agreed on (chat 2026-06-05): **if a student is trying to cheat, the battle is already lost.** Composition signals are not for sanction; they are for the teacher to see where *the lesson* needs improvement. *"60% of students paste their answer to problem 4"* tells the teacher the problem statement is probably ambiguous, not that 60% of the class is cheating. *"Mean turns to resolution on concept X is 12 vs class median 5"* tells the teacher the tutor's explanation for X needs work.

This is the same posture as ADR-001 anonymous-group auth: the platform is research / formative, not invigilation. Signals are aggregated at the lesson level; individual rows exist only so the teacher can dig in when a cohort signal points at a specific case.

## Design

### v1 metric set (ship this; defer the rest)

Five signals chosen because each measures something distinct, all are cheap to instrument, and the combination gives lesson-quality + per-student diagnostic coverage:

| Metric | What it measures | Where captured | Lesson-quality signal | Per-student signal |
|---|---|---|---|---|
| `paste_ratio` | Fraction of final turn length inserted via paste events vs typed | FE (`onPaste` + keystroke count) | High cohort paste rate on problem N → problem invites paste (ambiguous, copies-from-notes shaped) | One student consistently pasting may need different scaffolding (or may have a perfectly good reason — language, accessibility) |
| `revision_count` | Number of delete-then-retype cycles before submit (>3 chars deleted at once = revision) | FE (textarea diff sampling) | Cohort high revision rate on problem N → students are unsure how to phrase the answer; problem prompt may be unclear | Low revisions + short turn = quick / confident; high revisions = wrestling with the answer |
| `turns_to_completion` | Number of student turns from problem start to "done" (skill-defined completion event) | BE (session events) | Compare per-problem cohort distribution → which problems take longer than the teacher expected | Outlier per-student count flags either struggle or disengagement |
| `abandonment_point` | Which problem / step the student left on (last-turn skill + topic if known) | BE (session close + skill metadata) | Heatmap across cohort: where do students give up? | Per-student drop-off pattern across sessions |
| `re_ask_rate` | Student turns that semantically repeat a recent earlier turn (simple cosine sim ≥0.75 against previous 5 student turns) | BE (cheap embedding diff at write time) | Cohort high re-ask rate on topic X → tutor's first explanation on X isn't landing; rewrite the SKILL.md guidance | Per-student high re-ask = may need different explanation register |

**Not in v1** — captured in [Open questions](#open-questions) for later: time-to-first-character, total composition time, voice / workspace artefact usage, return visits, confusion-marker keyword classifier, conceptual-vs-procedural turn classification, pre/post understanding probe.

### Frontend capture (per turn)

A new `useCompositionSignals` hook wraps the chat textarea:

```ts
interface CompositionSignals {
  keystroke_count: number;       // typed chars (insertions of 1)
  paste_event_count: number;     // distinct onPaste fires
  paste_chars_total: number;     // sum of pasted text length
  revision_count: number;        // delete-then-retype cycles (>3 chars deleted)
  final_length: number;          // turn length at submit
  // derived BE-side: paste_ratio = paste_chars_total / final_length
}
```

The hook adds these to the AG-UI message payload as a sibling field to the user content. Zero new endpoints. **No keystream is sent** — only the counts. Aggregate fits in ~40 bytes per turn.

Voice-input turns (from 1.1.11) get `paste_ratio = null`, `revision_count = null` — voice composition is a different signal axis; treated as "not applicable" in aggregates.

### Backend persistence

**BigQuery** — extend the existing `chat_turns` table (no new table; signals are per-turn already):

```
chat_turns schema additions:
  paste_ratio              FLOAT64    -- null if voice or empty
  revision_count           INT64      -- null if voice
  final_length             INT64
  re_ask_score             FLOAT64    -- max cosine sim against previous 5 student turns (BE-computed at write)
```

**No Firestore additions per-turn** (Firestore is for the canonical conversation; analytics belongs in BQ). Session-level aggregates (`turns_to_completion`, `abandonment_point`) DO land in Firestore session doc so the teacher session report can render them without a BQ round-trip.

### Re-ask scoring (BE)

Cheap path: reuse the existing embedding model. At chat-log-pipeline write time, embed the new student turn, compute cosine sim against the embeddings of the previous 5 student turns in the session, store the max. No new model, no new infrastructure — embedding happens once and is reused for retrieval and for this signal.

Threshold for "re-ask" surfaced in aggregates: ≥0.75. Tunable per-skill via SKILL.md frontmatter (a skill that legitimately invites repetition can raise the floor).

### Teacher session report surface

Per [session-report-summary-primary.md](session-report-summary-primary.md), the report layout is summary-primary; engagement signals append a small block **below** the summary, **above** the collapsed transcript:

```
┌──────────────────────────────────────────────────────────┐
│  Engagement signals                                      │
│                                                          │
│  Turns to completion: 8  (class median: 5)               │
│  Re-asks: 2  (class median: 1)                           │
│  Paste ratio: 12%  (class median: 4%)                    │
│  Revisions per turn (mean): 2.1                          │
│  Last turn before leaving: problem 3, step 2             │
│                                                          │
│  How to read this: these are signals about the           │
│  session, not the student. High re-ask or paste rates    │
│  across many students usually point at the activity,     │
│  not the class.                                          │
└──────────────────────────────────────────────────────────┘
```

The framing line stays in the UI — not a tooltip. It's load-bearing for keeping the feature on the formative side.

### Researcher cohort view

[researcher-role.md](researcher-role.md) (1.1.5) view adds an "Engagement" tab per class:

- Per-problem heatmap: which problems get high paste rates, high re-ask rates, high abandonment
- Distribution of `turns_to_completion` per problem (box plot)
- Drop-off funnel: % of students reaching each problem / step
- Filterable by date range, skill, class

This is the headline view — turning signals into actionable *"rewrite problem 4 step 2 — the prompt is inviting paste."*

### Consent gating

Same gate as chat turns. Declined-consent sessions write `paste_ratio = null` etc. in the per-turn BQ row but the session-level aggregates (`turns_to_completion`, `abandonment_point`) are written — they're skill-and-problem keyed, not student-keyed, and aggregate research signal at the institutional level.

JB to confirm — if not acceptable, gate the whole row.

## Acceptance

- [ ] **JB/AR have reviewed the metric set + framing** (especially the on-UI "How to read this" copy)
- [ ] Composition hook captures `keystroke_count`, `paste_event_count`, `paste_chars_total`, `revision_count`, `final_length` correctly
- [ ] Paste of 0-length, paste-then-immediate-undo, IME composition (Danish accents) all handled without false positives
- [ ] Voice turns set composition fields to null, not 0 (distinguishable in BQ)
- [ ] Re-ask score computed at chat-log-pipeline write; max over previous 5 student turns; reused embedding
- [ ] Session-end writes `turns_to_completion` and `abandonment_point` to Firestore session doc
- [ ] Teacher session report renders engagement block with class-median deltas
- [ ] "How to read this" framing copy is in the UI, not a hover
- [ ] Researcher per-class Engagement tab renders heatmap + distributions
- [ ] Consent gating: declined-consent per-turn rows have null composition + null re-ask; session-level aggregates written
- [ ] `aiplatform logs` surfaces the new columns
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green
- [ ] Pytest covers re-ask scoring, session-aggregate write, consent gating
- [ ] Vitest covers paste / revision / keystroke counting edge cases

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Teacher reads per-student signals as sanction despite framing | Medium | On-UI framing copy ("not the student"), researcher-view emphasises cohort, M / JB / AR review pilot session reports together to calibrate use |
| Students feel surveilled if they learn about it | Medium | Disclosed in the consent prompt wording (1.1.3) — "we track how the session went so we can improve the lessons" — no concealment |
| Paste detection false positives on IME composition (Danish ø / å typed via dead keys) | Medium | Test specifically for `compositionstart` / `compositionend` events; treat IME commits as keystrokes, not paste |
| Re-ask cosine threshold tuned wrong → many false positives | Medium | Ship at 0.75, validate against first pilot week's data, expose per-skill override |
| BQ row size grows (5 new columns × all turns) | Low | Per-turn payload <50 bytes added; well within table column budget |
| Cohort medians are noisy with <10 students | Low | Hide deltas when n<5 students per class for that problem; show absolute only |
| Drives a "teacher rewrites the problem because signals say to" feedback loop that overfits to signals | Medium | Researcher dashboard shows *why* (heatmap is per-problem-per-signal, not a single composite score); M / JB / AR jointly review what an actionable rewrite looks like in first pilot review |

## Open questions

1. **Framing copy wording (gating).** "How to read this" block — JB / AR final copy. Danish + English.
2. **Consent gating granularity.** Per-turn columns null vs whole row suppressed. Recommend per-turn (session-level aggregates stay). JB confirm.
3. **Re-ask threshold.** 0.75 is a guess. Validate against first pilot week's data; expose per-skill override in SKILL.md.
4. **Per-student view default-collapsed?** Reasonable to default-expand the cohort comparison and default-collapse the per-student signals, so the teacher reaches for them only when investigating a specific case. JB / AR validate after first sight.
5. **What's the next batch?** time-to-first-character, total composition time, return visits, confusion-marker keyword classifier — pick 2-3 for v1.2 based on what the pilot actually exposes. Don't ship all at once; the v1 set is already 5 signals to interpret.
6. **Counterfactual: would teachers prefer a single composite "engagement score"?** Probably not — composite scores look authoritative and bury the actionable detail (which problem, which signal). Recommend NO composite for v1; revisit if asked.

## Files

| File | Purpose | LOC est. |
|---|---|---|
| `frontend/src/hooks/useCompositionSignals.ts` | New — wraps the chat textarea, returns per-turn signals | ~120 |
| `frontend/src/hooks/__tests__/useCompositionSignals.test.ts` | New — paste / revision / IME / voice cases | ~150 |
| `frontend/src/components/chat/MessageComposer.tsx` (or wherever) | Wire the hook; attach signals to AG-UI message payload | +30 |
| `frontend/src/components/teacher/SessionReport.tsx` | Add Engagement Signals block + framing copy | +60 |
| `frontend/src/components/teacher/__tests__/SessionReport.test.tsx` | New | +50 |
| `frontend/src/components/researcher/EngagementTab.tsx` | New researcher cohort view | ~200 |
| `frontend/src/components/researcher/__tests__/EngagementTab.test.tsx` | New | ~100 |
| `backend/protocols/agui.py` | Accept new composition fields in user-message payload | +15 |
| `backend/observability/chat_log_sink.py` | Compute re-ask score; write new BQ columns | +50 |
| `backend/observability/session_aggregates.py` | New — `turns_to_completion`, `abandonment_point` writers on session close | ~80 |
| `backend/db/models/session.py` | Add `turns_to_completion`, `abandonment_point` fields | +5 |
| `backend/db/models/skill.py` | Add `engagement_signals.re_ask_threshold` override | +10 |
| Terraform (BQ) | Add columns to `chat_turns`; reuse existing table | +20 |
| `backend/tests/observability/test_engagement_signals.py` | New | ~150 |

## Out of scope

- Composite "engagement score" — buries actionable detail; reject by default
- Real-time alerting ("student is struggling RIGHT NOW") — wrong surface; this is post-session signal
- Keystroke-stream logging — only counts are sent; keystream itself never leaves the browser
- Per-student trend lines across sessions — year-2 memory work
- Comparing classes against other classes (ranking) — anti-pedagogical for a research pilot
- A/B testing of problem prompts based on signals — manual researcher process for now.
  **Update 2026-07-31: the platform half now exists.** Two builds can serve
  side by side (tagged Cloud Run revision URLs per class), and every chat turn
  and workbench event records `revision` so BigQuery can segment by arm — see
  [deploy.md § Running two versions at once](../../../ops/runbooks/deploy.md#running-two-versions-at-once-ab-for-research).
  What stays manual is the research design: choosing arms, assigning classes,
  and interpreting. Note the telemetry is NOT retroactive.
- Multi-language re-ask (Danish ↔ English semantic comparison) — same-language only in v1
- Voice-turn composition signal (duration, pause count) — different axis; future doc

## Related

- [exit-ticket.md](exit-ticket.md) (1.1.8) — student-reported signal at session end; complements behavioural signal in this doc
- [session-report-summary-primary.md](session-report-summary-primary.md) (1.1.4) — host surface for per-student view
- [researcher-role.md](researcher-role.md) (1.1.5) — host surface for cohort view
- [student-consent-prompt.md](student-consent-prompt.md) (1.1.3) — gates the write
- [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (1.2 shipped) — BQ table extended here
- [post-pilot/session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) — rubric framework (R1) may use these signals as one input; this doc doesn't pre-commit a rubric coupling
- ADR-001 (scoping site `architecture.qmd`) — anonymous-group auth posture; informs the "no individual identification" framing
