# Session persistence by group code — same code resumes the same session

**Status**: Implemented
**Priority**: P1 (foundational UX — flagged in 2026-05-25 teacher meeting)
**Estimated**: ~1.5–2 days
**Scope**: Backend (Firestore session-store doc + resume routes + chat-history restore from session state), frontend (resume banner + workbench-state restore hook), artefact-side (handle `aipla:restore` on mount — required for all current + future artefacts)
**Dependencies**: v0.1 shipped; ADR-001 (group ID lifecycle); the existing `ChatSessionIndex` bootstrap (session bootstrap endpoint shipped 2026-05-21, [implemented/](implemented/))
**Pedagogical source-of-truth:** [`session-persistence.md`](../../_scoping-snapshot/prototypes/session-persistence.md) in the scoping site
**Created**: 2026-05-25
**Last Updated**: 2026-06-02

## Problem Statement

In v0.1, a group code is **stateless** — entering it on a new device or after a refresh starts a fresh session. Real-world consequence: a group of three students sharing one phone hits "back" by accident and loses 20 minutes of work. Or a student moves between devices (school computer in class → home tablet) and the conversation context vanishes.

From the 2026-05-25 meeting: *"make sure that if using same code the same session will come up."*

**Current State:**

- `group_id_auth.py` mints a fresh JWT per join; no concept of a "session" attached to the group beyond the in-flight chat.
- `ChatSessionIndex` Firestore doc exists (shipped in MCPAPP-SPEC bootstrap work) but is keyed per `session_id`, not per `group_id`. A fresh join mints a new session_id; the old session_id is orphaned.
- BigQuery chat-log pipeline (1.2) isn't live yet — chat history isn't persisted server-side in a queryable form. Lives only in ADK session state (in-memory dev / Vertex Sessions in prod).
- `mcp_app_context.*` workbench state lives in ADK session state — also lost when the session_id changes.

**Impact:**

- Students get penalised for hardware glitches (browser crash, tab close, device switch).
- "One phone per three students" form factor (Jutland brief) makes accidental refreshes likely.
- The agent has no continuity across joins — every "welcome back" turn starts from scratch.
- Teachers can't say "you can pick this up at home" because home = different device = new session.

## Goals

**Primary Goal:** Entering the same group code, from any device, within 30 days resumes the most recent active session for that group: chat history is restored, workbench state restored, the agent's `mcp_app_context.*` block carries the prior interactions. Teachers can explicitly reset a group's session ("start fresh") without rotating the code.

**Success Metrics:**

- Manual: open chat with code `local-demo`, send 3 messages, refresh page → land on the same chat with the 3 messages visible, agent has context.
- Manual: cross-device — same code, different browser → same conversation history visible (last 50 messages loaded; older summarised).
- Manual: drag Boldkast sliders, refresh → sim re-mounts at the same v₀/θ/g via `aipla:restore`.
- Resume banner appears post-join: *"Welcome back — continuing from your last session"* / *"Velkommen tilbage — fortsætter fra din sidste session"*. Dismissible.
- Teacher [Reset session] button (from [teacher-ui.md](teacher-ui.md), 1.G) archives + clears state; next join starts fresh.
- Session TTL = 30 days matches the group code TTL per ADR-001.
- Backend tests: at least 6 pytest cases covering rejoin, expiry, reset, cross-device, mid-activity-change, simultaneous-join.

**Non-Goals:**

- Cross-group sharing (group A's history visible to group B). Sessions are per-group, period.
- Cross-class consolidated history (teacher seeing all groups in one timeline). That's analytics chat / reports per [teacher-ui.md](teacher-ui.md).
- Full chat-history serialisation to ADK session state (would blow context). Strategy: load last 50 messages; summarise older turns.
- Real-time multi-device sync (typing on device A appears on device B mid-keystroke). v1 ships join-time restore; live sync is v2.
- Workbench state diffing / merging across simultaneous devices. Last-write-wins per the brief.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Resume adds ~200ms (one Firestore read + workbench-state postMessage). Acceptable trade for the UX win |
| 2 | EARNED TRUST | +1 | "Your work doesn't disappear" is one of the most basic platform-trust signals. Especially for shared-device classroom contexts |
| 3 | SKILLS, NOT FEATURES | +1 | Per-skill workbench-state restore is part of every artefact's contract — making "skill resumes correctly" a first-class property strengthens the skills-as-the-unit-of-work axiom |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model decision |
| 5 | GRACEFUL DEGRADATION | +1 | If restore fails (Firestore unreachable, workbench artefact doesn't handle `aipla:restore`), the session starts fresh — same as today. No worse than baseline if anything breaks |
| 6 | PROTOCOL OVER CUSTOM | 0 | The `aipla:restore` postMessage is artefact-specific; we considered using `ui/notifications/sandbox-resource-ready`'s `state` parameter from MCP Apps spec but that's a one-shot init payload, not what we want here. So a custom message. Acknowledged as -0 trade — flagging in case someone finds a spec-native primitive later |
| 7 | API FIRST | +1 | All restore behaviour goes through documented endpoints: `GET /api/sessions/{id}/messages` for chat; `GET /api/sessions/{id}/state` for workbench. CLI gets `aiplatform sessions resume <group_code>` for ops debug |
| 8 | OBSERVABLE BY DEFAULT | +1 | OTel spans on resume vs fresh-start; teachers can count "% of sessions that were resumes." Research data point on engagement patterns |
| 9 | SECURE BY CONSTRUCTION | +1 | Auth shape unchanged — student still needs the group code to enter. No privilege escalation possible from resume. Auth tagging from [teacher-permission-model.md](teacher-permission-model.md) flows naturally |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Restore semantics are all server-side; frontend just consumes APIs + handles the `aipla:restore` postMessage |
| | **Net Score** | **+6** | Threshold >= +4 OK |

**Conflict Justifications:** None (the 0 on PROTOCOL OVER CUSTOM is honest rather than penalised — `aipla:restore` is a needed custom envelope until a spec-native replacement surfaces).

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| Group → session binding | Firestore doc `sessions/{group_id}` | Lightweight `{activity_id, workbench_state, chat_session_id, last_active_at}`. Not the chat log — that stays in ADK session state / BigQuery |
| Chat history persistence | ADK session state (sessions/{session_id}) shipped today; BigQuery sink per ADR-005 (1.2) for queryable archive | Resume reads last 50 from ADK session; older summarised |
| Workbench restore | Custom `aipla:restore` postMessage from host → artefact on mount | Per the brief; flagged on the axiom score |
| Auth | Existing anonymous-group JWT, unchanged | The JWT identifies the group; the session_id resolves from group_id → most recent active |
| ID lifecycle | 30-day TTL aligned with group code TTL in ADR-001 | Same expiry; reset = teacher action via 1.G |

**One custom envelope** (`aipla:restore`) — defensible because it carries artefact-specific state and runs once per mount, distinct from `ui/update-model-context` (which is iframe → host; restore is host → iframe init data).

## CLI Surface

| Command | Purpose | Notes |
|---|---|---|
| `aiplatform sessions resume <group_code>` | Print the resolved `session_id`, last-active timestamp, message count, workbench state | New under existing `aiplatform sessions` group; useful for ops debug + AR's testing loop |
| `aiplatform sessions reset <group_code>` | Archive current session + clear workbench state. Asks for confirmation | Teacher-equivalent gets a button in [1.G](teacher-ui.md); ops gets the CLI |
| `aiplatform sessions list <group_code>` (extend existing) | Show all session_ids for the group across history (not just current). Filterable by date | Adds `--all` flag to existing |

Estimate: **~0.2 day** for all three (Click subcommands + httpx calls + tests).

## Design

### Firestore schema

```
sessions/{group_id}
  ├── group_id: "bold-kazoo-87"
  ├── current_session_id: "uuid"       # the active ADK session this group is bound to
  ├── activity_id: "boldkast" | "led-planck" | ...
  ├── workbench_state: { ...lightweight }
  ├── last_active_at: timestamp
  ├── created_at: timestamp
  ├── reset_count: int                 # how many times the teacher reset
  └── revoked: bool                    # set if group code revoked (ADR-001)
```

Note: `workbench_state` here is the **lightweight summary** for restore (e.g. `{v0: 17.5, theta: 62, gravity: 'moon', checklistSteps: [...]}`) — not the full snapshot that lives in ADK session state's `mcp_app_context.*`. The lightweight version is what the artefact needs to re-render UI; the ADK session state version is what the agent's prompt-injection reads.

### Resume flow

```
1. Student enters group code "bold-kazoo-87"
2. POST /api/auth/group/join  body: {code}
   → mint anon-group JWT as today
3. Frontend lands on /lessons OR (if last_active activity recent) directly into chat for that activity
4. GET /api/sessions/by-group/{group_id}/current
   → returns { session_id, activity_id, workbench_state, last_active_at } or 404
5. If session found:
   a. Navigate to /chat/<activity>?session=<session_id>
   b. Frontend calls existing GET /api/sessions/{session_id}/messages to load last 50
   c. Workspace iframe mounts, awaits ui/notifications/sandbox-proxy-ready
   d. Once ready, host sends aipla:restore with the lightweight workbench_state
   e. Resume banner appears in chat: "Welcome back, continuing from {time}"
6. If session not found: fresh start (today's behaviour)
```

### Workbench-side restore contract (required for all artefacts)

Every workbench artefact MUST handle:

```js
window.addEventListener('message', function(e) {
  if (e.data?.type !== 'aipla:restore') return;
  // e.data.state has the artefact-specific lightweight state
  applyRestoredState(e.data.state);
});
```

This is a new required item in the [mcp-app-artefact skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md) checklist. Boldkast gets retrofitted; LED Planck + KineBot ship with it from the start.

### Older-turn summarisation

When restoring chat history, the existing ADK session may have hundreds of messages; we can't dump them all into the model context for the next turn. Strategy:

- Load last 50 messages **for the UI** (so students see continuity)
- For the **prompt context**, the agent's existing summarisation behaviour (ADK `EventsCompactionConfig` already configured in `backend/adk/session.py:33`) handles this — older events get compacted into a summary turn automatically. No new code needed; just verify the config works post-restore.

### Files to create / modify

| File | Change | LOC est |
|---|---|---|
| `backend/db/sessions_by_group.py` (new) | Firestore CRUD for `sessions/{group_id}` doc | ~100 |
| `backend/protocols/sessions_by_group_routes.py` (new) | `GET /api/sessions/by-group/{group_id}/current`, write-on-state-change, `POST /api/sessions/by-group/{group_id}/reset` | ~120 |
| `backend/auth/group_id_auth.py` | After join, upsert `sessions/{group_id}` doc with current session_id | +20 |
| `backend/adk/callbacks.py` (`make_session_tracker`) | After-agent callback: write workbench_state summary + last_active_at to `sessions/{group_id}` | +30 |
| `backend/tests/api_tests/test_sessions_by_group.py` (new) | 6+ cases per success-metrics list | ~200 |
| `frontend/src/app/group/page.tsx` | After join, look up current session, route accordingly | +30 |
| `frontend/src/components/workspace/StaticArtefactFrame.tsx` | Accept `restoreState` prop; send `aipla:restore` after proxy-ready | +20 |
| `frontend/src/components/chat/ResumeBanner.tsx` (new) | The dismissible "continuing from..." chip | ~60 |
| `frontend/src/components/chat/ChatMessageList.tsx` | Render `<ResumeBanner>` if session is a resume | +10 |
| `infrastructure/mcp-sandbox/artefacts/boldkast/v1/index.html` | Add `aipla:restore` listener; apply state | +30 |
| `cli/aiplatform/commands/sessions.py` | `resume`, `reset`, `list --all` subcommands | +80 |
| `cli/tests/test_cli_sessions.py` | Extend with 3 new cases | +50 |
| `.claude/skills/mcp-app-artefact/SKILL.md` | Add `aipla:restore` to the required-events checklist | +30 |

### Concurrency: simultaneous joins from two devices

Per the brief: last-write-wins for workbench state; chat history appends from either device. The Firestore doc is updated via transaction on every state-change postMessage. Two devices typing simultaneously get a momentary divergence but converge on the last upsert.

### Group revocation interaction

If the group code is revoked (teacher action / ADR-001 TTL), `sessions/{group_id}.revoked = true`. Join with that code returns 410 Gone; the session doc isn't deleted (research retention) but is no longer joinable.

## API Changes

**New endpoints:**

- `GET /api/sessions/by-group/{group_id}/current` → returns current session info or 404
- `POST /api/sessions/by-group/{group_id}/reset` → archives current, resets (teacher-auth-gated post-1.A; anon-only-self-reset pre-1.A or never)
- `GET /api/sessions/by-group/{group_id}/history` → list of past sessions (research use; teacher-only)

**No changes to existing:** `/api/auth/group/join`, `/api/sessions/{session_id}/messages`, `/api/sessions/{session_id}/state`, `/api/sessions/{session_id}/iframe-context` all stay shape-identical.

## Migration

- **No data migration of existing v0.1 sessions.** Pre-this-sprint sessions just don't have a `sessions/{group_id}` mapping; they remain accessible via direct session_id URLs but the next group-join goes through the new flow and produces a fresh resumeable session.
- **Group codes in Firestore (anon_groups collection) gain no new fields.** The `sessions/{group_id}` doc is separate; codes don't need migration.
- **Rollback:** revert. Existing v0.1 flow continues to work — the new endpoints just return 404, the frontend handles it as "no resume."

## Testing Strategy

**Backend (pytest):**

- `test_sessions_by_group.py`:
  - Fresh join → no current session → 404
  - Join + 3 messages + state-change → resume returns same session_id + workbench state
  - Cross-device: two separate join requests with same code → same `current_session_id`
  - 30-day expiry: timestamp the doc far back → resume returns 404 (or 410 if revoked)
  - Reset: POST reset → archive + workbench cleared → next resume is 404
  - Simultaneous state writes: two parallel POSTs to workbench-state → last-write wins (Firestore transaction holds)

**Frontend (vitest):**

- `group/page.test.tsx` — after join, calls `getCurrentSession`; routes to `/chat/<activity>?session=<id>` when found
- `chat/ResumeBanner.test.tsx` — renders when resume context, dismissable
- `StaticArtefactFrame.test.tsx` — sends `aipla:restore` after `sandbox-proxy-ready` if `restoreState` prop set

**Artefact-side (vitest where possible, manual otherwise):**

- Boldkast: load with `restoreState={v0: 17.5, theta: 62}` → sliders appear at those values

**Manual:**

- Open chat, send 3 messages, refresh → same session
- Cross-device (browser A on laptop, browser B on phone, same code) → same conversation
- Teacher reset (via 1.G UI or CLI) → next join is fresh

## Implementation Plan

| Step | What | Where | Est |
|---|---|---|---|
| 1 | Firestore CRUD module for `sessions/{group_id}` | `backend/db/sessions_by_group.py` | 0.15 d |
| 2 | API routes + tests | `backend/protocols/sessions_by_group_routes.py`, `test_sessions_by_group.py` | 0.3 d |
| 3 | Hook into group join + agent-after callback | `backend/auth/group_id_auth.py`, `backend/adk/callbacks.py` | 0.15 d |
| 4 | Frontend resume on join | `frontend/src/app/group/page.tsx` | 0.15 d |
| 5 | `<ResumeBanner>` + ChatMessageList integration | `frontend/src/components/chat/ResumeBanner.tsx`, `ChatMessageList.tsx` | 0.15 d |
| 6 | `StaticArtefactFrame.restoreState` prop + `aipla:restore` send | `StaticArtefactFrame.tsx` + test | 0.15 d |
| 7 | Boldkast artefact `aipla:restore` handler | `boldkast/v1/index.html` | 0.1 d |
| 8 | CLI `resume`, `reset`, `list --all` | `cli/aiplatform/commands/sessions.py` + tests | 0.2 d |
| 9 | mcp-app-artefact skill update (required-events checklist) | `.claude/skills/mcp-app-artefact/SKILL.md` | 0.05 d |
| 10 | Manual end-to-end | — | 0.15 d |
| | **Total** | | **~1.45 d** |

## Success Criteria

- [ ] Refresh on an active session restores chat + workbench.
- [ ] Cross-device join with same code resumes the same conversation.
- [ ] Teacher reset (CLI or 1.G UI) archives + clears.
- [ ] Resume banner shows on restored sessions, hides on fresh starts.
- [ ] Boldkast handles `aipla:restore` and reapplies state.
- [ ] mcp-app-artefact skill documents `aipla:restore` as a required artefact contract.
- [ ] 30-day expiry returns 404 / clear error.
- [ ] All tests green.

## Out of Scope (deferred)

- Real-time multi-device sync (live cursor / live typing).
- Resume into a different activity than the one the group last had open (UX requires teacher policy — multi-activity-per-group is 1.G territory).
- BigQuery-side full-history reconstruction (depends on 1.2 chat-log-pipeline landing).

## Related Documents

- **Source of truth:** [`session-persistence.md`](../../_scoping-snapshot/prototypes/session-persistence.md)
- [SEQUENCE.md](SEQUENCE.md) row 1.F
- [teacher-ui.md](teacher-ui.md) (1.G) — provides the reset button surface
- [teacher-permission-model.md](teacher-permission-model.md) (1.A) — group/class auth that this builds on
- [`led-planck-skill-brief.md`](../../_scoping-snapshot/prototypes/led-planck-skill-brief.md), [`kinebot-migration-brief.md`](../../_scoping-snapshot/prototypes/kinebot-migration-brief.md) — both will need `aipla:restore` handlers added per the artefact contract
- ADR-001 (group ID lifecycle), ADR-005 (chat log storage)

---

## Implementation Report

**Completed**: 2026-06-02
**Actual Effort**: [e.g., 5 days vs 3 estimated]
**Branch/PR**: [link or commit range]

### What Was Built
- [Summary of actual implementation]
- [Any deviations from plan]

### Files Changed
- [New files created]
- [Modified files]

### Lessons Learned
- [What went well]
- [What could be improved]
