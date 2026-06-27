# Teacher chat history tier — browse + reopen past co-pilot conversations, scoped by class

**Status:** DESIGN (2026-06-27). Part 4b of [teacher-coworking-copilot.md](teacher-coworking-copilot.md). Parts 1–4a shipped (shared shell + class/analytics co-pilots + **cross-visit resume**); this is the remaining continuity piece. No code yet.
**Last Updated:** 2026-06-27 (M: *"a chat-history tier to the teacher so they can see all they have done over time at a class level — and then if they use internal chats, scoped to that class only etc for activities, analytics, etc"*).
**Priority:** **P2** — resume (4a) already covers "continue my last chat" per co-pilot. This adds "browse everything I've done over time, grouped by class". High value, but the trust/continuity floor is already shipped, so it can be its own session.
**Estimated:** ~1d backend (scope-tag + listing route) · ~1–1.5d frontend (history UI + reopen) · ~0.5d tests.
**Scope:** Backend — `backend/db/chat_sessions.py` (`ChatSessionIndex` + a teacher-history query), `backend/skills/skill_processor.py` (tag the index at session creation), a new route in `backend/protocols/` (`GET /api/teacher/chats`). Frontend — a history affordance in `frontend/src/components/teacher/copilot/` + a class-level history view, reopening a thread via the shell's existing resume.
**Dependencies:** the shared co-pilot shell + resume (Part 4a — `frontend/src/components/teacher/copilot/TeacherCopilot.tsx`, threadId persisted at `localStorage["teacherCopilot:<persistKey>"]`); `db.chat_sessions` (`ChatSessionIndex`, `list_sessions_for_skill(skill_id, owner_uid)` already exists); [[feedback-anonymous-users-are-corner-case]] (teacher token on every call). Privacy model (retention) — confirm before shipping a long-lived browsable history.

## Why this exists

A teacher can now resume their *last* chat with each co-pilot (Part 4a), but has no way to look back over *all* the conversations they've had — "what did I ask the analytics co-pilot about 9A last week?", "which activities did I draft with the authoring co-pilot?". The value is a **class-level memory**: open a class and see every conversation that touched it, across the three co-pilots, and reopen any of them where you left off.

## What already exists (recon, 2026-06-27)

- **`ChatSessionIndex`** (`db/chat_sessions.py`) carries `sessionId`, `ownerUid`, `skillId`, `groupCode`, `activityId`, `lastMessageAt`, `turnCount`, `title`. **No `classId`, no `kind`.**
- **`list_sessions_for_skill(skill_id, owner_uid)`** already lists a teacher's sessions for one skill, newest-first — the per-skill primitive to build on.
- The index is **created at stream start** in `skill_processor` (log: `chat_sessions/<id> index created synchronously (owner=…)`).
- The co-pilot already knows its scope: the message **scope prefix** (`[class_id=…]` for analytics, `[activity_id=…]` for authoring; the manage hub is cross-class/global), and the frontend config (`persistKey`, `scopePrefix`). The threadId is persisted per scope in localStorage.

## The gap

Sessions aren't tagged with the class (or the co-pilot *kind*) they belong to, so they can't be grouped "by class". The manage hub is cross-class (`kind=manage`, no class); analytics is per-class; authoring is per-activity (→ resolvable to the activity's class(es)).

## Design

### M1 — Scope-tag sessions (backend)
- Add `class_id: str | None` and `kind: Literal["manage","analytics","authoring","tutor"]` to `ChatSessionIndex`.
- Capture them at index creation in `skill_processor`. Cleanest source: **forwarded props** on the AG-UI stream (the frontend already forwards `resumed_session` via `useSkillAgent` — add `scope_class_id` / `scope_kind`). The co-pilot config knows both. Parsing the `[class_id=…]` prefix server-side is the fallback but brittle — prefer explicit forwarded props.
- Backfill: leave legacy rows `class_id=None` (they group under "General"/untagged). No migration needed.

### M2 — Teacher-history listing (backend)
- `GET /api/teacher/chats?classId=&kind=&limit=` → the caller's sessions filtered by `ownerUid` (+ optional `classId` / `kind`), newest-first, returning `{sessionId, kind, classId, skillId, title, lastMessageAt, turnCount}`.
- Teacher-auth gated (Firebase). Owner-scoped (a teacher sees only their own). For a `classId` filter, assert the caller owns the class (reuse `analytics.auth.assert_caller_owns`).

### M3 — History UI (frontend)
- **Per-co-pilot history**: a small "history" control in the panel header (beside "New chat") → a dropdown of prior threads for this scope (from `/api/teacher/chats?kind=&classId=`). Selecting one sets the shell's `threadId` → resumes via Part 4a (`useSessionMessages` loads it).
- **Class-level history** (the headline): on `/teacher/classes/[id]`, a "Conversations" section listing every chat touching this class — manage (general, optionally filtered), this class's analytics, and its activities' authoring chats — each reopenable.
- Reopen = set `threadId` (the shell already resumes any threadId).

## Acceptance
- A teacher opens a class and sees every past conversation about it (across manage/analytics/authoring), newest-first, and reopens any one where they left off.
- A teacher with no history sees an honest empty state (no fabrication — [[feedback_no_mock_in_shipped_ui]]).
- Cross-tenant: a teacher never sees another teacher's chats; a `classId` they don't own returns "class not accessible".

## Open questions / risks
- **Session-creation hot path**: M1 edits where every session is indexed — guard against breaking the tutor/student path (the `kind="tutor"` default must be safe for existing flows).
- **Retention/privacy**: a browsable long-lived history of teacher–AI conversations needs a retention decision (confirm with the privacy model / ADR-001 owners) before shipping.
- **The manage hub is cross-class**: its threads are `kind=manage`, `classId=None` → a "General" bucket, not under any class. Acceptable; note it in the UI.
- **Forwarded-props plumbing**: confirm the AG-UI `forwardedProps` reach `skill_processor` at index-creation time; if not, the `[class_id=…]`-prefix fallback parses the first message.
