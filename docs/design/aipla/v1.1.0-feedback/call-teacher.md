# Call teacher — student escalates to a human, mid-session

**Status:** Planned (P1, build-ready) — minimal raised-hand slice has **no human gate**
**Last Updated:** 2026-06-15
**Priority:** **P1** — genuinely new v1.1 ask, confirmed near-term [M, 15 June]. Small, demo-friendly, and the first concrete piece of the live teacher surface.
**Estimated:** **~1d** for the minimal raised-hand version (student button + group-scoped signal + teacher list). Full live-dashboard integration follows [teacher-analytics-framework.md](teacher-analytics-framework.md).
**Scope:** Fullstack — new student chat-composer control (`frontend/src/components/chat/`) + a group-scoped signal write (`backend/db/`) + a teacher-side "raised hand" surface on the existing class poll (`frontend/src/app/teacher/classes/`). No new protocol, no LLM call.
**Dependencies:** [teacher-ui-consolidation.md](teacher-ui-consolidation.md) (1.1.26 — teacher nav/primitives, shipped); the 30s class-recent-sessions poll (shipped — see *Transport*); ADR-001 (anonymous group IDs — the signal is **per-group**, never per-student); ADR-015 (unified multi-surface UI). Pairs with [teacher-analytics-framework.md](teacher-analytics-framework.md) (1.1.31) — the live dashboard hosts both the rolling summary and incoming calls.
**Source brief:** [`notes/2026-06-15-teacher-feedback.md`](file:///Users/mark/Documents/clients/cph-uni/notes/2026-06-15-teacher-feedback.md) "Genuinely new → Call teacher button" + [june-15-feedback.md](june-15-feedback.md) (repo map)

> **Phased so the button never blocks on the dashboard.** The minimal version (this doc, M0+M1)
> ships a **standalone raised-hand list** on the teacher class view. The full integration — the
> raised hand sitting alongside the rolling 5-min class summary on one live surface — folds into
> [teacher-analytics-framework.md](teacher-analytics-framework.md) (1.1.31, R1-gated). **Do not block
> the button on the full dashboard.**

## What teachers asked for

A student, mid-session, can **escalate to a human teacher** — tap a control when stuck or when they
want a person, not the tutor. The teacher, watching the class, sees the call land. It is a **signal,
not a message thread**: "group 7B raised their hand on *Energibevarelse*", not a chat channel. This
fits the classroom reality — the teacher is in the room; the button tells them *which group to walk
over to*.

## Design

### The signal is per-group (ADR-001)

Under anonymous group IDs, many students share one group code + one synthetic uid. A raised hand is
therefore a **property of the group's active session**, not of a student. The teacher sees *"group 7B
raised their hand"* — never an individual. This is the correct privacy posture and also the correct
*pedagogical* unit: the teacher walks to a table, not to a person.

### Data model — a group signal

The cheapest durable shape is a small per-group signal record. Today
[`backend/db/group_sessions.py`](../../../../backend/db/group_sessions.py) holds one
`group_sessions/{group_id}` doc (`session_id`, `created_at`, `expires_at`, `archived_at`); the
`chat_sessions` index ([`backend/db/models/chat_session.py`](../../../../backend/db/models/chat_session.py))
carries `group_code`, `last_message_at`, `turn_count`, `title`. Two viable homes (decide at M0):

- **(A) New `group_signals/{group_id}` collection** — `{ raised_hand_at, group_code, class_id, activity_id, activity_title, cleared_at, cleared_by }`. Clean separation; one tiny doc per group; trivially extensible to other live signals (e.g. "needs materials"). **Recommended.**
- **(B) Field on the active `chat_sessions` index doc** — `raised_hand_at: str | None`. Fewer reads, but overloads the session index with live-classroom state.

**Recommendation: (A).** The live dashboard (1.1.31) will want a per-group live-signals doc anyway;
standing it up here is the seam. Same 30-day TTL semantics as `group_sessions` (expiry = group-code
TTL per 1.1.6).

```python
# backend/db/models/group_signal.py (new)
class GroupSignal(BaseModel):
    group_id: str
    group_code: str
    class_id: str
    activity_id: str = ""
    activity_title: str = ""
    raised_hand_at: str | None = None     # ISO-8601; None = no active call
    cleared_at: str | None = None
    cleared_by: str = ""                  # teacher uid who acknowledged
```

`raised_hand_at` set ⇒ active call. Teacher ack sets `cleared_at` and nulls `raised_hand_at`
(idempotent — a second tap while already raised is a no-op, so a flaky network can't double-fire).

### Transport — ride the existing 30s class poll

The teacher classes view already polls for live activity:
[`frontend/src/app/teacher/classes/page.tsx`](../../../../frontend/src/app/teacher/classes/page.tsx)
runs `setInterval(refresh, 30_000)` against `listClassRecentSessions(classId)` →
`/api/classes/{classId}/recent-sessions`. The class-detail page
([`[id]/page.tsx`](../../../../frontend/src/app/teacher/classes/[id]/page.tsx)) reads the same on
mount. **Minimal version: extend that payload with the raised-hand state** so the existing poll
surfaces it with zero new client wiring.

- **M0 (cheapest):** add a `raisedHand: { at, activityTitle } | null` field per group to the
  `recent-sessions` response; render a badge on the group row.
- **M1 (better latency):** a dedicated lightweight `GET /api/classes/{id}/signals` (tiny payload —
  just the raised groups) polled at **~10s** *only while the teacher is on the active class view*.
  Near-real-time without making the heavier recent-sessions call faster. The brief's acceptance is
  "near-real-time" — the 30s poll meets it; 10s on the signals endpoint makes it feel live.

> **Latency note.** Polling is the v1 transport (no SSE/websocket infra today). A 10s signals poll is
> the right cost/latency trade for a classroom where the teacher is physically present. A true push
> channel (SSE) is a 1.1.31 enhancement, not a v1 requirement — call it out, don't build it yet.

### Endpoints

| Endpoint | Change | Auth |
|---|---|---|
| `POST /api/groups/{group_id}/raise-hand` | **New** — student session raises the group's hand (idempotent; sets `raised_hand_at` if unset) | student (group) session |
| `POST /api/classes/{class_id}/signals/{group_id}/ack` | **New** — teacher acknowledges/clears a call | teacher JWT (owner of class, or researcher) |
| `GET /api/classes/{class_id}/signals` | **New (M1)** — list groups with an active raised hand | teacher JWT (owner or researcher via `assert_can_read_class`) |
| `GET /api/classes/{class_id}/recent-sessions` | **extend (M0)** — add `raisedHand` per group row | teacher JWT (owner or researcher) |

`assert_can_read_class` (shipped with 1.1.5) is the auth helper for the teacher reads.

### Student surface

The chat composer row at
[`frontend/src/app/chat/[...path]/page.tsx`](../../../../frontend/src/app/chat/[...path]/page.tsx)
(~L1051–1118) already lays out `ImageUploadButtons` + `VoiceComposerControls` + text input + send in
a `flex items-center gap-2` row. A new **`CallTeacherButton`**
(`frontend/src/components/chat/CallTeacherButton.tsx`) slots between the voice control and the text
input (a secondary action, visually quieter than send):

- A `hand` lucide-react icon (no emoji — project tone), label "Tilkald lærer" / "Call teacher".
- States (Axiom 11): **resting** (tap to call) → **raised** (confirmed; the teacher has been notified — shows "Hånden er rakt op" / "Hand raised", tap again to lower) → **acknowledged** (teacher cleared it — brief confirmation, returns to resting).
- Debounced client-side; the backend write is idempotent so a double-tap can't spam.
- Only renders for student-role sessions (the role model from ADR-015); never on the teacher's own view.

### Teacher surface

- **M0:** a "raised hand" badge on the group row in the class view, and a small **Calls** strip at the top of the class-detail page listing groups with a hand up (group code + activity + how long ago), each with an **Acknowledge** action that clears it. Reuses the `components/teacher/ui/` primitives from 1.1.26.
- **M1+ (folds into 1.1.31):** the same raised-hand list becomes a panel on the live class dashboard, beside the rolling 5-min summary — one surface for "what's happening right now in this class".

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | The student gets immediate local confirmation (optimistic "hand raised"); the teacher sees it within the poll window (10s on the signals endpoint). No model call in the loop — nothing to wait on. |
| 2 | EARNED TRUST | +1 | **The core win.** A visible "escape to a human" hatch is trust-building — the tutor is explicitly *not* the only recourse. Directly answers the 15-June trust thread ("hardest with AI"). |
| 3 | SKILLS, NOT FEATURES | 0 | A platform control across all skills, not a skill itself. Net neutral — it doesn't add a user-facing concept beyond "get a human". |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Zero LLM tokens — a signal is a Firestore write + a poll. No reasoning model used where a flag suffices. |
| 5 | GRACEFUL DEGRADATION | +1 | If the signal write fails, the student can still type/ask; if the poll is slow, the call still lands eventually. Strictly additive over the text loop. |
| 6 | PROTOCOL OVER CUSTOM | +1 | No bespoke protocol — a REST write + the existing class poll. (SSE push is a future option, not invented here.) |
| 7 | API FIRST | +1 | Raise/ack/list are API surfaces; a future channel (Telegram, etc.) or CLI could raise/clear the same signal. |
| 8 | OBSERVABLE BY DEFAULT | +1 | `call_teacher.raised` / `.acknowledged` OTel events (group-keyed, no PII) → BigQuery: how often groups escalate, on which activities, and teacher response latency become measurable lesson-quality signals (feeds [student-engagement-signals.md](student-engagement-signals.md) / the live dashboard). |
| 9 | SECURE BY CONSTRUCTION | 0 | A new write path from an anonymous student session. **Held neutral by construction:** the write is **group-scoped** (a student can only raise *their own* group's hand, keyed by the session's group_id — can't target another group), carries **no free text** (a flag + timestamp, no injection surface), and is **idempotent + naturally rate-limited** (already-raised = no-op). Teacher reads/acks are owner-gated via `assert_can_read_class`. No new PII (group-level, ADR-001). |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | State lives backend (the signal doc); the client renders a button + a list. |
| 11 | USABLE BY DESIGN | +1 | Student button has resting/raised/acknowledged states designed upfront; teacher Calls strip has an empty state ("No calls") — no blank void. Single-column, reflows on shared-phone portrait. |
| | **Net Score** | **+9** | Threshold: ≥ +4. SECURE is 0 (not −1); no student-facing −1. Hard-fail check passes. |

## Milestone phasing

| MS | Deliverable | Est | Gate | Lands |
|---|---|---|---|---|
| **M0** | **Signal + student button.** `GroupSignal` model + `raise-hand`/`ack` endpoints + `CallTeacherButton` (resting/raised) + `raisedHand` on the recent-sessions payload + a teacher badge. | ~0.5d | none | now / pre-demo-adjacent |
| **M1** | **Teacher Calls strip + ack + lightweight `/signals` poll (~10s).** Acknowledge clears the call; near-real-time on the active class view. OTel events. | ~0.5d | none | now |
| M2 | **Fold into the live dashboard** — raised-hand panel beside the rolling summary on the 1.1.31 surface; consider SSE push to drop polling. | ~0.5d | [teacher-analytics-framework.md](teacher-analytics-framework.md) (1.1.31) landing | post-R1 |

## Testing strategy

- **Backend (pytest):** raise-hand idempotency (second raise is a no-op); group-scoping (a session can't raise another group's hand → 403/ignored); ack clears + sets `cleared_by`; `GET /signals` owner-gated (cross-teacher 403; researcher allowed); TTL/expiry behaviour matches `group_sessions`.
- **Frontend (vitest):** `CallTeacherButton` state machine (resting → raised → acknowledged); student-only render (no button on teacher view); optimistic update + reconcile on poll; teacher Calls strip renders/clears; empty state.
- **E2E / manual (LOCAL_MODE):** anon student in a group taps Call teacher → teacher on that class sees the hand within ~10s with the right group code + activity → teacher acknowledges → student sees it clear. (Acceptance below.)

## Acceptance

- [ ] A student taps **Call teacher**; a teacher viewing that class sees the group's raised hand appear in **near-real-time** with the **group code** and **activity** (the brief's acceptance).
- [ ] The signal is **per-group**, never per-student (ADR-001); no PII written.
- [ ] Raising is idempotent; a teacher **Acknowledge** clears it; cleared state shows on the student side.
- [ ] Student button renders only for student-role sessions; has resting/raised/acknowledged states; reflows on shared-phone portrait.
- [ ] `call_teacher.*` OTel events land in BigQuery, group-keyed.
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Students spam the button | Medium | Idempotent backend (already-raised = no-op); client debounce; teacher ack is the only clear. Spam shows as one raised hand, not many. |
| 30s poll feels laggy in a live classroom | Medium | M1's dedicated `/signals` endpoint polled at ~10s; SSE push deferred to 1.1.31 if pilot shows it's needed. |
| Raised hand gets lost if the teacher isn't on the class view | Medium | v1 is in-room (teacher present, glancing at the class view). A persistent notification / count badge on the nav is a 1.1.31 enhancement, noted not built. |
| Couples to a not-yet-built dashboard | Low | Explicitly phased — M0+M1 are standalone; only M2 waits on 1.1.31. |

## Related documents

- [teacher-analytics-framework.md](teacher-analytics-framework.md) — the live teacher dashboard that hosts the raised-hand surface alongside the rolling 5-min summary (1.1.31, R1-gated)
- [teacher-ui-consolidation.md](teacher-ui-consolidation.md) — the teacher design-system primitives the Calls strip uses (1.1.26)
- [student-engagement-signals.md](student-engagement-signals.md) — escalation frequency is a lesson-quality signal (formative, not sanctionary)
- [researcher-role.md](researcher-role.md) — `assert_can_read_class` is the teacher/researcher read-auth helper (1.1.5)
- [june-15-feedback.md](june-15-feedback.md) — the 15-June item→disposition map
- ADR-001 (anonymous group IDs) + ADR-015 (unified multi-surface UI / role model) — scoping-site `architecture.qmd`
