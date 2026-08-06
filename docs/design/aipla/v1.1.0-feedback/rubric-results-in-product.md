# Rubric results in-product — MAPS/SAAR reach the session report and a researcher view

**Status:** Design (OPEN) — **P1.** Written 2026-08-06 from Aswin's 2026-08-06 trial feedback.
**Priority:** **P1** — the scoring engine shipped a month ago (RUBRIC-1, 2026-07-11) and the researcher who asked for it cannot see its output from inside the app. This is a last-mile problem, not a build.
**Estimated:** ~2d (M1 score-on-session-end ~0.5d · M2 teacher-facing band in the session report ~0.5d · M3 researcher construct detail ~0.75d · M4 gating + tests ~0.25d)
**Scope:** Backend — trigger `session_rubric` scoring at session end and attach results to `SessionSummary`. Frontend — a plain-language band in the existing session report + a researcher-only construct breakdown. No change to the scoring engine or the rubric schema.
**Dependencies:** RUBRIC-1 (**SHIPPED 2026-07-11** — [`analytics/session_rubric.py`](../../../../backend/analytics/session_rubric.py), MAPS/SAAR judges, anchor packs, provenance-stamped `RubricResult`); RUBRIC-2 (**SHIPPED** — [`analytics/rubric_runs.py`](../../../../backend/analytics/rubric_runs.py) run store, versioning, group-code addressing, backfill); [1.1.57 competency-rubrics](competency-rubrics.md) (the design of record — **and its R1 gate, which this doc honours**); [1.1.5 researcher-role](researcher-role.md) (the `role:researcher` claim M3 gates on); [1.1.4 session-report-summary-primary](session-report-summary-primary.md) (the `narrative` field this sits beside)
**Source:** Aswin, 2026-08-06 — *"I have been acting as a student and then turned into researcher role to evaluate MAPS and SAAR. The evaluation does not come up."* Follow-up: *"For the teachers, I think it should be enough with the description of those skills in the report. However, for researcher, detail of each construct and scores would be great."* M's reply: *"it should help shape the 'session summary report' text — what would be the best way to surface it for you?"* — **Aswin answered that question**, and this doc is his answer.
**Created:** 2026-08-06 (M)
**Last Updated:** 2026-08-06 (M)

## Problem Statement

**The rubric layer is complete except for the part a human touches.**

What shipped:

| Piece | Where |
|---|---|
| Registry + MAPS/SAAR judges + evidence partition + anchor packs | `analytics/session_rubric.py` |
| Free-form rubrics, versioning, promote-to-live, run store, BQ mirror | `analytics/rubric_runs.py`, `analytics/rubric_evidence.py` |
| HTTP: score, list/get/put rubrics, promote, backfill, list runs | `POST /api/research/rubric-score`, `GET /api/research/rubric-runs`, … ([research_lens_routes.py](../../../../backend/protocols/research_lens_routes.py)) |
| CLI | `aiplatform rubric score` / `anchors` |
| Researcher **config** UI | [`_LensConfigPanel.tsx`](../../../../frontend/src/app/teacher/settings/_LensConfigPanel.tsx) |

What did not:

1. **Nothing ever calls the scorer on its own.** `POST /api/research/rubric-score`
   is a manual trigger. Finish a session as a student, switch to researcher, and
   there is nothing to look at because nothing scored anything.
2. **No results surface exists.** The only rubric UI is the *config* panel —
   which rubric is live, not what it found. `grep -rn "rubric" frontend/src --include="*.tsx"`
   returns the config panel, the guides page, and a model selector. No results view.
3. **`SessionSummary` has no rubric field.** [`reports/session_summary.py`](../../../../backend/reports/session_summary.py)
   carries `narrative`, `voice_transcript`, `workbench_events` — no rubric. So
   even a scored session could not reach the report M suggested it should shape.

The gap is exactly one layer wide: **trigger + display**. Aswin's experience —
"the evaluation does not come up" — is literally correct. There is nowhere for
it to come up.

### Why the split matters

Aswin's follow-up draws the line himself, and it maps onto the existing R1 gate
in [1.1.57](competency-rubrics.md):

> *"For the teachers, I think it should be enough with the description of those skills in the report. However, for researcher, detail of each construct and scores would be great."*

That is the same split [1.1.57](competency-rubrics.md) already committed to —
offline/enrichment slices un-gated, **anything surfaced in the teacher UI in
rubric vocabulary stays R1-gated** pending JB/AR framework sign-off. This doc
does not re-open that decision; it implements both sides of it:

- **Teacher:** plain-language description of what the student did well and where
  they struggled. **No construct names, no numeric scores, no "MAPS"/"SAAR".**
- **Researcher:** the full `RubricResult` — per-construct scores, evidence
  spans, rubric id + version, model provenance.

## Goals

**Primary:** A finished session is scored automatically, and its results are
visible in-product — plain language for teachers, full construct detail for
researchers.

**Success metrics:**

- A session that ends produces a `RubricResult` in the run store with no manual step.
- A researcher opening a session report sees per-construct scores with evidence.
- A teacher sees a competency description with **zero** rubric jargon.
- Rubric id + version + model are visible on every displayed result — a score
  whose provenance is unknown is not usable as research data.
- Scoring failure never breaks the session report.

**Non-goals:**

- Changing the rubric schema, judges, anchor packs or evidence partition.
- Cross-session or longitudinal aggregation (that is [2.9 knowledge-graph](../post-pilot/knowledge-graph-and-student-matching.md) and [1.1.68](longitudinal-concept-evidence.md)).
- Live/in-session scoring. End-of-session only.
- Lifting the R1 gate on teacher-facing rubric vocabulary.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Scoring is async post-session; the report never blocks on it and renders a "scoring…" state. |
| 2 | EARNED TRUST | +1 | Every displayed score carries rubric id, version, model and **evidence spans** — an LLM judgement is shown as a judgement with its working, never as a fact. |
| 3 | SKILLS, NOT FEATURES | 0 | Analytics layer. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | One judge call per session at end, not per turn. Reuses the shipped judge config rather than adding a model path. |
| 5 | GRACEFUL DEGRADATION | +1 | Scoring failure → report renders exactly as today, with a quiet "not scored" note. The rubric is strictly additive to a report that already works. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Reuses `RubricResult` + the shipped `/api/research/*` contract; adds no second result shape. |
| 7 | API FIRST | +1 | The researcher view consumes the same endpoints the CLI does — no bespoke view-model endpoint. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Every run lands in the run store + BQ mirror with provenance; "was this scored, by what, when?" is answerable. |
| 9 | SECURE BY CONSTRUCTION | +1 | Construct detail is gated on the `role:researcher` claim **server-side**; the teacher payload is composed without construct data rather than hidden client-side. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Role-appropriate payload composed server-side; the client renders what it is given. |
| 11 | USABLE BY DESIGN | +1 | The researcher's own stated shape, answering M's own question back to him. |
| | **Net Score** | **+8** | Threshold: >= +4 |

## Framework-Native Capability Check

- **No new store.** `rubric_runs` already persists results with provenance and
  mirrors to BigQuery. The report reads from it; it does not cache its own copy.
- **No new scoring path.** `session_rubric.score_session` is called as-is.
- **No new role mechanism.** `role:researcher` (ADR-016) already gates
  `/api/research/*`; the report route reuses the shipped dependency.
- **The narrative precedent is exact.** `SessionSummary.narrative` is *"attached by
  `reports.narrative.resolve_narrative` at the route layer"* — attach-at-route,
  `None` until generated. The rubric field copies that pattern verbatim rather
  than inventing a second attachment style.

## Design

### Overview

```
session ends
  └─> score_session()  (async, best-effort)
        └─> record_rubric_run()   [shipped store + BQ mirror]
              └─> GET /api/reports/sessions/{id}
                    ├─ teacher payload    -> competencyNotes: plain language
                    └─ researcher payload -> rubric: full RubricResult
```

### M1 — Score on session end

A best-effort hook where the session-end signal already lands, mirroring
`resolve_narrative`. Three rules:

- **Idempotent** — `_run_id(session_id, rubric_id, version)` is already the run
  store's key, so a re-fire overwrites rather than duplicating.
- **Non-blocking** — never on the request path that ends a session.
- **Silent on failure** — logged, never surfaced as a session error. A judge
  outage must not make a student's session look broken.

Scoring uses the **promoted live rubric** (RUBRIC-2's promote-to-live), not a
hardcoded MAPS/SAAR pair. When no rubric is promoted, scoring is skipped — a
deliberate no-op, not an error.

### M2 — Teacher-facing band

`SessionSummary` gains one field, beside `narrative`:

```python
competency_notes: str | None = Field(default=None, alias="competencyNotes")
"""1.1.65 — plain-language competency description derived from the session's
rubric run. Deliberately carries NO construct names, numeric scores or rubric
vocabulary: that stays R1-gated (1.1.57). None until scored."""
```

Rendered in the existing report beneath the narrative:

```
Kompetencer i denne session
The group worked systematically through the measurement, checking units as they
went. They were quicker to reach for the formula than to sketch the situation —
worth prompting for a diagram next time.
```

**What must not appear:** "MAPS", "SAAR", "construct", any 1–5 number, any
per-construct label. This is the R1 gate, implemented as a **server-side
composition** rule, not a client-side hide. The teacher payload never contains
construct data, so it cannot leak through a devtools panel or a screenshot.

`competency_notes` is generated by a short summarisation over the `RubricResult`
— the same "structured data → prose" step `resolve_narrative` performs.

### M3 — Researcher construct detail

Gated on `role:researcher`, the report route attaches the full result:

```
MAPS v2.1 · gemini-2.5-pro · scored 2026-08-14 10:32 · run maps-2.1-a4f9c

Physical approach          4/5   "we need the vertical component first, so…"
Mathematical execution     3/5   "so t = 1.8… wait, that's not right"
Reflection                 2/5   (no evidence found)

SAAR v1.0 · same run
Question generation        3/5   "does the angle change how long it's in the air?"
...
```

Every construct row shows **score + the evidence span that justified it**, from
the shipped evidence partition. A score with no evidence renders as
`(no evidence found)` rather than being hidden — absence of evidence is itself a
finding, and hiding it would misrepresent coverage.

Placement: a collapsible section on the existing session report, visible only to
researchers, plus a `/teacher/research/sessions/{id}` deep link for the
comparison work Aswin was actually attempting.

### API Changes

No new endpoints. `GET /api/reports/sessions/{session_id}` becomes
**role-sensitive**: it already resolves the caller; it now composes a different
payload for `role:researcher`.

> **Dual-auth.** This is a dual-audience endpoint. It must be reachable by both
> a teacher (Firebase token, `fetchWithTeacherAuth`) and a researcher (also
> Firebase, with the extra claim). It is **not** student-facing. Guard on the
> claim via the shipped `assert_teacher` + researcher dependency — never on
> `User.email`, which is `""` for group students (memory
> `feedback-anonymous-users-are-corner-case`). The frontend calls must use the
> teacher helper; the eslint `no-restricted-imports` fence over
> `components/teacher` and `app/teacher` enforces it.

### CLI Surface

- `aiplatform rubric show <session-id>` — print the stored run for a session
  (today `score` computes but there is no read-back command)
- `aiplatform rubric score --group <code> --latest` — score the group's most
  recent session, using the `find_latest_session_id_for_group_bq` helper that
  already exists. This is the command that would have unblocked Aswin on the day.

~0.2d, and it makes M1 testable without waiting for a real session to end.

## Implementation Plan

### M1 — Score on session end (~0.5d)
- Best-effort hook beside the narrative path; idempotent, non-blocking, silent-on-failure
- Uses the promoted live rubric; skip when none promoted
- `aiplatform rubric show` + `--latest`

### M2 — Teacher band (~0.5d)
- `competency_notes` on `SessionSummary`, attached at route
- Prose generation from `RubricResult`
- Report section; **jargon-exclusion test**

### M3 — Researcher detail (~0.75d)
- Role-sensitive payload composition
- Construct table with evidence spans + provenance line
- `/teacher/research/sessions/{id}` deep link

### M4 — Gating + tests (~0.25d)
- Server-side composition test: teacher payload contains no construct data
- Dual-auth test (`test_dual_auth_rejection` sibling)
- Degradation test: unscored session renders the report unchanged

## Migration & Rollout

Additive fields, no schema migration. Existing sessions are unscored until
RUBRIC-2's **shipped backfill** (`POST /api/research/rubric-backfill`) runs over
them — so the retroactive path already exists and needs no new work here.

Behind `AIPLA_RUBRIC_AUTOSCORE` (default off in prod until the judge's per-session
cost is measured on real pilot traffic — one judge call per session across a
class is a real number, and the [cost-dashboard](cost-dashboard.md) is where it
should show up).

## Testing Strategy

### Backend (pytest)
- `test_rubric_autoscore.py` — fires once on session end; idempotent on re-fire;
  judge exception → report still renders; no promoted rubric → clean skip
- **`test_teacher_payload_has_no_rubric_vocabulary.py`** — the R1 gate as a test:
  assert the teacher payload contains no construct names, no numeric scores, and
  none of the strings `MAPS` / `SAAR` / `construct`. *This is the test that keeps
  the gate honest as the prose generator changes.*
- Researcher payload contains constructs + evidence + provenance
- Dual-auth: student group JWT → 403; teacher → teacher payload; researcher → full

### Frontend (Vitest + RTL)
- Report renders `competencyNotes` when present, omits the section when null
- Construct table renders only with the researcher claim
- `(no evidence found)` renders rather than the row vanishing
- Provenance line always present when constructs are shown

### Manual
Aswin's exact path: run a session as a student, end it, switch to researcher,
open the report, see the constructs. That round-trip is the acceptance test.

## Security Considerations

The R1 gate is enforced by **server-side payload composition**, not client-side
conditional rendering — construct data must never be in a teacher's response
body. The researcher check reuses the shipped `role:researcher` dependency; do
not re-derive a second "is this a researcher?" predicate (the dual-auth footgun
that already cost this repo four bugs).

Evidence spans are **verbatim student utterances**. They are already stored in
the chat log and already exposed to teachers in the transcript view, so this
adds no new exposure — but it does put them in a new place, which is worth
naming in the consent wording ([1.1.3 student-consent-prompt](student-consent-prompt.md)).

## Success Criteria

- [ ] A finished session is scored with no manual step
- [ ] Researcher sees per-construct scores + evidence + rubric version + model
- [ ] Teacher sees plain-language notes with zero rubric vocabulary
- [ ] Teacher payload provably contains no construct data (test, not review)
- [ ] Scoring failure leaves the report intact
- [ ] Student group JWT gets 403
- [ ] `aiplatform rubric show <session-id>` reads back a stored run
- [ ] Unscored sessions render as before

## Open Questions

1. **Where exactly is "session end"?** Sessions may not end cleanly — a group
   closes the tab. Proposed: score on the same signal `resolve_narrative` uses,
   plus an idle sweep for sessions with no activity for N minutes. Needs a look
   at how the narrative path decides today.
2. **Which rubric when several are promoted?** RUBRIC-2 supports multiple
   free-form rubrics. Proposed: score against all promoted-live rubrics and
   store one run each; the researcher view tabs between them. `competencyNotes`
   composes from all of them.
3. **Cost.** One judge call per session per rubric. With two rubrics and a
   30-student class that is 60 calls per lesson. Measure before defaulting on in
   prod; this is why M1 is flagged.
4. **Should students ever see their own rubric result?** Aswin did not ask, and
   showing a 2/5 to a student is a pedagogical decision, not a technical one.
   **JB/AR call, explicitly out of scope here.**

## Related Documents

- [competency-rubrics.md](competency-rubrics.md) — 1.1.57, the design of record + the R1 gate
- [session-report-summary-primary.md](session-report-summary-primary.md) — 1.1.4, the report this extends
- [researcher-role.md](researcher-role.md) — 1.1.5 / ADR-016, the gate
- [teacher-analytics-framework.md](teacher-analytics-framework.md) — 1.1.31, the same gated split
- [cost-dashboard.md](cost-dashboard.md) — 1.1.9, where autoscore cost should appear
- [docs/notes-2026-08-03.md](../../../notes-2026-08-03.md) — Aswin's raw feedback
