# Live teacher dashboard — sprint plan (1.1.29 + 1.1.31, placeholder-framework variant)

**Status:** In progress (started 2026-06-28)
**Design docs:** [call-teacher.md](call-teacher.md) (1.1.29 raised-hand) · [teacher-analytics-framework.md](teacher-analytics-framework.md) (1.1.31 live dashboard)
**Decision this sprint:** build the full un-gated slice **plus** the LLM summary layer against a **placeholder R1 framework** (`AIPLA live-summary v0`), structured so the real R1 decision (ICAP+FCI vs CPS+DRA) is a config swap, not a rebuild.

## Why a placeholder framework

R1 (the JB/AR pedagogical framework choice) was the only thing gating the summary layer. Rather than leave M1 blocked, we ship a provisional, swappable `LiveFrameworkConfig`:

- **Engagement mode — ICAP-lite:** Interactive / Constructive / Active / Passive (Chi & Wylie). Domain-general; maps onto signals we already log (dialogue → Interactive/Constructive, workbench-only → Active, idle → Passive). No per-topic concept map required.
- **Concept coverage — DRA-lite:** per-activity target-concept list seeded from the activity's learning-goal text; summary flags touched / stuck / not-yet. Empty list → engagement-only (graceful).

**Swap path:** ICAP+FCI → keep engagement, swap concept-coverage to FCI items; CPS+DRA → swap engagement categories + populate the DRA map. Both are edits to `LiveFrameworkConfig`, not the summary/endpoint/UI code.

## Architecture seams (verified in code, 2026-06-28)

- Routes: `backend/protocols/classes_routes.py` (`APIRouter(prefix="/api/classes")`); helpers `_assert_teacher`, `_load_readable` (researcher-aware via `analytics.auth.assert_can_read_class`), `_load_owned`, `_tag_span`.
- Per-group session data: `db.chat_sessions.list_sessions_for_group_codes(cls.group_codes)`; `RecentSessionRow` is the camelCase model pattern.
- Group identity: student session carries `user.group_id` + `user.group_tags`; `anon_groups/{group_id}` holds group metadata. Signal is keyed server-side by `user.group_id` (a student can only raise *their own* group's hand).
- Repo pattern: `db/group_sessions.py` (functions over `db.firestore` `get_document/set_document/update_document/query_documents`).
- Summary reuse: `backend/reports/narrative.py` (grounded Gemini-Flash narrative, cached on growth) — the live class summary is the class-level analogue.
- Student composer: `frontend/src/app/chat/[...path]/page.tsx` (`ImageUploadButtons` + `VoiceComposerControls` + input row). Teacher primitives: `frontend/src/components/teacher/ui/`.

## Milestones

| MS | Deliverable | Gate | Est |
|---|---|---|---|
| **M0a** | **Raised-hand backend.** `GroupSignal` model + `db/group_signals.py` repo + `POST /api/groups/{group_id}/raise-hand` (student, idempotent, server-keyed) + `POST /api/classes/{class_id}/signals/{group_id}/ack` (teacher) + `GET /api/classes/{class_id}/signals` (teacher/researcher). pytest. | none | 0.5d |
| **M0b** | **Live-view endpoint.** `GET /api/classes/{class_id}/live` → calls + deterministic per-group signals (active/idle, turns, last-activity, "stuck" = no progress in N min, current step). pytest. | none | 1d |
| **M0c** | **Student `CallTeacherButton`.** Composer control; resting → raised → acknowledged; student-role only; lucide `hand`; optimistic + reconcile on poll. vitest. | none | 0.5d |
| **M0d** | **Teacher Live view.** `teacher/classes/[id]` Live view: Calls strip (Acknowledge) + deterministic group rows; empty/loading/error states; ~10s `/signals` poll on the active view. vitest. | none | 1d |
| **M1** | **Summary layer (placeholder framework).** `analytics/live_framework.py` (`LiveFrameworkConfig` + `AIPLA_LIVE_V0`) + `analytics/live_class_summary.py` (one Flash call per class per 5-min, debounced + cached, reuse narrative pattern) → populate `/live` summary fields + a Live-view summary panel marked AI-generated + last-updated. pytest + vitest. | placeholder (swappable) | 1.5d |

## Endpoints

| Endpoint | Method | Auth | Milestone |
|---|---|---|---|
| `/api/groups/{group_id}/raise-hand` | POST | student (group) session; server keys by `user.group_id` | M0a |
| `/api/classes/{class_id}/signals/{group_id}/ack` | POST | teacher owner / researcher | M0a |
| `/api/classes/{class_id}/signals` | GET | teacher owner / researcher | M0a |
| `/api/classes/{class_id}/live` | GET | teacher owner / researcher | M0b (summary fields M1) |

## Privacy / security (ADR-001)

- Signal is **per-group**, server-keyed by `user.group_id` — a student cannot raise another group's hand; carries no free text (flag + timestamp); idempotent (already-raised = no-op). Teacher reads/acks owner-gated via `assert_can_read_class`. Summary names groups, never students. No new PII.

## Acceptance

- [ ] (M0) Student taps Call teacher → teacher on that class sees the group's hand in near-real-time (group code + activity); Acknowledge clears it; cleared shows on the student side.
- [ ] (M0) Live view renders per-group deterministic signals with **no LLM dependency**; empty/loading/error states; degrades if the summary fails.
- [ ] (M1) Rolling ~5-min class summary generates (Flash, debounced + cached), framed in the placeholder framework's vocabulary, marked AI-generated with a last-updated time; failure degrades to the deterministic layer.
- [ ] R1 swap is a `LiveFrameworkConfig` edit only — no endpoint/UI change.
- [ ] `make lint` + `make test-fast` (backend) and `npm run quality:check` (frontend) green.

## R1 follow-up (with Aswin)

Settle ICAP+FCI vs CPS+DRA; then edit `AIPLA_LIVE_V0` → the chosen vocabulary + (for DRA) the per-topic concept map. No code change beyond the config object.
