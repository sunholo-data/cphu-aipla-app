# Live teacher dashboard — rolling 5-min class summary + incoming calls

**Status:** **R1-GATED.** Designed now; **do not instrument the summary content before the R1 framework decision** (ICAP+FCI vs CPS+DRA / the DRA-map sign-off, due before the 2026-06-29 freeze). The *shell* + the call-teacher surface + deterministic signals are **not** gated.
**Last Updated:** 2026-06-15
**Priority:** **P1 (post-R1).** Teachers want a rolling class-level summary *during* the lesson [M, 15 June] — "stressed" = emphasised, not "it stresses teachers". This is the live teacher dashboard, and the surface the [call-teacher](call-teacher.md) raised hand lands on.
**Estimated:** shell + raised-hand panel + deterministic signals ~1.5–2d (un-gated); the LLM summary layer ~1–2d **after R1** locks the rubric vocabulary.
**Scope:** Fullstack — a teacher live class view (`frontend/src/app/teacher/classes/[id]/...`) + a class-level live roll-up (`backend/analytics/`) + the existing class poll. Reuses 1.1.26 teacher primitives.
**Dependencies:** [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (1.2 — the BQ turn stream, shipped); [call-teacher.md](call-teacher.md) (1.1.29 — the raised-hand signal this surface hosts); [teacher-ui-consolidation.md](teacher-ui-consolidation.md) (1.1.26 — nav + primitives, shipped); [session-report-summary-primary.md](session-report-summary-primary.md) (1.1.4 — the `reports/narrative.py` summary generator this reuses); **R1 framework decision** (see *Gating*). ADR-001 (group-level only).
**Source brief:** [`notes/2026-06-15-teacher-feedback.md`](file:///Users/mark/Documents/clients/cph-uni/notes/2026-06-15-teacher-feedback.md) "Real-time class summary every ~5 min" + [june-15-feedback.md](june-15-feedback.md)

> **Live, not post-hoc — and that's the distinction from 2.5.** [session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md)
> (row 2.5) is the **post-session** analysis layer — it explicitly scopes *out* real-time
> ("the rubric runs after the session, not during"). This doc is the **in-lesson** surface: a
> rolling class-level summary the teacher reads *while teaching*, plus the incoming raised-hand calls.
> They share the rubric **vocabulary** (the R1 decision feeds both) but are different surfaces with
> different latency, cost, and privacy profiles. This doc does not re-litigate the framework — it
> consumes R1's outcome.

## What teachers asked for

A **rolling class-level feedback summary during the lesson** (~every 5 minutes): at a glance, *how
is the class doing right now* — engagement, where groups are in the activity, who's stuck — so the
teacher can intervene mid-lesson rather than reading reports after. Confirmed **wanted (push)**, not
a stressor [M, 15 June]. The same live surface is where a [call-teacher](call-teacher.md) raised hand
appears — one place for "what's happening in this class right now".

## Gating — what R1 blocks and what it doesn't

R1 is the JB/AR pedagogical decision: which rubric framework (ICAP+FCI vs the DRA-led CPS+DRA stack)
and, concretely, the DRA-map sign-off for the live signals. It is due **before the 2026-06-29
freeze** ([SEQUENCE](SEQUENCE.md) human-gate #9, [parent 2.5](../SEQUENCE.md)). Split the build so R1
only blocks the part that genuinely depends on it:

| Layer | R1-gated? | Why |
|---|---|---|
| **Live surface shell** (a "Live" tab/view on the class page; the poll wiring; layout) | **No** | Pure UI + transport; no pedagogical claim. |
| **Raised-hand panel** (from [call-teacher](call-teacher.md) 1.1.29) | **No** | Deterministic signal; ships with 1.1.29. |
| **Deterministic activity signals** (per group: active/idle, turns this lesson, last-activity time, "stuck" = no progress in N min, which problem/step) | **No** | Counted from session events; no rubric needed. Genuinely useful on its own. |
| **Rubric summary** (engagement mode mix / DRA coverage / concept signal phrased in the chosen framework's vocabulary) | **Yes** | This *is* the R1 framework output, live-cadenced. Do not instrument before R1. |
| **LLM narrative roll-up** ("3 of 6 groups are wrestling with energy conservation; group 7B stuck on step 2") | **Yes** | Phrasing + what-to-surface depends on the framework + DRA map. |

So the un-gated slice (shell + raised-hand + deterministic signals) can land alongside 1.1.29 and is
worth shipping; the LLM/rubric summary slots in after R1 as a config-shaped layer.

## Design

### Cadence — rolling ~5 min, debounced, cheap

- Deterministic signals refresh on the existing class poll (30s, or the 10s `/signals` poll from 1.1.29).
- The **summary** regenerates on a **~5-min rolling cadence per class** (not per poll) — debounced and only when there's new turn activity, so an idle class costs nothing. Reuses the on-demand-and-cached pattern from 1.1.4 (`reports/narrative.py` already caches a grounded Gemini-Flash narrative on `ChatSessionIndex`, regenerated when turn count grows). The live summary is the **class-level** analogue: one roll-up over the active groups, cached with a 5-min floor.
- Cost is bounded: one Flash call per class per 5 min while active (cf. 1.1.4's per-session narrative + the cost-dashboard 1.1.9 makes it visible).

### Surface

A **Live** view on the class-detail page (`frontend/src/app/teacher/classes/[id]/`), or a dedicated
`[id]/live` route, built on the 1.1.26 `components/teacher/ui/` primitives:

```
┌─ 7.B · Energibevarelse · live ─────────────────────────────┐
│  Calls            ← from call-teacher (1.1.29)             │
│   ✋ Group 7B-rød · 2 min ago        [Acknowledge]         │
│                                                            │
│  Class summary (updated 3 min ago)   ← R1-gated layer      │
│   Most groups are actively working; 2 of 5 are wrestling   │
│   with energy-vs-force. Group 7B-rød stuck on step 2.      │
│                                                            │
│  Groups            ← deterministic, un-gated               │
│   7B-rød   ● active   12 turns   step 2   (stuck 6 min)    │
│   7B-blå   ● active    8 turns   step 1                    │
│   7B-grøn  ○ idle      3 turns   step 1   (idle 9 min)     │
└────────────────────────────────────────────────────────────┘
```

Empty/loading/error states designed (Axiom 11): no active groups → "No groups online yet"; summary
generating → skeleton with last-updated time; summary failure → groups + calls still render (the
deterministic layer never depends on the LLM layer).

### Where it lives in the architecture

- **Compute:** a `backend/analytics/live_class_summary.py` — consumes the active groups' recent turns (from the chat-log / session events) → a typed `LiveClassSummary` (deterministic signals always; rubric/narrative fields populated only when R1's framework is wired). One Flash call per class per 5-min window, cached.
- **Trigger:** on-demand on view load + a 5-min debounce per class (mirror 1.1.4's regenerate-on-growth). No always-on background job for v1.
- **Read:** `GET /api/classes/{id}/live` (owner or researcher via `assert_can_read_class`) returns calls + deterministic signals + (post-R1) the summary.
- **Privacy:** group-level only (ADR-001). The summary names groups, never students. Consent (1.1.3) governs whether a group's turns feed the BQ-backed analysis; the live deterministic signals are activity-level (turn counts, idle time) and carry no content.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Deterministic signals + calls update on the poll; the summary is cached so the view is never blocked on a model call. |
| 2 | EARNED TRUST | +1 | Summary is **grounded** (reuses 1.1.4's workbench-grounded narrative discipline — "the group", no fabrication) and clearly marked AI-generated with a last-updated time; the deterministic layer is verifiable counts. |
| 3 | SKILLS, NOT FEATURES | 0 | A teacher surface over existing skills, not a new skill. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Deterministic signals use **zero tokens**; only the narrative roll-up uses Flash, debounced to 5-min — the right model only where reasoning is needed. |
| 5 | GRACEFUL DEGRADATION | +1 | LLM summary failure → calls + deterministic group signals still render. The pedagogical layer is strictly additive over the activity layer. |
| 6 | PROTOCOL OVER CUSTOM | +1 | REST + the existing poll; reuses the 1.1.4 narrative generator. No bespoke real-time protocol (SSE is a future enhancement, noted not invented). |
| 7 | API FIRST | +1 | `GET /api/classes/{id}/live` is the contract; CLI/researcher views can read the same. |
| 8 | OBSERVABLE BY DEFAULT | +1 | The summary's cost/latency join the 1.1.9 cost spans; "how often teachers open Live", "intervention-after-call latency" become measurable. |
| 9 | SECURE BY CONSTRUCTION | 0 | Group-level only; owner/researcher-gated reads; consent-gated content analysis. No new PII (ADR-001). Neutral. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Roll-up + caching backend; client renders panels. |
| 11 | USABLE BY DESIGN | +1 | Empty/loading/error states for each panel; the deterministic layer guarantees the view is useful even when the summary is generating or failed. |
| | **Net Score** | **+8** | Threshold: ≥ +4. SECURE 0; no student-facing −1. |

## Milestone phasing

| MS | Deliverable | Est | Gate | Lands |
|---|---|---|---|---|
| **M0** | **Live shell + raised-hand panel.** The Live view + `GET /api/classes/{id}/live` (calls + deterministic group signals: active/idle, turns, last-activity, "stuck" heuristic). | ~1.5d | none (co-builds with [call-teacher](call-teacher.md) 1.1.29) | un-gated |
| M1 | **LLM narrative roll-up.** Class-level Flash summary, 5-min debounced + cached (reuse 1.1.4 `reports/narrative.py` pattern), framed in the R1-chosen vocabulary. | ~1–2d | **R1 framework decision** | post-R1 / post-freeze |
| M2 | **Rubric signals layer.** Engagement-mode mix / DRA coverage surfaced live, consuming the same labelling the 2.5 rubric uses (shared vocabulary, live cadence). | ~1–2d | R1 + 2.5 labelling | post-R1 |
| M3 | **SSE push** (optional) — drop polling for true real-time if the pilot shows the poll lags. | ~1d | pilot signal | pilot-iteration |

## Acceptance

- [ ] (M0, un-gated) A teacher opens the **Live** view for an active class and sees, per group: active/idle, turns this lesson, where they are, and a "stuck" flag — plus any raised hands (1.1.29), updating on the poll.
- [ ] (M0) The deterministic layer renders with **no LLM dependency** — empty/loading/error states designed; no blank void.
- [ ] (M1, post-R1) A rolling **~5-min class summary** generates, cached, framed in the R1-chosen vocabulary; marked AI-generated with a last-updated time; failure degrades to the deterministic layer.
- [ ] No per-student data anywhere (ADR-001); reads owner/researcher-gated; content analysis consent-gated (1.1.3).
- [ ] **No rubric/summary instrumentation merged before R1 is locked.**

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Building the rubric layer before R1 (wasted/wrong work) | Medium | Hard split — M1/M2 are explicitly gated; M0 (shell + deterministic + calls) is the only pre-R1 build. |
| Live summary becomes a stressor despite the "push" framing | Medium | M's framing confirmed (wanted, not stressful); keep it glanceable, group-level, no per-student ranking. Review in first pilot lesson. |
| Cost of per-class 5-min Flash calls at cohort scale | Low | Debounced + cached + active-only; visible in the 1.1.9 cost dashboard; tune the cadence floor if needed. |
| Poll latency feels un-live | Low–Med | 10s `/signals` poll for calls; SSE deferred to M3 only if the pilot needs it. |

## Related documents

- [session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) — the **post-hoc** rubric layer (2.5) + the R1 framework comparison; this doc consumes R1's outcome, live-cadenced
- [call-teacher.md](call-teacher.md) — the raised-hand signal this surface hosts (1.1.29)
- [session-report-summary-primary.md](session-report-summary-primary.md) — the `reports/narrative.py` grounded-narrative generator the live summary reuses (1.1.4)
- [student-engagement-signals.md](student-engagement-signals.md) — post-session engagement signals; the live view is the in-lesson complement (1.1.17)
- [cost-dashboard.md](cost-dashboard.md) — where the summary's per-class LLM cost surfaces (1.1.9)
- [teacher-ui-consolidation.md](teacher-ui-consolidation.md) — the teacher primitives the Live view is built on (1.1.26)
- ADR-001 (group anonymity), ADR-016 (researcher tier) — scoping-site `architecture.qmd`
