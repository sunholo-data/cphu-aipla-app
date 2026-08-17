# End-of-session exit ticket

> ## SUPERSEDED 2026-08-17 by [question-set-element.md](question-set-element.md) (1.1.78)
>
> **Do not build from this doc.** The exit ticket is no longer its own modal,
> endpoint, session fields, and BigQuery table — it is the **`questionSet`
> element at `placement: "session_end"`**, sharing one question schema with the
> teacher-authorable workspace element. 1.1.78 M3 is this doc's delivery.
>
> **Why it was superseded rather than built:** this doc waited 2.5 months on a
> question set, and so never built the *widget* — which the question set does not
> gate. Three other designs (1.1.19 M2 quiz, 1.1.57 M3 four-format quiz, and this)
> were each blocked on their own content decision while all three were missing the
> same substrate. 1.1.78 separates mechanism from content and ships the mechanism.
>
> **What survives intact, and is preserved verbatim in 1.1.78:** the two triggers
> (teacher ends session / student clicks Done); tab-close explicitly out of scope;
> the three distinct states `never answered` / `skipped` / `submitted`; skip always
> allowed; named radio buttons, no emoji (`feedback-no-emoticons`); the per-skill
> `SKILL.md` default question block; consent gating of `responses`; the ~4-question
> bound. **The gate is unchanged and still Aswin's** — it now gates *what the
> platform asks*, not *whether the platform can ask*.
>
> **What is dropped as redundant:** `POST /api/sessions/{id}/exit-ticket` (becomes
> the shared questions write), the `exit_ticket_*` session-doc fields (become rows
> in `question_responses`), and the bespoke `exit_tickets` BQ table + Terraform
> (becomes one `emit_question_response` on the existing sink).
>
> Read below for the question design, the UX reasoning, and the risk analysis —
> all still current. Read 1.1.78 for what gets built.

**Status:** **SUPERSEDED** by [question-set-element.md](question-set-element.md) (2026-08-17). Was: Planned (P1), blocked on the question set.
**Last Updated:** 2026-08-17 (superseded; body below unchanged from 2026-06-03)
**Priority:** P1 — structured self-assessment + research data capture at session end
**Estimated:** ~1d
**Scope:** Frontend (modal at session-end); backend (Firestore + BQ persistence); teacher / researcher visibility
**Dependencies:** [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (1.2 shipped — BQ schema additions land here); JB/AR providing the question set + Danish/English translations
**Source brief:** [`june-03-feedback-sprint-brief.md` §8](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md)

> **29 June (M) — parked, with new input for when it's revisited.** Decision: **park until Aswin delivers** — no roadmap move; this row stays *blocked*. Two changes to fold in when it's unparked: (1) the gating **question set owner is now Aswin (over summer)**, not JB/AR; (2) the framing gains an **affective** axis ("do students *feel* they're learning more / that it's more accessible") and a **longitudinal** axis — repeated before/after measurements *across the year*, explicitly **fatigue-aware** (many questions over a year risks response fatigue), beyond today's per-session one-shot. The longitudinal axis is a real design expansion (cross-session question scheduling) to scope when Aswin's set lands. Source: [june-29-feedback.md](june-29-feedback.md).

## Problem

Sessions today end implicitly — student closes the tab, teacher revokes the code, or TTL fires. No structured signal is captured about how the student *felt* about the session. JB and AR have asked for a lightweight self-assessment + research-question capture to inform both the rubric framework decision (R1) and pilot iteration.

## Design

### Trigger

Two trigger points:

1. **Teacher closes the session** — teacher UI action ends the session; student sees the modal as the very next frame
2. **Student explicitly ends** — student clicks a `Done` button (new — small addition in the chat header) → confirmation → modal

**Out of scope as trigger:** tab close. Reliable beacon-style capture on `beforeunload` is unreliable across browsers; not worth the complexity for an optional ticket. Students who close the tab simply don't see the ticket; the session is marked `closed_via=abandonment` for researcher signal.

### UX

Modal — focus-trapped, single screen, scrollable on mobile:

```
┌────────────────────────────────────────────────────────┐
│  Session complete!                                     │
│                                                        │
│  How confident do you feel about                       │
│  [activity topic — e.g. "projectile motion"] now?      │
│                                                        │
│  ( ) Not at all  ( ) A little  ( ) Confident  ( ) Very │
│      confused                                          │
│                                                        │
│  ─────────────────────────────────────────────────────│
│                                                        │
│  What was most confusing?  (optional)                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │                                                  │  │
│  │                                                  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  [ Submit ]   [ Skip ]                                 │
└────────────────────────────────────────────────────────┘
```

**Wording note:** brief uses emoji rating (😕 😐 🙂 😄). Per [feedback-no-emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md), the v1.1 build replaces emoji with named radio buttons / lucide icons. The semantics survive; the UI register stays academic-research-adjacent.

**Behaviour:**
- Skip is always allowed — no forced response
- Submit posts the response; Skip records a "skipped" event
- Cannot reopen after submit — one-shot per session
- Up to **4 questions** total (brief leaves room for JB/AR to add 1-2 more — *"Did you feel the AI helped you think, or did it think for you?"* is the brief's example)

### Question set (placeholder — JB/AR to finalise)

The questions are configurable per skill via skill frontmatter:

```yaml
# In SKILL.md frontmatter
exit_ticket:
  enabled: true            # default false
  questions:
    - id: "confidence"
      type: "rating_4"
      text_da: "Hvor sikker føler du dig på {topic} nu?"
      text_en: "How confident do you feel about {topic} now?"
      labels: ["Slet ikke", "Lidt", "Sikker", "Meget sikker"]
    - id: "confusion"
      type: "free_text"
      text_da: "Hvad var mest forvirrende?"
      text_en: "What was most confusing?"
      required: false
    # JB / AR may add 1-2 more
```

**Why per-skill not platform-wide:** different skills probe different things (a procedural lab has different signal than a conceptual dialogue); JB/AR can iterate per activity. Sensible platform-default question set ships for skills that don't customise.

`{topic}` resolved from the skill's existing topic field at render time.

### Backend persistence

**Firestore** — appended to session doc:

```python
class Session(BaseModel):
    # ... existing fields ...
    exit_ticket_responses: dict[str, str | int | None] | None = None
    exit_ticket_submitted_at: datetime | None = None
    exit_ticket_skipped: bool = False
```

**BigQuery** — new table `exit_tickets` (one row per ticket; not appended to `chat_turns`):

```
exit_tickets schema:
  session_id          STRING
  group_id            STRING
  class_id            STRING
  skill_id            STRING
  submitted_at        TIMESTAMP
  skipped             BOOL
  responses           JSON   -- { question_id → value }
  consent_granted     BOOL   -- denormalised from session for analytics convenience
```

Gated on consent ([student-consent-prompt.md](student-consent-prompt.md)): declined-consent sessions write `responses: null` but DO write the `skipped` / `submitted_at` columns (the metadata is itself research signal at the institutional-reporting level). JB to confirm — if not acceptable, gate the whole row.

### New endpoint

`POST /api/sessions/{session_id}/exit-ticket`

```
body: {
  responses: { [question_id]: <rating int> | <free_text str> | null },
  skipped: bool
}
204 No Content — recorded
409 Conflict — already submitted (idempotent block)
```

Auth: same group-token gate as the chat path.

### Teacher / researcher visibility

| Surface | Display |
|---|---|
| Teacher session report ([session-report-summary-primary.md](session-report-summary-primary.md)) | Exit-ticket section: the rating + any free-text answers; "Skipped" badge if not filled |
| Researcher dashboard (post [researcher-role.md](researcher-role.md)) | Aggregate: % submitted, rating distribution per class / skill; free-text feed (filterable) |
| BigQuery | `exit_tickets` table queryable by `aiplatform logs` |

## Acceptance

- [ ] **JB/AR have provided the v1.1 question set with Danish + English text + labels** — gating
- [ ] Teacher's "End session" action in teacher UI surfaces the modal on the student side
- [ ] Student clicks `Done` in chat → confirmation → modal
- [ ] Modal is focus-trapped, mobile-scrollable, no emoji
- [ ] Submit POSTs the responses; second POST returns 409
- [ ] Skip records a skipped event with no `responses`
- [ ] Tab-close before submit: session doc has `exit_ticket_responses: null`, `exit_ticket_skipped: false`; teacher report shows "No ticket submitted" (distinct from "Skipped")
- [ ] BigQuery `exit_tickets` table populated correctly; consent gating respected per JB's choice (above)
- [ ] Teacher session report shows the responses; researcher view aggregates
- [ ] Per-skill `exit_ticket.enabled: false` → modal does not appear
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green
- [ ] Pytest covers: submit happy path, skip path, idempotency, consent gating
- [ ] Vitest covers: modal renders, focus trap, submit/skip POST shape

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Students skip every ticket | Medium | Acceptable for v1.1 — even the skip rate is research signal. Iterate question wording with AR after first pilot week |
| Modal interrupts a productive session (teacher closes too early) | Medium | Confirmation step on the teacher-end action; per-class teacher-disable in v1.1 follow-up if requested |
| Question set drifts per skill, hard to compare across classes | Medium | Platform-default set as baseline; per-skill overrides documented; researcher dashboard can filter by question set version |
| Tab-close-before-submit confused with "skipped" | Medium | Explicit distinct states: `null`, `skipped`, `submitted` — surfaced separately in teacher report |
| Free-text contains PII / sensitive info | Medium | Free-text is gated by consent (same path as chat turns); pilot copy explicitly says "don't share personal info"; revisit if observed |
| Teacher-end action without confirmation accidentally fires | Low | Confirmation dialog on the teacher side before the session-close action |

## Open questions

1. **Final question set (gating).** JB/AR pick: confidence rating + 1-3 more questions per skill. Brief's example: *"Did you feel the AI helped you think, or did it think for you?"*
2. **Consent gating granularity** — full row suppressed for declined-consent sessions, or just the responses? Recommend: just the responses (metadata = research signal). JB to confirm.
3. **Display ordering on the teacher session report** — at the top (above summary) or bottom (after transcript toggle)? Recommend: bottom-of-summary-block — exit ticket is a *self-report* signal, complements the summary. JB / AR to validate after first sight.
4. **Per-class teacher disable** — some teachers may prefer no ticket. v1.1: per-skill enable only; per-class override is a follow-up if asked.

## Files

| File | Purpose | LOC est. |
|---|---|---|
| `frontend/src/components/chat/ExitTicketModal.tsx` | New modal | ~150 |
| `frontend/src/components/chat/__tests__/ExitTicketModal.test.tsx` | New | ~100 |
| `frontend/src/components/chat/ChatHeader.tsx` (or wherever) | Add `Done` button → confirmation → modal | +40 |
| `frontend/src/hooks/useSessionEnd.ts` | New hook coordinating end → modal → POST | ~60 |
| `backend/protocols/session_routes.py` | New `POST /api/sessions/{id}/exit-ticket` endpoint | +60 |
| `backend/db/models/session.py` | Add fields | +5 |
| `backend/db/models/skill.py` | Add `exit_ticket` block | +20 |
| `backend/skills/skill_processor.py` | Parse `exit_ticket` block from frontmatter | +20 |
| `backend/observability/exit_ticket_sink.py` (new) | Write `exit_tickets` BQ rows; respect consent | ~50 |
| Terraform (BQ) | New `exit_tickets` table | +30 |
| `backend/tests/api_tests/test_exit_ticket.py` | New | ~150 |

## Out of scope

- Adaptive question selection (different questions based on session behaviour) — year-2
- Cross-session comparison ("compared to last session, you said you felt less confident") — year-2 memory work
- Researcher A/B testing of question wording — manual researcher process for now
- Per-class teacher-disable toggle (year-2 follow-up if asked)
- Multi-language beyond DA + EN

## Related

- [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) — same OTel + BQ infrastructure
- [student-consent-prompt.md](student-consent-prompt.md) — gates the `responses` field per JB decision
- [session-report-summary-primary.md](session-report-summary-primary.md) — surface for the rating + free-text in the teacher report
- [post-pilot/session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) — exit-ticket data is one input the rubric framework (R1) may use; this doc doesn't pre-commit a rubric coupling
- [researcher-role.md](researcher-role.md) — aggregate cross-class view of ticket responses
