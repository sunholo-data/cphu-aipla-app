# Student in-session consent prompt for chat logging

**Status:** Planned (P1); **blocked on JB sign-off on consent wording**
**Last Updated:** 2026-06-03
**Priority:** P1 — students at the 3 June check-in said they did not want their conversations logged. Keeps anonymous-group auth (no change to ADR-001); adds an opt-in once at session start
**Estimated:** ~0.5d frontend + ~0.5d backend
**Scope:** Frontend (modal/banner before first tutor message); backend (session-doc field + BigQuery write gating); teacher report (badge)
**Dependencies:** None engineering-side. **Gated on JB sign-off** on the consent prompt wording (same institutional-approval gate as [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md))
**Source brief:** [`june-03-feedback-sprint-brief.md` §3](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md)

## Problem

Students at the 3 June teacher check-in flagged that they didn't want their chat conversations logged. The current architecture logs every chat turn to BigQuery via the [chat-log-pipeline](../v1.0.0-pilot/implemented/chat-log-pipeline.md) for teacher reports + research analysis. ADR-001 anonymity (group-ID auth, no PII) is the right *posture* but students don't have the lived experience that their *content* is also being captured for research.

The pilot cannot ship without addressing this. Anonymity ≠ unconditional consent to record conversation content.

## Design

### Architecture choice

ADR-001 anonymous-group auth stays unchanged. Auth and consent are different concerns:
- **Auth** = "the platform knows this is `class:abc:def`, no personal identity beyond that"
- **Consent** = "the *research record* of this conversation may be retained / analysed"

A student can use the full platform without consenting to research recording.

### UX (placeholder — JB approves final wording)

Shown on the chat page **before** the first tutor message renders. Modal-style, blocks the chat until answered.

```
┌────────────────────────────────────────────────────────┐
│  Research consent                                      │
│                                                        │
│  This session may be recorded for educational research │
│  at the University of Copenhagen Center for Digital    │
│  Education. Your group code stays anonymous either way.│
│                                                        │
│  Recording means: the messages you and the tutor send  │
│  are saved so researchers can study how AI tutors are  │
│  used in physics class. No personal information is     │
│  collected. You can still use the full platform if you │
│  decline.                                              │
│                                                        │
│  [ Yes, I consent ]   [ No thanks ]                    │
└────────────────────────────────────────────────────────┘
```

**Behaviour rules:**
- Shown once per session — the answer persists with the session doc, not the group code (a teacher resetting the session re-prompts)
- No default selection — student must click one
- Decision is final for this session (no "change my mind" mid-session — adds privacy-state surface area for marginal value; revisit if pilot teachers ask)
- Esc / click-outside does NOT dismiss — must answer

### Backend wiring

**Firestore session doc** ([backend/db/models/session.py](../../../../backend/db/models/session.py)) gains:

```python
class Session(BaseModel):
    # ... existing fields ...
    research_consent: Literal["pending", "granted", "declined"] = "pending"
    research_consent_at: datetime | None = None
```

**Chat-log pipeline gating** ([backend/observability/](../../../../backend/observability/) — see [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md)): if `research_consent != "granted"`, **chat turn rows are NOT written to BigQuery**. The OTel span still emits (for token-cost and infrastructure observability) but the BigQuery sink filters before insert.

**Workbench-event rows (BQ table)** — open question for JB: are non-conversational events (sim runs, slider commits) considered conversational data for consent purposes? The brief says: *"workbench state events may still be written — UCPH legal/JB to confirm whether non-conversational events need consent."* Default: **yes, also gated on consent**, until JB says otherwise. Less data than the alternative is the right starting posture.

**New endpoint:** `POST /api/sessions/{session_id}/consent`

```
body: { decision: "granted" | "declined" }
204 No Content — session doc updated; subsequent chat turns and workbench events
                 are written or suppressed accordingly
409 Conflict — consent already set on this session (cannot be changed)
```

Auth: same group-token gate as the chat path.

### Frontend wiring

| Location | Change |
|---|---|
| `frontend/src/app/chat/[...path]/page.tsx` | On mount, read `session.research_consent`; if `"pending"`, render the consent modal *before* the chat UI; on click, POST to `/api/sessions/{id}/consent`, then render chat |
| `frontend/src/components/chat/ResearchConsentModal.tsx` | New component — modal + two buttons, focus-trapped, no escape |
| `frontend/src/hooks/useSession.ts` (or wherever session metadata lives) | Refetch session after consent POST so derived state (`consentGiven: bool`) flows |

### Teacher / researcher visibility

| Surface | Display |
|---|---|
| Teacher session report ([teacher-insights-dashboard.md](../v1.0.0-pilot/implemented/teacher-insights-dashboard.md)) | Badge `No research consent` on sessions where `research_consent = "declined"`; sessions still listed for teacher pedagogy purposes — the teacher's class-management need is not the research need |
| Researcher dashboard (post 1.1.5 [researcher-role.md](researcher-role.md)) | KPI: % coverage = `granted / (granted + declined + pending)`; per-class breakdown |
| BigQuery | Sessions with `declined` consent contribute **zero rows** to `chat_turns` and `workbench_events` tables; existence proven only by aggregate counters or per-session metadata table |

### Consent metadata table (small but separate)

A small BQ table `session_consent` records: `session_id`, `class_id`, `decision`, `decided_at`. Lets researchers compute coverage without inspecting `chat_turns`. Important even when `declined` — the *fact of declining* is research signal (institutional reporting on consent rates).

This table is allowed to record `declined` sessions because it stores only the *decision metadata*, not the conversation. JB to confirm this distinction.

## Acceptance

- [ ] **JB has signed off the final consent wording** (English + Danish translation supplied by JB) — gating
- [ ] Joining a brand-new session shows the consent modal before any tutor turn
- [ ] Clicking `Yes, I consent` → chat opens; subsequent turns appear in BigQuery `chat_turns`
- [ ] Clicking `No thanks` → chat opens; subsequent turns do NOT appear in `chat_turns` and workbench commits do NOT appear in `workbench_events`
- [ ] In both cases, the `session_consent` BQ table receives one row recording the decision
- [ ] Session resume (within 30d / 300d TTL per [1.1.6](implemented/group-code-school-year-ttl.md)) does NOT re-prompt — decision is sticky per session
- [ ] Teacher report displays `No research consent` badge on declined sessions
- [ ] `make lint` + `make test-fast` + `npm run quality:check` green
- [ ] One pytest: declined session's chat turn does not appear in `chat_turns`; granted session's does
- [ ] One vitest: ResearchConsentModal renders, blocks chat, posts on click

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Consent wording legally insufficient | Medium | JB sign-off is gating — explicit gate before any merge |
| Declined sessions still leak data via a missed code path | Medium | Single chokepoint at the BQ sink (one place to gate); pytest the negative case |
| Modal blocks UX too aggressively / students mis-tap | Low | One-time, clear copy, no time pressure; teachers can explain in class once before the first session |
| Students change their mind during a session | Low | Out of scope v1.1; if requested, add a per-session "withdraw consent" button in a follow-up — would need backend retroactive-delete (more work than a v1.1 fit) |
| Workbench events leak student behaviour even when consent declined | Medium (open question) | Gate workbench-event writes alongside chat-turn writes until JB explicitly allows them through |
| Per-class teacher choice (some teachers want consent-mandatory) | Out of scope | Default is per-student opt-in; per-class override is post-v1.1 |

## Open questions for JB

1. Final Danish + English wording of the consent prompt
2. Are workbench events (sim runs, slider commits) inside the consent scope or outside? **Default: inside.**
3. Does the `session_consent` metadata table (recording decision + timestamp) need its own consent? **Assumption: no, it's institutional reporting metadata. Confirm.**
4. Retention of `declined` rows in `session_consent` — what's the right TTL? **Suggested: matches the broader UCPH retention policy (probably 5 years per typical research-data retention), not the 30-day chat-log retention.**
5. Withdraw-consent path (mid-session or post-session) — is it required for the pilot or year-2? **Recommend: defer to year-2 — adds retroactive-delete machinery for low marginal value.**
6. Under-16 students — Danish law has parental-consent thresholds. The brief flags this in the audio-capture context; same question applies here. Pilot is upper secondary (gymnasium) which is mostly 16-19, but JB should confirm there are no 15-and-under students in the pilot cohort.

## Out of scope

- Per-class consent override by the teacher (post-v1.1)
- Audio recording consent — separate ([audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md))
- Retroactive consent withdrawal — needs delete-from-BQ machinery; defer
- Per-skill consent (different consents for different skills) — overcomplex; one consent per session is right
- Multi-language consent (only DA + EN at minimum)

## Files

| File | Purpose | LOC est. |
|---|---|---|
| `frontend/src/components/chat/ResearchConsentModal.tsx` | New modal | ~80 |
| `frontend/src/app/chat/[...path]/page.tsx` | Mount modal on pending consent | +20 |
| `frontend/src/components/chat/__tests__/ResearchConsentModal.test.tsx` | New | ~80 |
| `backend/db/models/session.py` | Add `research_consent`, `research_consent_at` | +5 |
| `backend/protocols/session_routes.py` (or equivalent) | New `POST /api/sessions/{id}/consent` endpoint | +60 |
| `backend/observability/chat_log_sink.py` (or wherever the BQ sink lives) | Gate writes on consent | +30 |
| `backend/tests/api_tests/test_consent.py` | New | ~120 |
| Terraform (BQ) | New `session_consent` table | +30 |

## Related

- ADR-001 (anonymous group auth — unchanged by this doc) — in the [scoping site](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd)
- ADR-005 (chat log storage) — in the [scoping site](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd)
- [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) — the BQ sink this doc gates
- [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) — sister consent flow; same JB approval gate pattern
- [researcher-role.md](researcher-role.md) — the surface that exposes coverage metrics
